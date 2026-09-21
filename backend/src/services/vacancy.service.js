const crypto = require('node:crypto');
const { supabaseAdmin } = require('../config/supabase');
const { VACANCY_STATUS } = require('../config/vacancyOptions');
const { validateVacancyInput } = require('../utils/vacancyValidation');

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

// Public, unauthenticated lookup by token. Only ever returns a PUBLISHED
// vacancy, and only its public-safe fields (never created_by, ids, tokens or
// audit timestamps). Returns null for anything else.
async function getPublishedVacancyByToken(token) {
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
  if (!data || data.status !== VACANCY_STATUS.PUBLISHED) return null;

  const publicView = {};
  for (const field of PUBLIC_FIELDS) publicView[field] = data[field];
  return publicView;
}

// Public, unauthenticated listing for the Applicant Portal. Only ever returns
// PUBLISHED vacancies and only PUBLIC_FIELDS plus public_token (the portal
// needs it to link to the apply form) — never id, created_by or timestamps.
async function listPublishedVacancies({ q, department, limit, offset }) {
  let query = supabaseAdmin
    .from('job_vacancies')
    .select([...PUBLIC_FIELDS, 'public_token'].join(', '), { count: 'exact' })
    .eq('status', VACANCY_STATUS.PUBLISHED)
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (department) {
    query = query.eq('department', department);
  }
  if (q) {
    // PostgREST's or() grammar splits on top-level commas/parens, which a
    // search term can legitimately contain (e.g. "Engineer, Backend").
    // Double-quoting the value makes it literal; backslash/quote inside it
    // must then be escaped for that quoting layer (separate from the LIKE
    // backslash-escaping already applied to % and _ in q).
    const likeValue = `%${q}%`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    query = query.or(`job_title.ilike."${likeValue}",department.ilike."${likeValue}"`);
  }

  const { data, error, count } = await query;

  if (error) {
    throw wrapDbError('Failed to list published vacancies', error);
  }

  return { vacancies: data || [], total: count || 0 };
}

// Public, unauthenticated lookup used by the PB-03 application submission. Like
// getPublishedVacancyByToken it only ever resolves a PUBLISHED vacancy, but it
// returns the internal `id` and `job_title` for the backend's own use (linking
// the application row, wording the confirmation) — this shape is never sent to
// the applicant's browser. Returns null for draft / closed / unknown tokens.
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
  listPublishedVacancies,
  getPublishedVacancyByToken,
  getApplicableVacancyByToken,
  getVacancyForScreening,
  VacancyError,
};
