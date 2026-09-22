const { supabaseAdmin } = require('../config/supabase');
const { buildPipeline, toFunnelPercentages } = require('../utils/pipelineMetrics');

class ReportingError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'ReportingError';
    this.isReportingError = true;
    this.code = code;
    this.status = status;
  }
}

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

function emptyPipeline(vacancies, range) {
  const pipeline = buildPipeline({ vacancies });
  return { range, funnel: toFunnelPercentages(pipeline.funnel), cards: pipeline.cards };
}

// PB-23 — the recruitment pipeline funnel + summary cards, across a SMALL
// FIXED NUMBER of batched queries (no per-vacancy loop): vacancies, then
// applications/screenings/interviews/decisions/processes/stages each
// `in (...)` once. Never selects applicant PII, CV fields or screening text
// — only the ids and status columns the metrics need.
//
//   requesterProfile.role       : 'management' sees every vacancy;
//                                 'hr' sees only vacancies they created.
//   requesterProfile.authUserId : the caller's auth.users id (job_vacancies
//                                 .created_by is an auth id, not a profile id).
async function getPipeline({ from, to, vacancyId, requesterProfile }) {
  const range = { from, to };

  let vacancyQuery = supabaseAdmin
    .from('job_vacancies')
    .select('id, status')
    .gte('created_at', `${from}T00:00:00.000Z`)
    .lte('created_at', `${to}T23:59:59.999Z`);

  if (requesterProfile.role !== 'management') {
    vacancyQuery = vacancyQuery.eq('created_by', requesterProfile.authUserId);
  }
  if (vacancyId) {
    vacancyQuery = vacancyQuery.eq('id', vacancyId);
  }

  const { data: vacancies, error: vacancyError } = await vacancyQuery;
  if (vacancyError) throw wrapDbError('Failed to load vacancies', vacancyError);
  if (!vacancies || vacancies.length === 0) return emptyPipeline([], range);

  const vacancyIds = vacancies.map((v) => v.id);

  const { data: applicationsRaw, error: applicationsError } = await supabaseAdmin
    .from('applications')
    .select('id, status')
    .in('vacancy_id', vacancyIds);
  if (applicationsError) throw wrapDbError('Failed to load applications', applicationsError);
  if (!applicationsRaw || applicationsRaw.length === 0) return emptyPipeline(vacancies, range);

  const applicationIds = applicationsRaw.map((a) => a.id);

  const [screeningsResult, interviewsResult, decisionsResult, processesResult] = await Promise.all([
    supabaseAdmin.from('application_screenings').select('application_id, status').in('application_id', applicationIds),
    supabaseAdmin.from('interviews').select('application_id').in('application_id', applicationIds),
    supabaseAdmin.from('hiring_decisions').select('application_id, decision').in('application_id', applicationIds),
    supabaseAdmin.from('candidate_interview_processes').select('id, application_id').in('application_id', applicationIds),
  ]);

  if (screeningsResult.error) throw wrapDbError('Failed to load screenings', screeningsResult.error);
  if (interviewsResult.error) throw wrapDbError('Failed to load interviews', interviewsResult.error);
  if (decisionsResult.error) throw wrapDbError('Failed to load hiring decisions', decisionsResult.error);
  if (processesResult.error) throw wrapDbError('Failed to load interview processes', processesResult.error);

  const processes = processesResult.data || [];
  const processIdByApplication = new Map(processes.map((p) => [p.application_id, p.id]));
  const processIds = processes.map((p) => p.id);

  let stagesByProcess = new Map();
  if (processIds.length > 0) {
    const { data: stages, error: stagesError } = await supabaseAdmin
      .from('candidate_interview_stages')
      .select('process_id, status')
      .in('process_id', processIds);
    if (stagesError) throw wrapDbError('Failed to load interview stages', stagesError);

    for (const stage of stages || []) {
      if (!stagesByProcess.has(stage.process_id)) stagesByProcess.set(stage.process_id, []);
      stagesByProcess.get(stage.process_id).push(stage);
    }
  }

  // Same "outstanding stage" definition hiringDecision.service.js already
  // uses (status !== 'completed' && status !== 'skipped' means outstanding).
  const applications = applicationsRaw.map((a) => {
    const processId = processIdByApplication.get(a.id);
    const stages = processId ? stagesByProcess.get(processId) || [] : [];
    return {
      id: a.id,
      status: a.status,
      stages_total: stages.length,
      stages_done: stages.filter((s) => s.status === 'completed' || s.status === 'skipped').length,
    };
  });

  const pipeline = buildPipeline({
    applications,
    screenings: screeningsResult.data || [],
    interviews: interviewsResult.data || [],
    decisions: decisionsResult.data || [],
    vacancies,
  });

  return { range, funnel: toFunnelPercentages(pipeline.funnel), cards: pipeline.cards };
}

module.exports = { getPipeline, ReportingError };
