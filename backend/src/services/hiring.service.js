const { supabaseAdmin } = require('../config/supabase');
const { buildCandidateRow, sortCandidates } = require('../utils/candidatePipelineView');

// A typed, HTTP-aware error the controller translates straight to a
// response — mirrors the *Error classes in the other services.
class HiringError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'HiringError';
    this.isHiringError = true;
    this.code = code;
    this.status = status;
  }
}

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

function uniq(values) {
  return [...new Set(values.filter((v) => v != null))];
}

// Batch-loads every candidate_interview_stage for the given process ids, plus
// (interview_id, candidate_stage_id) -> overall_rating evaluation rows for
// those stages' interviews — in two queries total, regardless of how many
// processes/candidates are involved. Shared by listCandidates (all
// candidates) and getCandidate (one candidate, reusing the same shape).
async function loadStagesAndEvaluations(processIds) {
  if (processIds.length === 0) return { stagesByProcess: new Map(), evaluationsByStage: new Map() };

  const { data: stages, error: stagesError } = await supabaseAdmin
    .from('candidate_interview_stages')
    .select('id, process_id, stage_name, stage_order, status')
    .in('process_id', processIds);
  if (stagesError) throw wrapDbError('Failed to load interview stages', stagesError);

  const stageIds = (stages || []).map((s) => s.id);
  let evaluationsByStage = new Map();

  if (stageIds.length > 0) {
    const { data: interviews, error: interviewsError } = await supabaseAdmin
      .from('interviews')
      .select('id, candidate_stage_id')
      .in('candidate_stage_id', stageIds);
    if (interviewsError) throw wrapDbError('Failed to load interviews', interviewsError);

    const stageIdByInterviewId = new Map((interviews || []).map((i) => [i.id, i.candidate_stage_id]));
    const interviewIds = [...stageIdByInterviewId.keys()];

    if (interviewIds.length > 0) {
      const { data: evaluations, error: evaluationsError } = await supabaseAdmin
        .from('interview_evaluations')
        .select('interview_id, overall_rating')
        .in('interview_id', interviewIds);
      if (evaluationsError) throw wrapDbError('Failed to load interview evaluations', evaluationsError);

      for (const evaluation of evaluations || []) {
        const stageId = stageIdByInterviewId.get(evaluation.interview_id);
        if (stageId == null) continue;
        if (!evaluationsByStage.has(stageId)) evaluationsByStage.set(stageId, []);
        evaluationsByStage.get(stageId).push({ stage_id: stageId, overall_rating: evaluation.overall_rating });
      }
    }
  }

  const stagesByProcess = new Map();
  for (const stage of stages || []) {
    if (!stagesByProcess.has(stage.process_id)) stagesByProcess.set(stage.process_id, []);
    stagesByProcess.get(stage.process_id).push(stage);
  }

  return { stagesByProcess, evaluationsByStage };
}

// PB-20 — every candidate with an interview process, across a SMALL FIXED
// NUMBER of batched queries (no per-candidate loop): processes, then
// applications/vacancies/screenings/stages/evaluations each `in (...)` once.
// `status` filters on the decision status ('pending' until Step 5.2 exists).
async function listCandidates({ vacancyId, status } = {}) {
  let processQuery = supabaseAdmin
    .from('candidate_interview_processes')
    .select('id, application_id, vacancy_id');
  if (vacancyId) processQuery = processQuery.eq('vacancy_id', vacancyId);

  const { data: processes, error: processError } = await processQuery;
  if (processError) throw wrapDbError('Failed to load interview processes', processError);
  if (!processes || processes.length === 0) return [];

  const applicationIds = uniq(processes.map((p) => p.application_id));
  const vacancyIds = uniq(processes.map((p) => p.vacancy_id));
  const processIds = processes.map((p) => p.id);

  const [applicationsResult, vacanciesResult, screeningsResult, { stagesByProcess, evaluationsByStage }] =
    await Promise.all([
      supabaseAdmin.from('applications').select('id, full_name').in('id', applicationIds),
      supabaseAdmin.from('job_vacancies').select('id, job_title, department').in('id', vacancyIds),
      supabaseAdmin.from('application_screenings').select('application_id, score').in('application_id', applicationIds),
      loadStagesAndEvaluations(processIds),
    ]);

  if (applicationsResult.error) throw wrapDbError('Failed to load applications', applicationsResult.error);
  if (vacanciesResult.error) throw wrapDbError('Failed to load vacancies', vacanciesResult.error);
  if (screeningsResult.error) throw wrapDbError('Failed to load screenings', screeningsResult.error);

  const applicationById = new Map((applicationsResult.data || []).map((a) => [a.id, a]));
  const vacancyById = new Map((vacanciesResult.data || []).map((v) => [v.id, v]));
  const screeningByApplication = new Map((screeningsResult.data || []).map((s) => [s.application_id, s]));

  let rows = processes
    .map((process) => {
      const application = applicationById.get(process.application_id);
      if (!application) return null; // defensive: a dangling process should never render a row

      const stages = stagesByProcess.get(process.id) || [];
      const evaluations = stages.flatMap((stage) => evaluationsByStage.get(stage.id) || []);

      return buildCandidateRow({
        application,
        vacancy: vacancyById.get(process.vacancy_id) || null,
        screening: screeningByApplication.get(process.application_id) || null,
        stages,
        evaluations,
        // No hiring_decisions table until Step 5.2 — every candidate is
        // decision-pending for now.
        decision: null,
      });
    })
    .filter(Boolean);

  if (status) {
    rows = rows.filter((r) => r.decision_status === status);
  }

  return sortCandidates(rows);
}

// PB-20 — full detail for one candidate: every stage with its interview
// schedule and every interviewer's evaluation, plus the raw AI screening row
// (the controller shapes it via screening.controller's toScreeningView) and
// the application/vacancy fields the page needs. Explicit column lists only;
// cv_path is never included here (see getCvAccess for the signed-URL path).
async function getCandidate({ applicationId }) {
  const { data: process, error: processError } = await supabaseAdmin
    .from('candidate_interview_processes')
    .select('id, application_id, vacancy_id, interview_level, status')
    .eq('application_id', applicationId)
    .maybeSingle();

  if (processError) {
    if (processError.code === '22P02') {
      throw new HiringError('CANDIDATE_NOT_FOUND', 404, 'This candidate could not be found.');
    }
    throw wrapDbError('Failed to load interview process', processError);
  }
  if (!process) {
    throw new HiringError('CANDIDATE_NOT_FOUND', 404, 'This candidate could not be found.');
  }

  const [applicationResult, vacancyResult, screeningResult, stagesResult] = await Promise.all([
    supabaseAdmin
      .from('applications')
      .select('id, full_name, email, phone, location, status, created_at')
      .eq('id', applicationId)
      .maybeSingle(),
    supabaseAdmin
      .from('job_vacancies')
      .select('id, job_title, department, location, employment_type, experience_level, job_description, job_requirements')
      .eq('id', process.vacancy_id)
      .maybeSingle(),
    supabaseAdmin
      .from('application_screenings')
      .select(
        'status, score, recommendation, candidate_name, skills, matched_skills, missing_skills, ' +
          'experience_match, education_match, summary, score_breakdown, evidence, model_provider, ' +
          'model_name, screening_version, error_code, processing_completed_at, updated_at'
      )
      .eq('application_id', applicationId)
      .maybeSingle(),
    supabaseAdmin
      .from('candidate_interview_stages')
      .select('id, stage_name, stage_order, status, duration_minutes')
      .eq('process_id', process.id)
      .order('stage_order', { ascending: true }),
  ]);

  if (applicationResult.error) throw wrapDbError('Failed to load application', applicationResult.error);
  if (vacancyResult.error) throw wrapDbError('Failed to load vacancy', vacancyResult.error);
  if (screeningResult.error) throw wrapDbError('Failed to load screening', screeningResult.error);
  if (stagesResult.error) throw wrapDbError('Failed to load interview stages', stagesResult.error);

  if (!applicationResult.data) {
    throw new HiringError('CANDIDATE_NOT_FOUND', 404, 'This candidate could not be found.');
  }

  const stages = stagesResult.data || [];
  const stageIds = stages.map((s) => s.id);

  let interviewByStage = new Map();
  let evaluationsByInterview = new Map();

  if (stageIds.length > 0) {
    const { data: interviews, error: interviewsError } = await supabaseAdmin
      .from('interviews')
      .select('id, candidate_stage_id, scheduled_date, start_time, end_time, status')
      .in('candidate_stage_id', stageIds);
    if (interviewsError) throw wrapDbError('Failed to load interviews', interviewsError);

    interviewByStage = new Map((interviews || []).map((i) => [i.candidate_stage_id, i]));
    const interviewIds = (interviews || []).map((i) => i.id);

    if (interviewIds.length > 0) {
      // interviewer_profile_id -> profiles(full_name): a single FK from
      // interview_evaluations to profiles, so the embed resolves unambiguously.
      const { data: evaluations, error: evaluationsError } = await supabaseAdmin
        .from('interview_evaluations')
        .select(
          'interview_id, technical_rating, problem_solving_rating, communication_rating, ' +
            'role_knowledge_rating, overall_rating, comments, submitted_at, profiles!interviewer_profile_id(full_name)'
        )
        .in('interview_id', interviewIds);
      if (evaluationsError) throw wrapDbError('Failed to load interview evaluations', evaluationsError);

      for (const evaluation of evaluations || []) {
        if (!evaluationsByInterview.has(evaluation.interview_id)) {
          evaluationsByInterview.set(evaluation.interview_id, []);
        }
        evaluationsByInterview.get(evaluation.interview_id).push({
          interviewer_name: evaluation.profiles?.full_name || null,
          technical_rating: evaluation.technical_rating,
          problem_solving_rating: evaluation.problem_solving_rating,
          communication_rating: evaluation.communication_rating,
          role_knowledge_rating: evaluation.role_knowledge_rating,
          overall_rating: evaluation.overall_rating,
          comments: evaluation.comments,
          submitted_at: evaluation.submitted_at,
        });
      }
    }
  }

  const stageViews = stages.map((stage) => {
    const interview = interviewByStage.get(stage.id) || null;
    return {
      stage_name: stage.stage_name,
      stage_order: stage.stage_order,
      status: stage.status,
      duration_minutes: stage.duration_minutes,
      interview: interview
        ? {
            scheduled_date: interview.scheduled_date,
            start_time: interview.start_time,
            end_time: interview.end_time,
            status: interview.status,
          }
        : null,
      evaluations: interview ? evaluationsByInterview.get(interview.id) || [] : [],
    };
  });

  return {
    application: applicationResult.data,
    vacancy: vacancyResult.data || null,
    screening: screeningResult.data || null,
    stages: stageViews,
    // No hiring_decisions table until Step 5.2.
    decision: null,
  };
}

// Confirms an application is in the Hiring Manager's pipeline (has an
// interview process) before minting a CV signed URL for it — the Hiring
// Manager equivalent of application.controller.js's HR-owns-vacancy check.
// Reuses application.service.js's own signed-URL mechanism; never a new one.
async function resolveCandidateForCv(applicationId) {
  const { data: process, error } = await supabaseAdmin
    .from('candidate_interview_processes')
    .select('id')
    .eq('application_id', applicationId)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02') {
      throw new HiringError('CANDIDATE_NOT_FOUND', 404, 'This candidate could not be found.');
    }
    throw wrapDbError('Failed to load interview process', error);
  }
  if (!process) {
    throw new HiringError('CANDIDATE_NOT_FOUND', 404, 'This candidate could not be found.');
  }
}

module.exports = { listCandidates, getCandidate, resolveCandidateForCv, HiringError };
