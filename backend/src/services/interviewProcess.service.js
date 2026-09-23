const { supabaseAdmin } = require('../config/supabase');
const applicationService = require('./application.service');
const vacancyService = require('./vacancy.service');
const { APPLICATION_STATUS } = require('../config/applicationOptions');
const { PROCESS_STATUS, LOCKED_STAGE_STATUSES } = require('../config/interviewProcessOptions');

const PROCESS_FIELDS = [
  'id',
  'application_id',
  'vacancy_id',
  'interview_level',
  'status',
  'created_by',
  'created_at',
  'updated_at',
].join(', ');

const STAGE_FIELDS = [
  'id',
  'process_id',
  'stage_id',
  'stage_name',
  'stage_order',
  'duration_minutes',
  'department',
  'minimum_seniority',
  'required_interviewers',
  'status',
  'created_at',
  'updated_at',
].join(', ');

class InterviewProcessError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'InterviewProcessError';
    this.isInterviewProcessError = true;
    this.code = code;
    this.status = status;
  }
}

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

// Loads the application and confirms the caller owns its parent vacancy. An
// application that doesn't exist, or belongs to another HR user, is reported
// identically (404) so nothing about it leaks — mirrors the pattern in
// application.service.js's updateApplicationStatus.
async function resolveOwnedApplication(applicationId, authUserId) {
  const application = await applicationService.getApplicationById(applicationId);
  if (!application) {
    throw new InterviewProcessError('APPLICATION_NOT_FOUND', 404, 'This application could not be found.');
  }

  try {
    const vacancy = await vacancyService.getVacancyForUser(application.vacancy_id, authUserId);
    if (!vacancy) {
      throw new InterviewProcessError('APPLICATION_NOT_FOUND', 404, 'This application could not be found.');
    }
  } catch (err) {
    if (err && err.isVacancyError && err.code === 'FORBIDDEN') {
      throw new InterviewProcessError('APPLICATION_NOT_FOUND', 404, 'This application could not be found.');
    }
    throw err;
  }

  return application;
}

async function fetchProcessByApplicationId(applicationId) {
  const { data, error } = await supabaseAdmin
    .from('candidate_interview_processes')
    .select(PROCESS_FIELDS)
    .eq('application_id', applicationId)
    .maybeSingle();

  if (error) throw wrapDbError('Failed to load interview process', error);
  return data || null;
}

async function fetchProcessById(processId) {
  const { data, error } = await supabaseAdmin
    .from('candidate_interview_processes')
    .select(PROCESS_FIELDS)
    .eq('id', processId)
    .maybeSingle();

  if (error) throw wrapDbError('Failed to load interview process', error);
  return data || null;
}

// Resolves stage -> process, confirming the caller owns the process's
// vacancy. Shared by PB-14 (availability.service.js's findAvailableInterviewers)
// and PB-15/16 (interview.service.js's schedule/cancel) — anything that
// starts from a stage id and needs to prove HR ownership goes through this
// one function, so there is a single definition of that chain. An unknown
// stage or one under another HR user's vacancy is reported identically
// (404), never 403.
async function resolveOwnedStage(stageId, authUserId) {
  const { data: stage, error: stageError } = await supabaseAdmin
    .from('candidate_interview_stages')
    .select(STAGE_FIELDS)
    .eq('id', stageId)
    .maybeSingle();

  if (stageError) {
    if (stageError.code === '22P02') {
      throw new InterviewProcessError('STAGE_NOT_FOUND', 404, 'This interview stage could not be found.');
    }
    throw wrapDbError('Failed to load interview stage', stageError);
  }
  if (!stage) {
    throw new InterviewProcessError('STAGE_NOT_FOUND', 404, 'This interview stage could not be found.');
  }

  const process = await fetchProcessById(stage.process_id);
  if (!process) {
    throw new InterviewProcessError('STAGE_NOT_FOUND', 404, 'This interview stage could not be found.');
  }

  try {
    const vacancy = await vacancyService.getVacancyForUser(process.vacancy_id, authUserId);
    if (!vacancy) {
      throw new InterviewProcessError('STAGE_NOT_FOUND', 404, 'This interview stage could not be found.');
    }
  } catch (err) {
    if (err && err.isVacancyError && err.code === 'FORBIDDEN') {
      throw new InterviewProcessError('STAGE_NOT_FOUND', 404, 'This interview stage could not be found.');
    }
    throw err;
  }

  return { stage, process };
}

async function fetchStagesForProcess(processId) {
  const { data, error } = await supabaseAdmin
    .from('candidate_interview_stages')
    .select(STAGE_FIELDS)
    .eq('process_id', processId)
    .order('stage_order', { ascending: true });

  if (error) throw wrapDbError('Failed to load interview stages', error);
  return data || [];
}

// Prefers vacancy-specific defaults for this level; falls back to the global
// (vacancy_id is null) defaults for the same level.
async function loadStageDefaults(vacancyId, level) {
  const columns =
    'stage_id, stage_order, duration_minutes, department, minimum_seniority, required_interviewers, interview_stages!stage_id(stage_name)';

  const { data: specific, error: specificError } = await supabaseAdmin
    .from('interview_stage_defaults')
    .select(columns)
    .eq('vacancy_id', vacancyId)
    .eq('interview_level', level)
    .order('stage_order', { ascending: true });

  if (specificError) throw wrapDbError('Failed to load interview stage defaults', specificError);
  if (specific && specific.length > 0) return specific;

  const { data: global, error: globalError } = await supabaseAdmin
    .from('interview_stage_defaults')
    .select(columns)
    .is('vacancy_id', null)
    .eq('interview_level', level)
    .order('stage_order', { ascending: true });

  if (globalError) throw wrapDbError('Failed to load global interview stage defaults', globalError);
  return global || [];
}

async function copyDefaultsIntoStages(processId, defaults) {
  if (!defaults || defaults.length === 0) return [];

  const rows = defaults.map((d, index) => ({
    process_id: processId,
    stage_id: d.stage_id,
    // Copied at creation time from the catalogue — never re-derived later,
    // so a subsequent template rename can't rewrite this process's history.
    stage_name: d.interview_stages?.stage_name || '',
    stage_order: index + 1,
    duration_minutes: d.duration_minutes,
    department: d.department,
    minimum_seniority: d.minimum_seniority,
    required_interviewers: d.required_interviewers,
  }));

  const { data, error } = await supabaseAdmin.from('candidate_interview_stages').insert(rows).select(STAGE_FIELDS);

  if (error) throw wrapDbError('Failed to copy interview stages', error);
  // Insert doesn't guarantee return order matches input order; sort explicitly.
  return (data || []).sort((a, b) => a.stage_order - b.stage_order);
}

// PB-09/PB-10: create a candidate's interview process at the chosen level,
// copying the matching defaults (vacancy-specific, else global) as the
// starting stage list. `interviewLevel` must already be validated by the
// caller (see interviewStageValidation.js's validateInterviewLevel).
async function createProcess({ applicationId, interviewLevel, authUserId }) {
  const application = await resolveOwnedApplication(applicationId, authUserId);

  if (application.status !== APPLICATION_STATUS.SELECTED) {
    throw new InterviewProcessError(
      'CANDIDATE_NOT_SELECTED',
      409,
      'This candidate must be selected before an interview process can be created.'
    );
  }

  const { data: process, error } = await supabaseAdmin
    .from('candidate_interview_processes')
    .insert({
      application_id: applicationId,
      vacancy_id: application.vacancy_id,
      interview_level: interviewLevel,
      created_by: authUserId,
    })
    .select(PROCESS_FIELDS)
    .single();

  if (error) {
    // UNIQUE(application_id) is the idempotency guard — rely on it rather
    // than checking-then-inserting, which would race under concurrent calls.
    if (error.code === '23505') {
      throw new InterviewProcessError(
        'PROCESS_EXISTS',
        409,
        'An interview process already exists for this candidate.'
      );
    }
    throw wrapDbError('Failed to create interview process', error);
  }

  const defaults = await loadStageDefaults(application.vacancy_id, interviewLevel);
  const stages = await copyDefaultsIntoStages(process.id, defaults);

  return { process, stages };
}

// PB-10 read: the process + its ordered stages, or { process: null } if one
// hasn't been started yet.
async function getProcess({ applicationId, authUserId }) {
  await resolveOwnedApplication(applicationId, authUserId);

  const process = await fetchProcessByApplicationId(applicationId);
  if (!process) return { process: null, stages: [] };

  const stages = await fetchStagesForProcess(process.id);
  return { process, stages };
}

// PB-11/PB-12: full replacement of the ordered stage list in one call.
// `stages` must already be validated (see interviewStageValidation.js's
// validateStageList) — each item's `stage_order` is already the normalised
// 1..n array position, and `id` (when present) identifies the existing
// candidate_interview_stage row that item edits.
//
// Collision-avoidance approach: a LOCKED row (status scheduled/completed)
// must keep its exact stage_order — enforced below — so it is only ever
// field-edited in place, never deleted or re-inserted; its identity and
// position are never disturbed. Every OTHER existing row (unlocked-and-kept,
// or removed) is deleted, then the caller's non-locked items are inserted
// fresh at their final positions (carrying over a kept row's prior status,
// e.g. 'skipped', so replacing the list doesn't quietly reset it). Because a
// locked row's final position is validated to equal its current one, and the
// full list's positions are a strict 1..n permutation, the freshly-inserted
// rows' target positions can never overlap a locked row's — so this never
// needs a temporary "parking" offset to dodge the (process_id, stage_order)
// unique constraint.
async function replaceStages({ applicationId, stages, authUserId }) {
  await resolveOwnedApplication(applicationId, authUserId);

  const process = await fetchProcessByApplicationId(applicationId);
  if (!process) {
    throw new InterviewProcessError(
      'PROCESS_NOT_FOUND',
      404,
      'This candidate does not have an interview process yet.'
    );
  }

  const existingStages = await fetchStagesForProcess(process.id);
  const existingById = new Map(existingStages.map((s) => [s.id, s]));

  const matchedIds = new Set();
  for (const item of stages) {
    if (item.id && existingById.has(item.id)) matchedIds.add(item.id);
  }

  const removed = existingStages.filter((s) => !matchedIds.has(s.id));
  for (const stage of removed) {
    if (LOCKED_STAGE_STATUSES.includes(stage.status)) {
      throw new InterviewProcessError(
        'STAGE_LOCKED',
        409,
        `The "${stage.stage_name}" stage has already been scheduled and cannot be removed.`
      );
    }
  }

  const lockedUpdates = [];
  const toDeleteIds = removed.map((s) => s.id);
  const toInsert = [];

  stages.forEach((item, index) => {
    const newOrder = index + 1;
    const existing = item.id ? existingById.get(item.id) : null;

    if (existing && LOCKED_STAGE_STATUSES.includes(existing.status)) {
      if (existing.stage_order !== newOrder) {
        throw new InterviewProcessError(
          'STAGE_LOCKED',
          409,
          `The "${existing.stage_name}" stage has already been scheduled and cannot be reordered.`
        );
      }
      lockedUpdates.push({ id: existing.id, item });
    } else if (existing) {
      toDeleteIds.push(existing.id);
      toInsert.push({ ...item, stage_order: newOrder, status: existing.status });
    } else {
      toInsert.push({ ...item, stage_order: newOrder });
    }
  });

  if (toDeleteIds.length > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from('candidate_interview_stages')
      .delete()
      .in('id', toDeleteIds);
    if (deleteError) throw wrapDbError('Failed to replace interview stages', deleteError);
  }

  for (const { id, item } of lockedUpdates) {
    const { error: updateError } = await supabaseAdmin
      .from('candidate_interview_stages')
      .update({
        stage_id: item.stage_id,
        stage_name: item.stage_name,
        duration_minutes: item.duration_minutes,
        department: item.department,
        minimum_seniority: item.minimum_seniority,
        required_interviewers: item.required_interviewers,
      })
      .eq('id', id);
    if (updateError) throw wrapDbError('Failed to update a locked interview stage', updateError);
  }

  if (toInsert.length > 0) {
    const rows = toInsert.map((item) => ({
      process_id: process.id,
      stage_id: item.stage_id,
      stage_name: item.stage_name,
      stage_order: item.stage_order,
      duration_minutes: item.duration_minutes,
      department: item.department,
      minimum_seniority: item.minimum_seniority,
      required_interviewers: item.required_interviewers,
      ...(item.status ? { status: item.status } : {}),
    }));
    const { error: insertError } = await supabaseAdmin.from('candidate_interview_stages').insert(rows);
    if (insertError) throw wrapDbError('Failed to insert interview stages', insertError);
  }

  const finalStages = await fetchStagesForProcess(process.id);
  return { process, stages: finalStages };
}

// Cancels a process (status -> 'cancelled'). Refused if any stage has already
// been scheduled or completed — cancelling would silently orphan a real
// interview.
async function cancelProcess({ applicationId, authUserId }) {
  await resolveOwnedApplication(applicationId, authUserId);

  const process = await fetchProcessByApplicationId(applicationId);
  if (!process) {
    throw new InterviewProcessError(
      'PROCESS_NOT_FOUND',
      404,
      'This candidate does not have an interview process yet.'
    );
  }

  const stages = await fetchStagesForProcess(process.id);
  if (stages.some((s) => LOCKED_STAGE_STATUSES.includes(s.status))) {
    throw new InterviewProcessError(
      'PROCESS_HAS_SCHEDULED_STAGES',
      409,
      'This interview process has stages that have already been scheduled or completed and cannot be cancelled.'
    );
  }

  const { data, error } = await supabaseAdmin
    .from('candidate_interview_processes')
    .update({ status: PROCESS_STATUS.CANCELLED })
    .eq('id', process.id)
    .select(PROCESS_FIELDS)
    .single();

  if (error) throw wrapDbError('Failed to cancel interview process', error);
  return data;
}

module.exports = {
  createProcess,
  getProcess,
  replaceStages,
  cancelProcess,
  resolveOwnedStage,
  InterviewProcessError,
};
