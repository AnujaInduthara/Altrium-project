const crypto = require('node:crypto');
const { supabaseAdmin } = require('../config/supabase');
const { VACANCY_STATUS } = require('../config/vacancyOptions');
const { validateVacancyInput } = require('../utils/vacancyValidation');
const { evaluateCloseTransition } = require('../utils/vacancyClosure');

// Columns returned to the API layer. No secrets here, but we still list
// columns explicitly rather than select('*') so the shape is deliberate.
const RETURNING = [
  'id',
  'job_title',
  'department',
  'location',
  'employment_type',
  'experience_level',
  'number_of_positions',
  'job_description',
  'job_requirements',
  'status',
  'created_by',
  'public_token',
  'published_at',
  'closed_at',
  'closed_by',
  'created_at',
  'updated_at',
].join(', ');

// Fields that are safe to expose on the public (unauthenticated) vacancy view.
const PUBLIC_FIELDS = [
  'job_title',
  'department',
  'location',
  'employment_type',
  'experience_level',
  'number_of_positions',
  'job_description',
  'job_requirements',
  'published_at',
];

// A typed, HTTP-aware error the controller can translate directly into a
// response without leaking internals.
class VacancyError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'VacancyError';
    this.isVacancyError = true;
    this.code = code;
    this.status = status;
  }
}

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

async function fetchVacancyById(id) {
  const { data, error } = await supabaseAdmin
    .from('job_vacancies')
    .select(RETURNING)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    // An invalid uuid string surfaces here as a Postgres error; treat it as
    // "not found" rather than a 500.
    if (error.code === '22P02') return null;
    throw wrapDbError('Failed to load vacancy', error);
  }
  return data || null;
}

// Persists a new vacancy. `status` is forced to DRAFT and `created_by` is set
// from the authenticated user id passed by the controller — both are ignored
// if present in `data`.
async function createVacancy(data, authUserId) {
  const record = {
    job_title: data.job_title,
    department: data.department,
    location: data.location,
    employment_type: data.employment_type,
    experience_level: data.experience_level,
    number_of_positions: data.number_of_positions,
    job_description: data.job_description,
    job_requirements: data.job_requirements,
    status: VACANCY_STATUS.DRAFT,
    created_by: authUserId,
  };

  const { data: created, error } = await supabaseAdmin
    .from('job_vacancies')
    .insert(record)
    .select(RETURNING)
    .single();

  if (error) {
    throw wrapDbError('Failed to insert vacancy', error);
  }

  return created;
}

// Lists the vacancies owned by one HR user, newest first.
async function listVacanciesForUser(authUserId) {
  const { data, error } = await supabaseAdmin
    .from('job_vacancies')
    .select(RETURNING)
    .eq('created_by', authUserId)
    .order('created_at', { ascending: false });

  if (error) {
    throw wrapDbError('Failed to list vacancies', error);
  }

  return data || [];
}

// Returns one vacancy the caller is allowed to see: null if it does not exist,
// throws FORBIDDEN if it belongs to another HR user (PB-01's ownership model).
async function getVacancyForUser(id, authUserId) {
  const vacancy = await fetchVacancyById(id);
  if (!vacancy) return null;
  if (vacancy.created_by !== authUserId) {
    throw new VacancyError('FORBIDDEN', 403, 'You do not have permission to view this vacancy.');
  }
  return vacancy;
}

// DRAFT -> PUBLISHED. Server-controlled: generates the public token, sets
// published_at, and only ever transitions a vacancy the caller owns that is
// currently a complete DRAFT.
async function publishVacancy(id, authUserId) {
  const vacancy = await fetchVacancyById(id);

  if (!vacancy) {
    throw new VacancyError('VACANCY_NOT_FOUND', 404, 'This vacancy could not be found.');
  }
  if (vacancy.created_by !== authUserId) {
    throw new VacancyError('FORBIDDEN', 403, 'You do not have permission to publish this vacancy.');
  }
  if (vacancy.status === VACANCY_STATUS.PUBLISHED) {
    throw new VacancyError('VACANCY_ALREADY_PUBLISHED', 409, 'This vacancy has already been published.');
  }
  if (vacancy.status !== VACANCY_STATUS.DRAFT) {
    throw new VacancyError('VACANCY_NOT_DRAFT', 409, 'Only draft vacancies can be published.');
  }

  const { valid } = validateVacancyInput(vacancy);
  if (!valid) {
    throw new VacancyError(
      'VACANCY_INCOMPLETE',
      400,
      'Please complete all required vacancy information before publishing.'
    );
  }

  // Conditional, single-statement update: the `.eq('status', 'draft')` guard
  // makes the DRAFT -> PUBLISHED transition atomic, so two concurrent publish
  // requests can never both succeed or produce two tokens. Retry only on the
  // (astronomically unlikely) token-uniqueness collision.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const publicToken = crypto.randomBytes(24).toString('base64url');

    const { data, error } = await supabaseAdmin
      .from('job_vacancies')
      .update({
        status: VACANCY_STATUS.PUBLISHED,
        public_token: publicToken,
        published_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', VACANCY_STATUS.DRAFT)
      .select(RETURNING)
      .maybeSingle();

    if (error) {
      if (error.code === '23505') continue; // token collision — new token, retry
      throw wrapDbError('Failed to publish vacancy', error);
    }

    if (!data) {
      // No row matched the DRAFT guard — a concurrent request already moved it.
      const current = await fetchVacancyById(id);
      if (current && current.status === VACANCY_STATUS.PUBLISHED) {
        throw new VacancyError('VACANCY_ALREADY_PUBLISHED', 409, 'This vacancy has already been published.');
      }
      throw new VacancyError('VACANCY_NOT_DRAFT', 409, 'Only draft vacancies can be published.');
    }

    return data;
  }

  throw new VacancyError('VACANCY_PUBLISH_FAILED', 500, 'Unable to publish the vacancy. Please try again.');
}

// PUBLISHED -> CLOSED (PB-08). One-way: a closed vacancy can never be re-opened.
// Server-controlled and owner-checked. Records who closed it (`closed_by`) and
// when (`closed_at`, server time — never a client value). Nothing else changes:
// the public_token is kept so the link stays resolvable, and applications, CVs,
// AI screening results and selected candidates are untouched.
async function closeVacancy(id, authUserId) {
  const vacancy = await fetchVacancyById(id);

  if (!vacancy) {
    throw new VacancyError('VACANCY_NOT_FOUND', 404, 'This vacancy could not be found.');
  }
  if (vacancy.created_by !== authUserId) {
    throw new VacancyError('FORBIDDEN', 403, 'You do not have permission to close this vacancy.');
  }

  const decision = evaluateCloseTransition(vacancy.status);
  if (!decision.allowed) {
    throw new VacancyError(decision.code, decision.status, decision.message);
  }

  // Conditional, single-statement update. The `.eq('status', 'published')` guard
  // makes PUBLISHED -> CLOSED atomic and idempotent: a double-click or a
  // concurrent request updates zero rows once the vacancy is already closed
  // rather than re-stamping the audit fields or erroring.
  const { data, error } = await supabaseAdmin
    .from('job_vacancies')
    .update({
      status: VACANCY_STATUS.CLOSED,
      closed_at: new Date().toISOString(),
      closed_by: authUserId,
    })
    .eq('id', id)
    .eq('status', VACANCY_STATUS.PUBLISHED)
    .select(RETURNING)
    .maybeSingle();

  if (error) {
    throw wrapDbError('Failed to close vacancy', error);
  }

  if (!data) {
    // No row matched the PUBLISHED guard — a concurrent request already moved it.
    const current = await fetchVacancyById(id);
    const recheck = evaluateCloseTransition(current ? current.status : undefined);
    if (!recheck.allowed) {
      throw new VacancyError(recheck.code, recheck.status, recheck.message);
    }
    throw new VacancyError('VACANCY_CLOSE_FAILED', 500, 'Unable to close the vacancy. Please try again.');
  }

  return data;
}

// Public, unauthenticated lookup for the applicant page. Resolves a vacancy by
// token when it is PUBLISHED **or** CLOSED, returning its public-safe fields
// plus `status` so the page can show the application form (published) or a
// "closed" notice (closed). Draft / unknown tokens still return null — nothing
// about a non-live vacancy leaks. Audit fields (closed_at/closed_by, ids,
// created_by) are never included.
async function getPublicVacancyByToken(token) {
  if (!token || typeof token !== 'string') return null;

  const { data, error } = await supabaseAdmin
    .from('job_vacancies')
    .select(PUBLIC_FIELDS.join(', ') + ', status')
    .eq('public_token', token)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02') return null;
    throw wrapDbError('Failed to load public vacancy', error);
  }
  if (
    !data ||
    (data.status !== VACANCY_STATUS.PUBLISHED && data.status !== VACANCY_STATUS.CLOSED)
  ) {
    return null;
  }

  const publicView = { status: data.status };
  for (const field of PUBLIC_FIELDS) publicView[field] = data[field];
  return publicView;
}

// Public, unauthenticated lookup used by the PB-03 application submission. It
// only ever resolves a PUBLISHED vacancy — a CLOSED (PB-08), draft or unknown
// token returns null, so a closed vacancy stops accepting new applications at
// the server even though its link stays resolvable. Returns the internal `id`
// and `job_title` for the backend's own use (linking the application row,
// wording the confirmation) — this shape is never sent to the applicant's
// browser.
async function getApplicableVacancyByToken(token) {
  if (!token || typeof token !== 'string') return null;

  const { data, error } = await supabaseAdmin
    .from('job_vacancies')
    .select('id, job_title, status')
    .eq('public_token', token)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02') return null;
    throw wrapDbError('Failed to load vacancy for application', error);
  }
  if (!data || data.status !== VACANCY_STATUS.PUBLISHED) return null;

  return { id: data.id, job_title: data.job_title };
}

// Internal, non-owner-checked lookup for the PB-05 screening pipeline. Returns
// the job-relevant fields the screening prompt needs, or null if unknown. This
// is only ever called server-side by the screening service (which is triggered
// by the system, not by a user request), so there is no ownership check here.
async function getVacancyForScreening(id) {
  const { data, error } = await supabaseAdmin
    .from('job_vacancies')
    .select(
      'id, job_title, department, location, employment_type, experience_level, job_description, job_requirements, status'
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02') return null;
    throw wrapDbError('Failed to load vacancy for screening', error);
  }
  return data || null;
}

module.exports = {
  createVacancy,
  listVacanciesForUser,
  getVacancyForUser,
  publishVacancy,
  closeVacancy,
  getPublicVacancyByToken,
  getApplicableVacancyByToken,
  getVacancyForScreening,
  VacancyError,
};
