const { supabaseAdmin } = require('../../config/supabase');
const {
  SCREENING_STATUS,
  SCREENING_VERSION,
  ERROR_CODES,
  MAX_ATTEMPTS,
  PROVIDER_RETRY,
} = require('../../config/screeningOptions');
const { isScreeningConfigured } = require('../../config/aiOptions');
const applicationService = require('../application.service');
const vacancyService = require('../vacancy.service');
const { getAIProvider } = require('../ai');
const { extractCvText } = require('./cvText');
const { buildScreeningPrompt } = require('./prompt');
const { parseAndValidate } = require('./resultSchema');
const { ScreeningError } = require('./errors');

// ===========================================================================
// PB-05 — AI-assisted CV screening pipeline.
//
//   application stored (PB-04)
//        -> ensure a screening row exists (pending)              [idempotent]
//        -> claim it (pending|failed -> processing)              [concurrency]
//        -> load + verify dependencies (application, vacancy, CV)
//        -> download CV (private) -> extract text -> normalize
//        -> build vacancy-specific prompt (CV = untrusted data)
//        -> call AI provider (bounded retries/backoff)
//        -> validate structured JSON (untrusted output)
//        -> recompute score from weighted dimensions
//        -> persist COMPLETED   (or FAILED with a safe error code)
//
// The application row is NEVER modified here. A failure leaves the application
// and CV intact and available for manual HR review.
// ===========================================================================

const SCREENING_COLUMNS =
  'id, application_id, vacancy_id, status, score, recommendation, candidate_name, ' +
  'skills, matched_skills, missing_skills, experience_match, education_match, summary, ' +
  'score_breakdown, evidence, model_provider, model_name, screening_version, ' +
  'error_code, attempts, processing_started_at, processing_completed_at, created_at, updated_at';

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error ? error.message : 'unknown'}`);
  if (error) err.cause = error;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Truncated, secret-free diagnostic detail for the `error_detail` column / logs.
// Defensively redacts anything that looks like an API key or bearer token even
// though provider SDK errors do not normally embed credentials.
function safeDetail(err) {
  if (!err) return null;
  const msg = typeof err.message === 'string' ? err.message : String(err);
  return msg
    .replace(/\s+/g, ' ')
    .replace(/(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9._-]{20,})/g, '[redacted]')
    .trim()
    .slice(0, 500);
}

// --- persistence helpers -------------------------------------------------

// Idempotent: create the screening row if absent, then return the current row.
async function ensureScreeningRow(applicationId, vacancyId) {
  const { error: insertError } = await supabaseAdmin
    .from('application_screenings')
    .insert({
      application_id: applicationId,
      vacancy_id: vacancyId,
      status: SCREENING_STATUS.PENDING,
    });

  // 23505 = the UNIQUE(application_id) row already exists — expected on retries.
  if (insertError && insertError.code !== '23505') {
    throw wrapDbError('Failed to create screening row', insertError);
  }

  const { data, error } = await supabaseAdmin
    .from('application_screenings')
    .select(SCREENING_COLUMNS)
    .eq('application_id', applicationId)
    .single();

  if (error) throw wrapDbError('Failed to load screening row', error);
  return data;
}

// Concurrency guard: atomically move pending|failed -> processing. If another
// worker already claimed it (or it is completed), no row matches and we get
// null back — the caller then just returns the current row.
async function claimForProcessing(applicationId) {
  const { data, error } = await supabaseAdmin
    .from('application_screenings')
    .update({
      status: SCREENING_STATUS.PROCESSING,
      processing_started_at: new Date().toISOString(),
      processing_completed_at: null,
      error_code: null,
      error_detail: null,
    })
    .eq('application_id', applicationId)
    .in('status', [SCREENING_STATUS.PENDING, SCREENING_STATUS.FAILED])
    .lt('attempts', MAX_ATTEMPTS)
    .select(SCREENING_COLUMNS)
    .maybeSingle();

  if (error) throw wrapDbError('Failed to claim screening', error);
  if (!data) return null;

  // Bump the attempt counter separately (PostgREST cannot do attempts = attempts + 1).
  const nextAttempts = (data.attempts || 0) + 1;
  const { data: bumped, error: bumpError } = await supabaseAdmin
    .from('application_screenings')
    .update({ attempts: nextAttempts })
    .eq('application_id', applicationId)
    .eq('status', SCREENING_STATUS.PROCESSING)
    .select(SCREENING_COLUMNS)
    .single();

  if (bumpError) throw wrapDbError('Failed to record screening attempt', bumpError);
  return bumped;
}

async function persistCompleted(applicationId, result, meta) {
  const { data, error } = await supabaseAdmin
    .from('application_screenings')
    .update({
      status: SCREENING_STATUS.COMPLETED,
      score: result.score,
      recommendation: result.recommendation,
      candidate_name: result.candidate_name,
      skills: result.skills,
      matched_skills: result.matched_skills,
      missing_skills: result.missing_skills,
      experience_match: result.experience_match,
      education_match: result.education_match,
      summary: result.summary,
      score_breakdown: result.score_breakdown,
      evidence: result.evidence,
      model_provider: meta.provider,
      model_name: meta.model,
      screening_version: SCREENING_VERSION,
      error_code: null,
      error_detail: null,
      processing_completed_at: new Date().toISOString(),
    })
    .eq('application_id', applicationId)
    .eq('status', SCREENING_STATUS.PROCESSING)
    .select(SCREENING_COLUMNS)
    .maybeSingle();

  if (error) throw wrapDbError('Failed to persist screening result', error);
  return data;
}

async function markFailed(applicationId, errorCode, detail) {
  const code = ERROR_CODES[errorCode] ? errorCode : ERROR_CODES.UNKNOWN_ERROR;
  const { data, error } = await supabaseAdmin
    .from('application_screenings')
    .update({
      status: SCREENING_STATUS.FAILED,
      error_code: code,
      error_detail: detail ? String(detail).slice(0, 500) : null,
      processing_completed_at: new Date().toISOString(),
    })
    .eq('application_id', applicationId)
    .eq('status', SCREENING_STATUS.PROCESSING)
    .select(SCREENING_COLUMNS)
    .maybeSingle();

  if (error) throw wrapDbError('Failed to mark screening failed', error);
  return data;
}

// --- the analysis pipeline (no DB I/O) ---------------------------------

// Runs one AI call with bounded retries + exponential backoff on transient
// provider errors. Non-retryable errors (bad request, refusal, not configured)
// bail immediately.
async function callProviderWithRetry(provider, prompt) {
  let lastError;
  for (let attempt = 0; attempt <= PROVIDER_RETRY.maxRetries; attempt += 1) {
    try {
      return await provider.complete(prompt);
    } catch (err) {
      lastError = err;
      const retryable = err && err.isAIProviderError && err.retryable;
      if (!retryable || attempt === PROVIDER_RETRY.maxRetries) break;
      const delay = Math.min(
        PROVIDER_RETRY.maxDelayMs,
        PROVIDER_RETRY.baseDelayMs * 2 ** attempt
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

function providerErrorToScreeningCode(err) {
  if (err && err.isAIProviderError) {
    if (err.code === 'AI_TIMEOUT') return ERROR_CODES.AI_TIMEOUT;
    return ERROR_CODES.AI_PROVIDER_ERROR;
  }
  return ERROR_CODES.UNKNOWN_ERROR;
}

// Pure(ish) pipeline: CV buffer + vacancy -> validated screening result.
// Throws ScreeningError on any failure. `provider` is injectable for tests.
async function analyzeCv({ vacancy, cvBuffer, ext, provider }) {
  const activeProvider = provider || getAIProvider();

  const cv = await extractCvText({ buffer: cvBuffer, ext });
  const prompt = buildScreeningPrompt({ vacancy, cvText: cv.text });

  let completion;
  try {
    completion = await callProviderWithRetry(activeProvider, prompt);
  } catch (err) {
    throw new ScreeningError(
      providerErrorToScreeningCode(err),
      'The AI provider could not complete screening.',
      { cause: err }
    );
  }

  let parsed = parseAndValidate(completion.text);

  // One corrective retry for a malformed / out-of-contract response.
  if (!parsed.valid) {
    try {
      const retry = await callProviderWithRetry(activeProvider, {
        system: prompt.system,
        user:
          prompt.user +
          '\n\nYour previous response was not a single valid JSON object matching the required shape. Respond again with ONLY that JSON object.',
      });
      parsed = parseAndValidate(retry.text);
    } catch (err) {
      throw new ScreeningError(providerErrorToScreeningCode(err), 'The AI provider failed on retry.', {
        cause: err,
      });
    }
  }

  if (!parsed.valid) {
    throw new ScreeningError(
      ERROR_CODES.INVALID_AI_RESPONSE,
      `AI response failed validation: ${parsed.errors.join('; ')}`
    );
  }

  return {
    result: parsed.value,
    meta: {
      provider: activeProvider.name,
      model: activeProvider.model,
      cvChars: cv.charCount,
      cvTruncated: cv.truncated,
    },
  };
}

// --- orchestration ----------------------------------------------------

async function loadAndVerifyDependencies(applicationId) {
  const application = await applicationService.getApplicationForScreening(applicationId);
  if (!application) {
    throw new ScreeningError(ERROR_CODES.DEPENDENCY_MISSING, 'Application not found.');
  }
  if (!application.cv_path) {
    throw new ScreeningError(ERROR_CODES.DEPENDENCY_MISSING, 'Application has no CV on file.');
  }

  const vacancy = await vacancyService.getVacancyForScreening(application.vacancy_id);
  if (!vacancy) {
    throw new ScreeningError(ERROR_CODES.DEPENDENCY_MISSING, 'Associated vacancy not found.');
  }
  if (vacancy.id !== application.vacancy_id) {
    throw new ScreeningError(ERROR_CODES.DEPENDENCY_MISSING, 'Application/vacancy mismatch.');
  }

  const hasRequirements = Array.isArray(vacancy.job_requirements) && vacancy.job_requirements.length > 0;
  const hasDescription = typeof vacancy.job_description === 'string' && vacancy.job_description.trim().length > 0;
  if (!hasRequirements && !hasDescription) {
    throw new ScreeningError(ERROR_CODES.DEPENDENCY_MISSING, 'Vacancy has no usable requirements to screen against.');
  }

  return { application, vacancy };
}

// Screen one application. Idempotent and concurrency-safe. Returns the current
// screening row (never throws for an expected screening failure — that is
// recorded on the row as status FAILED + a safe error_code).
async function screenApplication(applicationId, { provider } = {}) {
  if (!isScreeningConfigured()) {
    // No AI credentials — leave the row pending for a later retry.
    const existing = await getScreeningForApplication(applicationId);
    return existing;
  }

  // We need the vacancy id to create the row; get it cheaply first.
  const stub = await applicationService.getApplicationForScreening(applicationId);
  if (!stub) {
    console.error('screenApplication: application not found', applicationId);
    return null;
  }

  await ensureScreeningRow(applicationId, stub.vacancy_id);

  const claimed = await claimForProcessing(applicationId);
  if (!claimed) {
    // Already processing / completed, or out of retries.
    return getScreeningForApplication(applicationId);
  }

  const startedAt = Date.now();
  console.log(
    JSON.stringify({
      evt: 'screening.started',
      application_id: applicationId,
      screening_id: claimed.id,
      attempt: claimed.attempts,
    })
  );

  try {
    const { application, vacancy } = await loadAndVerifyDependencies(applicationId);
    const cvBuffer = await applicationService.downloadCv(application.cv_path);
    const ext = application.cv_content_type === 'application/pdf' ? 'pdf' : 'docx';

    const { result, meta } = await analyzeCv({ vacancy, cvBuffer, ext, provider });
    const row = await persistCompleted(applicationId, result, meta);

    console.log(
      JSON.stringify({
        evt: 'screening.completed',
        application_id: applicationId,
        screening_id: claimed.id,
        provider: meta.provider,
        model: meta.model,
        score: result.score,
        recommendation: result.recommendation,
        duration_ms: Date.now() - startedAt,
      })
    );
    return row || getScreeningForApplication(applicationId);
  } catch (err) {
    const code = err && err.isScreeningError ? err.code : ERROR_CODES.UNKNOWN_ERROR;
    const detail = safeDetail(err);
    if (!err || !err.isScreeningError) {
      console.error('screening.unexpected_error', applicationId, detail);
    }
    console.log(
      JSON.stringify({
        evt: 'screening.failed',
        application_id: applicationId,
        screening_id: claimed.id,
        error_code: code,
        duration_ms: Date.now() - startedAt,
      })
    );
    const row = await markFailed(applicationId, code, detail);
    return row || getScreeningForApplication(applicationId);
  }
}

// Fire-and-forget trigger used from the PB-03/PB-04 submission path. Never
// throws into the caller; the HTTP response has already been sent.
function screenApplicationInBackground(applicationId) {
  setImmediate(() => {
    screenApplication(applicationId).catch((err) => {
      console.error('Background screening crashed for', applicationId, safeDetail(err));
    });
  });
}

// --- reads for PB-06 --------------------------------------------------

async function getScreeningForApplication(applicationId) {
  const { data, error } = await supabaseAdmin
    .from('application_screenings')
    .select(SCREENING_COLUMNS)
    .eq('application_id', applicationId)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02') return null;
    throw wrapDbError('Failed to load screening', error);
  }
  return data || null;
}

// All screenings for a vacancy, ranked by score (highest first, unscored last).
// `ai_screening_rank` is advisory ordering, not an objective judgement.
async function listScreeningsForVacancy(vacancyId) {
  const { data, error } = await supabaseAdmin
    .from('application_screenings')
    .select(SCREENING_COLUMNS)
    .eq('vacancy_id', vacancyId);

  if (error) throw wrapDbError('Failed to list screenings', error);

  const rows = data || [];
  rows.sort((a, b) => {
    const sa = a.score === null || a.score === undefined ? -1 : a.score;
    const sb = b.score === null || b.score === undefined ? -1 : b.score;
    return sb - sa;
  });

  let rank = 0;
  return rows.map((row) => {
    if (row.status === SCREENING_STATUS.COMPLETED && typeof row.score === 'number') {
      rank += 1;
      return { ...row, ai_screening_rank: rank };
    }
    return { ...row, ai_screening_rank: null };
  });
}

// HR-initiated (re)run of a screening. Handles every non-running state:
//   - no row yet  -> create one (e.g. the application was stored before any AI
//                    credentials were configured), then queue it
//   - pending     -> was never processed; just trigger the pipeline
//   - failed      -> reset to pending, clear the attempt counter, re-run
//   - completed   -> reset to pending and re-run (e.g. the vacancy changed)
//   - processing  -> report alreadyRunning and do nothing
async function retryScreening(applicationId) {
  let current = await getScreeningForApplication(applicationId);

  if (!current) {
    const stub = await applicationService.getApplicationForScreening(applicationId);
    if (!stub) {
      throw new ScreeningError(ERROR_CODES.DEPENDENCY_MISSING, 'Application not found.');
    }
    await ensureScreeningRow(applicationId, stub.vacancy_id);
    current = await getScreeningForApplication(applicationId);
  }

  if (current && current.status === SCREENING_STATUS.PROCESSING) {
    return { status: current.status, alreadyRunning: true };
  }

  const { error } = await supabaseAdmin
    .from('application_screenings')
    .update({
      status: SCREENING_STATUS.PENDING,
      attempts: 0,
      error_code: null,
      error_detail: null,
      processing_started_at: null,
      processing_completed_at: null,
    })
    .eq('application_id', applicationId)
    .in('status', [SCREENING_STATUS.PENDING, SCREENING_STATUS.FAILED, SCREENING_STATUS.COMPLETED]);

  if (error) throw wrapDbError('Failed to queue screening (re)run', error);

  screenApplicationInBackground(applicationId);
  return { status: SCREENING_STATUS.PENDING, alreadyRunning: false };
}

// Bulk trigger for the AI Screening page: queue a run for every application
// under a vacancy whose screening has not completed and is not already running
// (pending, failed, or never created). Completed screenings are left untouched.
// Returns { queued, total }.
async function runPendingScreeningsForVacancy(vacancyId) {
  const [applications, screenings] = await Promise.all([
    applicationService.listApplicationsForVacancy(vacancyId),
    listScreeningsForVacancy(vacancyId),
  ]);
  const byApplication = new Map(screenings.map((s) => [s.application_id, s]));

  let queued = 0;
  for (const application of applications) {
    const existing = byApplication.get(application.id);
    const status = existing ? existing.status : null;
    if (status === SCREENING_STATUS.PROCESSING || status === SCREENING_STATUS.COMPLETED) {
      continue;
    }
    try {
      await retryScreening(application.id);
      queued += 1;
    } catch (err) {
      console.error('runPendingScreeningsForVacancy: could not queue', application.id, err.message);
    }
  }
  return { queued, total: applications.length };
}

module.exports = {
  screenApplication,
  screenApplicationInBackground,
  analyzeCv,
  getScreeningForApplication,
  listScreeningsForVacancy,
  retryScreening,
  runPendingScreeningsForVacancy,
  ScreeningError,
};
