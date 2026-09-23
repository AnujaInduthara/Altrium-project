// PB-20 — pure row-shaping for the Hiring Manager's candidate pipeline view.
// No DB access here: hiring.service.js does the (batched) loading and hands
// plain rows to buildCandidateRow(); this module only shapes and sorts.

function round2(n) {
  return Math.round(n * 100) / 100;
}

function average(numbers) {
  if (!numbers || numbers.length === 0) return null;
  return round2(numbers.reduce((sum, n) => sum + n, 0) / numbers.length);
}

// application : { id, full_name }
// vacancy     : { job_title, department } | null
// screening   : { score } | null            (the stored AI screening row, or none yet)
// stages      : [{ id, stage_name, stage_order, status }]   (this candidate's own stages)
// evaluations : [{ stage_id, overall_rating }]              (one entry per interviewer per stage)
// decision    : { status: 'hired'|'rejected' } | null       (null until Step 5.2 exists)
function buildCandidateRow({ application, vacancy, screening, stages, evaluations, decision }) {
  const overallsByStage = new Map();
  for (const evaluation of evaluations || []) {
    if (evaluation.stage_id == null || typeof evaluation.overall_rating !== 'number') continue;
    if (!overallsByStage.has(evaluation.stage_id)) overallsByStage.set(evaluation.stage_id, []);
    overallsByStage.get(evaluation.stage_id).push(evaluation.overall_rating);
  }

  const sortedStages = [...(stages || [])].sort((a, b) => a.stage_order - b.stage_order);

  const stageRows = sortedStages.map((stage) => ({
    stage_name: stage.stage_name,
    stage_order: stage.stage_order,
    status: stage.status,
    overall_rating: average(overallsByStage.get(stage.id)),
  }));

  const completedOveralls = sortedStages
    .map((stage, index) => (stage.status === 'completed' ? stageRows[index].overall_rating : null))
    .filter((rating) => rating !== null);

  return {
    application_id: application.id,
    candidate_name: application.full_name,
    vacancy_id: vacancy?.id ?? null,
    job_title: vacancy?.job_title ?? null,
    department: vacancy?.department ?? null,
    ai_score: typeof screening?.score === 'number' ? screening.score : null,
    stages: stageRows,
    stages_completed: sortedStages.filter((s) => s.status === 'completed').length,
    stages_total: sortedStages.length,
    average_interview_rating: average(completedOveralls),
    decision_status: decision?.status || 'pending',
  };
}

// Descending numeric compare with nulls always last, regardless of direction.
function compareDescNullsLast(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

// decision-pending candidates first, then by average interview rating desc,
// then by AI score desc — nulls last at every tier.
function sortCandidates(rows) {
  return [...rows].sort((a, b) => {
    const pendingA = a.decision_status === 'pending' ? 0 : 1;
    const pendingB = b.decision_status === 'pending' ? 0 : 1;
    if (pendingA !== pendingB) return pendingA - pendingB;

    const byRating = compareDescNullsLast(a.average_interview_rating, b.average_interview_rating);
    if (byRating !== 0) return byRating;

    return compareDescNullsLast(a.ai_score, b.ai_score);
  });
}

module.exports = { buildCandidateRow, sortCandidates };
