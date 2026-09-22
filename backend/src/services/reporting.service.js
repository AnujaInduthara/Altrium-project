const { supabaseAdmin } = require('../config/supabase');
const { buildPipeline, toFunnelPercentages, buildRecruitmentReport } = require('../utils/pipelineMetrics');

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

// Shared scoping rule for both report endpoints: 'management' sees every
// vacancy; anyone else (in practice only 'hr', per the route's requireRole)
// sees only vacancies they created. job_vacancies.created_by is an auth.users
// id, not a profiles id, so the caller's authUserId (not profileId) is what
// scopes it.
async function loadScopedVacancies(columns, { from, to, vacancyId, requesterProfile }) {
  let query = supabaseAdmin
    .from('job_vacancies')
    .select(columns)
    .gte('created_at', `${from}T00:00:00.000Z`)
    .lte('created_at', `${to}T23:59:59.999Z`);

  if (requesterProfile.role !== 'management') {
    query = query.eq('created_by', requesterProfile.authUserId);
  }
  if (vacancyId) {
    query = query.eq('id', vacancyId);
  }

  const { data, error } = await query;
  if (error) throw wrapDbError('Failed to load vacancies', error);
  return data || [];
}

// PB-23 — the recruitment pipeline funnel + summary cards, across a SMALL
// FIXED NUMBER of batched queries (no per-vacancy loop): vacancies, then
// applications/screenings/interviews/decisions/processes/stages each
// `in (...)` once. Never selects applicant PII, CV fields or screening text
// — only the ids and status columns the metrics need.
async function getPipeline({ from, to, vacancyId, requesterProfile }) {
  const range = { from, to };

  const vacancies = await loadScopedVacancies('id, status', { from, to, vacancyId, requesterProfile });
  if (vacancies.length === 0) return emptyPipeline([], range);

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

// PB-24 — the recruitment report: period totals + a per-vacancy breakdown.
// Same role scoping and batching approach as getPipeline; never selects
// applicant PII, CV fields or screening text — only ids, status, job_title
// and department.
async function getRecruitmentReport({ from, to, vacancyId, requesterProfile }) {
  const period = { from, to };

  const vacancies = await loadScopedVacancies('id, job_title, department', {
    from,
    to,
    vacancyId,
    requesterProfile,
  });
  if (vacancies.length === 0) {
    return { period, ...buildRecruitmentReport({ vacancies: [] }) };
  }

  const vacancyIds = vacancies.map((v) => v.id);

  const { data: applicationsRaw, error: applicationsError } = await supabaseAdmin
    .from('applications')
    .select('id, status, vacancy_id')
    .in('vacancy_id', vacancyIds);
  if (applicationsError) throw wrapDbError('Failed to load applications', applicationsError);
  if (!applicationsRaw || applicationsRaw.length === 0) {
    return { period, ...buildRecruitmentReport({ vacancies }) };
  }

  const applicationIds = applicationsRaw.map((a) => a.id);

  const [screeningsResult, interviewsResult, decisionsResult] = await Promise.all([
    supabaseAdmin.from('application_screenings').select('application_id, status').in('application_id', applicationIds),
    supabaseAdmin.from('interviews').select('application_id, status').in('application_id', applicationIds),
    supabaseAdmin.from('hiring_decisions').select('application_id, decision').in('application_id', applicationIds),
  ]);

  if (screeningsResult.error) throw wrapDbError('Failed to load screenings', screeningsResult.error);
  if (interviewsResult.error) throw wrapDbError('Failed to load interviews', interviewsResult.error);
  if (decisionsResult.error) throw wrapDbError('Failed to load hiring decisions', decisionsResult.error);

  const report = buildRecruitmentReport({
    applications: applicationsRaw,
    screenings: screeningsResult.data || [],
    interviews: interviewsResult.data || [],
    decisions: decisionsResult.data || [],
    vacancies,
  });

  return { period, ...report };
}

module.exports = { getPipeline, getRecruitmentReport, ReportingError };
