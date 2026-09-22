// PB-23 — pure row-shaping for the recruitment pipeline funnel. No DB or
// Express imports: reporting.service.js does the (batched) loading and hands
// plain, already-scoped rows to buildPipeline(); this module only aggregates.
//
// Funnel definition (DEVELOPMENT_PLAN.md Step 6.1) — agreed once, used here
// and nowhere else:
//   Applications  : every application row for an in-range vacancy
//   AI Screening  : applications with a completed screening
//   HR Selected   : status in shortlisted / selected / hired, OR rejected
//                   BUT only after having been selected (a hiring decision
//                   exists) — an early submitted/under_review -> rejected
//                   never reached this stage, so it must not count here
//   Interviews    : applications with >= 1 interview row (any status — the
//                   funnel counts "reached interviews", not "still scheduled")
//   Final Review  : applications with an interview process, every stage
//                   completed or skipped, and no hiring decision yet
//   Hired/Rejected: from hiring_decisions, split by decision

const HR_SELECTED_DIRECT_STATUSES = new Set(['shortlisted', 'selected', 'hired']);

// applications : [{ id, status, stages_total, stages_done }]
//   stages_total/stages_done describe that application's interview process
//   (0/0 for an application that never got one). stages_done counts stages
//   whose status is 'completed' OR 'skipped' — matching the exact
//   "outstanding stage" definition hiringDecision.service.js already uses.
// screenings   : [{ application_id, status }]
// interviews   : [{ application_id }]   — one entry per interview row
// decisions    : [{ application_id, decision }]   — decision: 'hired' | 'rejected'
// vacancies    : [{ id, status }]        — in-range vacancies
function buildPipeline({ applications = [], screenings = [], interviews = [], decisions = [], vacancies = [] } = {}) {
  const screeningByApplication = new Map(screenings.map((s) => [s.application_id, s]));
  const decisionByApplication = new Map(decisions.map((d) => [d.application_id, d]));
  const interviewedApplicationIds = new Set(interviews.map((i) => i.application_id));

  const totalApplications = applications.length;

  const aiScreeningCount = applications.filter(
    (a) => screeningByApplication.get(a.id)?.status === 'completed'
  ).length;

  const hrSelectedCount = applications.filter((a) => {
    if (HR_SELECTED_DIRECT_STATUSES.has(a.status)) return true;
    return a.status === 'rejected' && decisionByApplication.get(a.id)?.decision === 'rejected';
  }).length;

  const interviewsCount = applications.filter((a) => interviewedApplicationIds.has(a.id)).length;

  const finalReviewCount = applications.filter((a) => {
    if (decisionByApplication.has(a.id)) return false; // already decided
    return (a.stages_total ?? 0) > 0 && a.stages_done === a.stages_total;
  }).length;

  const hiredCount = decisions.filter((d) => d.decision === 'hired').length;
  const rejectedCount = decisions.filter((d) => d.decision === 'rejected').length;

  const funnel = [
    { key: 'applications', label: 'Applications', count: totalApplications },
    { key: 'ai_screening', label: 'AI Screening', count: aiScreeningCount },
    { key: 'hr_selected', label: 'HR Selected', count: hrSelectedCount },
    { key: 'interviews', label: 'Interviews', count: interviewsCount },
    { key: 'final_review', label: 'Final Review', count: finalReviewCount },
    { key: 'hired', label: 'Hired', count: hiredCount },
    { key: 'rejected', label: 'Rejected', count: rejectedCount },
  ];

  const openVacanciesCount = vacancies.filter((v) => v.status === 'published').length;
  const shortlistedCount = applications.filter((a) => a.status === 'shortlisted').length;

  return {
    funnel,
    cards: {
      open_vacancies: openVacanciesCount,
      applications: totalApplications,
      shortlisted: shortlistedCount,
      interviews: interviewsCount,
      hired: hiredCount,
      rejected: rejectedCount,
    },
  };
}

// Each row's count as a percentage of the FIRST row's count (the largest,
// widest bar), rounded to the nearest whole percent. Division-by-zero safe:
// an empty/zero first stage yields 0% for every row rather than NaN.
function toFunnelPercentages(funnel = []) {
  const first = funnel[0]?.count || 0;
  return funnel.map((row) => ({
    ...row,
    percentage: first > 0 ? Math.round((row.count / first) * 100) : 0,
  }));
}

// ---------------------------------------------------------------------------
// PB-24 — the recruitment report: totals for the period + a per-vacancy
// breakdown. Shares the HR Selected definition above; adds
// "Interviews Completed" (a count of completed INTERVIEW ROWS, not distinct
// candidates — a vacancy where the same candidate had two completed
// interviews counts 2 here, unlike the funnel's "Interviews" stage which
// counts candidates once regardless of how many interviews they had).
//
// applications : [{ id, status, vacancy_id }]
// screenings   : [{ application_id, status }]
// interviews   : [{ application_id, status }]  — status checked for 'completed'
// decisions    : [{ application_id, decision }]
// vacancies    : [{ id, job_title, department }]  — in-range vacancies
function buildRecruitmentReport({ applications = [], screenings = [], interviews = [], decisions = [], vacancies = [] } = {}) {
  const screeningByApplication = new Map(screenings.map((s) => [s.application_id, s]));
  const decisionByApplication = new Map(decisions.map((d) => [d.application_id, d]));

  const completedInterviewCountByApplication = new Map();
  for (const interview of interviews) {
    if (interview.status !== 'completed') continue;
    completedInterviewCountByApplication.set(
      interview.application_id,
      (completedInterviewCountByApplication.get(interview.application_id) || 0) + 1
    );
  }

  function metricsFor(apps) {
    const aiShortlisted = apps.filter((a) => screeningByApplication.get(a.id)?.status === 'completed').length;
    const hrSelected = apps.filter((a) => {
      if (HR_SELECTED_DIRECT_STATUSES.has(a.status)) return true;
      return a.status === 'rejected' && decisionByApplication.get(a.id)?.decision === 'rejected';
    }).length;
    const interviewsCompleted = apps.reduce(
      (sum, a) => sum + (completedInterviewCountByApplication.get(a.id) || 0),
      0
    );
    const hired = apps.filter((a) => decisionByApplication.get(a.id)?.decision === 'hired').length;
    const rejected = apps.filter((a) => decisionByApplication.get(a.id)?.decision === 'rejected').length;

    return {
      applications: apps.length,
      ai_shortlisted: aiShortlisted,
      hr_selected: hrSelected,
      interviews_completed: interviewsCompleted,
      hired,
      rejected,
    };
  }

  const totals = {
    vacancies_created: vacancies.length,
    ...metricsFor(applications),
  };

  const applicationsByVacancy = new Map();
  for (const application of applications) {
    if (!applicationsByVacancy.has(application.vacancy_id)) applicationsByVacancy.set(application.vacancy_id, []);
    applicationsByVacancy.get(application.vacancy_id).push(application);
  }

  const by_vacancy = [...vacancies]
    .sort((a, b) => (a.job_title || '').localeCompare(b.job_title || ''))
    .map((vacancy) => ({
      job_title: vacancy.job_title,
      department: vacancy.department,
      ...metricsFor(applicationsByVacancy.get(vacancy.id) || []),
    }));

  return { totals, by_vacancy };
}

module.exports = { buildPipeline, toFunnelPercentages, buildRecruitmentReport };
