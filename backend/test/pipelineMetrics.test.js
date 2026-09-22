const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPipeline, toFunnelPercentages, buildRecruitmentReport } = require('../src/utils/pipelineMetrics');

const FUNNEL_KEYS = ['applications', 'ai_screening', 'hr_selected', 'interviews', 'final_review', 'hired', 'rejected'];

function countsByKey(funnel) {
  return Object.fromEntries(funnel.map((row) => [row.key, row.count]));
}

// --- empty dataset -----------------------------------------------------

test('an empty dataset produces all-zero counts, no NaN', () => {
  const { funnel, cards } = buildPipeline({});
  assert.deepEqual(
    funnel.map((r) => r.key),
    FUNNEL_KEYS
  );
  for (const row of funnel) {
    assert.equal(row.count, 0);
    assert.equal(Number.isNaN(row.count), false);
  }
  for (const value of Object.values(cards)) {
    assert.equal(value, 0);
    assert.equal(Number.isNaN(value), false);
  }
});

test('buildPipeline() with no arguments at all behaves the same as an empty dataset', () => {
  const { funnel, cards } = buildPipeline();
  assert.equal(countsByKey(funnel).applications, 0);
  assert.equal(cards.applications, 0);
});

// --- a dataset exercising every funnel stage -----------------------------

// Six applications, each demonstrating a different point in the funnel:
//   a1 — submitted, no screening yet                     (Applications only)
//   a2 — screening completed, still submitted            (+ AI Screening)
//   a3 — shortlisted (HR Selected, no interview yet)
//   a4 — selected, one interview scheduled (not finished) (+ Interviews)
//   a5 — selected, every stage completed/skipped, no decision yet (Final Review)
//   a6 — hired (decided)
//   a7 — rejected AFTER being selected (a real hiring decision)
//   a8 — rejected EARLY (never selected) — must NOT count as HR Selected
const APPLICATIONS = [
  { id: 'a1', status: 'submitted', stages_total: 0, stages_done: 0 },
  { id: 'a2', status: 'submitted', stages_total: 0, stages_done: 0 },
  { id: 'a3', status: 'shortlisted', stages_total: 0, stages_done: 0 },
  { id: 'a4', status: 'selected', stages_total: 2, stages_done: 1 },
  { id: 'a5', status: 'selected', stages_total: 2, stages_done: 2 },
  { id: 'a6', status: 'hired', stages_total: 1, stages_done: 1 },
  { id: 'a7', status: 'rejected', stages_total: 1, stages_done: 1 },
  { id: 'a8', status: 'rejected', stages_total: 0, stages_done: 0 },
];

const SCREENINGS = [
  { application_id: 'a2', status: 'completed' },
  { application_id: 'a1', status: 'pending' },
];

const INTERVIEWS = [{ application_id: 'a4' }, { application_id: 'a5' }, { application_id: 'a6' }, { application_id: 'a7' }];

const DECISIONS = [
  { application_id: 'a6', decision: 'hired' },
  { application_id: 'a7', decision: 'rejected' },
];

const VACANCIES = [
  { id: 'v1', status: 'published' },
  { id: 'v2', status: 'published' },
  { id: 'v3', status: 'draft' },
  { id: 'v4', status: 'closed' },
];

test('every funnel stage is counted correctly against a mixed dataset', () => {
  const { funnel, cards } = buildPipeline({
    applications: APPLICATIONS,
    screenings: SCREENINGS,
    interviews: INTERVIEWS,
    decisions: DECISIONS,
    vacancies: VACANCIES,
  });
  const counts = countsByKey(funnel);

  assert.equal(counts.applications, 8);
  assert.equal(counts.ai_screening, 1); // only a2
  // HR Selected: a3 (shortlisted), a4 (selected), a5 (selected), a6 (hired),
  // a7 (rejected-after-selection) — but NOT a8 (rejected, never selected).
  assert.equal(counts.hr_selected, 5);
  // Interviews: a4, a5, a6, a7 each have >= 1 interview row.
  assert.equal(counts.interviews, 4);
  // Final Review: only a5 — every stage done, no decision yet. a4 has an
  // outstanding stage; a6/a7 already have a decision.
  assert.equal(counts.final_review, 1);
  assert.equal(counts.hired, 1);
  assert.equal(counts.rejected, 1);

  assert.equal(cards.open_vacancies, 2); // v1, v2 — not the draft or closed one
  assert.equal(cards.applications, 8);
  assert.equal(cards.shortlisted, 1); // a3 only
  assert.equal(cards.interviews, 4);
  assert.equal(cards.hired, 1);
  assert.equal(cards.rejected, 1);
});

// --- candidates counted once even with multiple interviews -----------------

test('an application with several interview rows is still counted once in Interviews', () => {
  const { funnel } = buildPipeline({
    applications: [{ id: 'a1', status: 'selected', stages_total: 3, stages_done: 2 }],
    interviews: [{ application_id: 'a1' }, { application_id: 'a1' }, { application_id: 'a1' }],
  });
  assert.equal(countsByKey(funnel).interviews, 1);
});

// --- decisions split hired/rejected correctly -------------------------------

test('decisions split cleanly into hired and rejected, order-independent', () => {
  const { funnel, cards } = buildPipeline({
    applications: [
      { id: 'a1', status: 'hired', stages_total: 1, stages_done: 1 },
      { id: 'a2', status: 'rejected', stages_total: 1, stages_done: 1 },
      { id: 'a3', status: 'hired', stages_total: 1, stages_done: 1 },
    ],
    decisions: [
      { application_id: 'a1', decision: 'hired' },
      { application_id: 'a2', decision: 'rejected' },
      { application_id: 'a3', decision: 'hired' },
    ],
  });
  const counts = countsByKey(funnel);
  assert.equal(counts.hired, 2);
  assert.equal(counts.rejected, 1);
  assert.equal(cards.hired, 2);
  assert.equal(cards.rejected, 1);
});

// --- an application never reaching a process has no Final Review risk ------

test('an application with no interview process is never counted in Final Review', () => {
  const { funnel } = buildPipeline({
    applications: [{ id: 'a1', status: 'submitted', stages_total: 0, stages_done: 0 }],
  });
  assert.equal(countsByKey(funnel).final_review, 0);
});

test('a skipped stage counts toward "all stages done", same as completed', () => {
  const { funnel } = buildPipeline({
    applications: [{ id: 'a1', status: 'selected', stages_total: 2, stages_done: 2 }],
  });
  assert.equal(countsByKey(funnel).final_review, 1);
});

// --- toFunnelPercentages -----------------------------------------------------

test('toFunnelPercentages expresses every row as a percentage of the first', () => {
  const funnel = [
    { key: 'applications', label: 'Applications', count: 100 },
    { key: 'ai_screening', label: 'AI Screening', count: 50 },
    { key: 'hr_selected', label: 'HR Selected', count: 25 },
  ];
  const result = toFunnelPercentages(funnel);
  assert.deepEqual(
    result.map((r) => r.percentage),
    [100, 50, 25]
  );
});

test('toFunnelPercentages guards against division by zero when the first stage is zero', () => {
  const funnel = [
    { key: 'applications', label: 'Applications', count: 0 },
    { key: 'ai_screening', label: 'AI Screening', count: 0 },
  ];
  const result = toFunnelPercentages(funnel);
  for (const row of result) {
    assert.equal(row.percentage, 0);
    assert.equal(Number.isNaN(row.percentage), false);
  }
});

test('toFunnelPercentages rounds to the nearest whole percent', () => {
  const funnel = [
    { key: 'applications', label: 'Applications', count: 3 },
    { key: 'ai_screening', label: 'AI Screening', count: 1 },
  ];
  const result = toFunnelPercentages(funnel);
  // 1/3 = 33.33...% -> rounds to 33
  assert.equal(result[1].percentage, 33);
});

test('toFunnelPercentages on an empty funnel array returns an empty array', () => {
  assert.deepEqual(toFunnelPercentages([]), []);
});

// ---------------------------------------------------------------------------
// PB-24 — buildRecruitmentReport
// ---------------------------------------------------------------------------

test('an empty dataset produces all-zero totals and an empty by_vacancy list', () => {
  const { totals, by_vacancy } = buildRecruitmentReport({});
  assert.deepEqual(totals, {
    vacancies_created: 0,
    applications: 0,
    ai_shortlisted: 0,
    hr_selected: 0,
    interviews_completed: 0,
    hired: 0,
    rejected: 0,
  });
  assert.deepEqual(by_vacancy, []);
});

test('totals aggregate across every vacancy, and by_vacancy breaks the same numbers down per vacancy', () => {
  const vacancies = [
    { id: 'v1', job_title: 'Backend Engineer', department: 'Engineering' },
    { id: 'v2', job_title: 'Recruiter', department: 'People' },
  ];
  const applications = [
    { id: 'a1', status: 'hired', vacancy_id: 'v1' },
    { id: 'a2', status: 'rejected', vacancy_id: 'v1' }, // rejected after selection
    { id: 'a3', status: 'submitted', vacancy_id: 'v2' },
  ];
  const screenings = [
    { application_id: 'a1', status: 'completed' },
    { application_id: 'a2', status: 'completed' },
  ];
  const interviews = [
    { application_id: 'a1', status: 'completed' },
    { application_id: 'a1', status: 'completed' }, // a second completed interview for the same candidate
    { application_id: 'a2', status: 'scheduled' }, // not completed — must not count
  ];
  const decisions = [
    { application_id: 'a1', decision: 'hired' },
    { application_id: 'a2', decision: 'rejected' },
  ];

  const { totals, by_vacancy } = buildRecruitmentReport({ applications, screenings, interviews, decisions, vacancies });

  assert.equal(totals.vacancies_created, 2);
  assert.equal(totals.applications, 3);
  assert.equal(totals.ai_shortlisted, 2);
  assert.equal(totals.hr_selected, 2); // a1 (hired), a2 (rejected-after-selection) — not a3
  assert.equal(totals.interviews_completed, 2); // both of a1's completed interviews
  assert.equal(totals.hired, 1);
  assert.equal(totals.rejected, 1);

  // Sorted alphabetically by job_title: Backend Engineer before Recruiter.
  assert.deepEqual(
    by_vacancy.map((v) => v.job_title),
    ['Backend Engineer', 'Recruiter']
  );

  const backend = by_vacancy.find((v) => v.job_title === 'Backend Engineer');
  assert.equal(backend.department, 'Engineering');
  assert.equal(backend.applications, 2);
  assert.equal(backend.ai_shortlisted, 2);
  assert.equal(backend.hr_selected, 2);
  assert.equal(backend.interviews_completed, 2);
  assert.equal(backend.hired, 1);
  assert.equal(backend.rejected, 1);

  const recruiter = by_vacancy.find((v) => v.job_title === 'Recruiter');
  assert.equal(recruiter.applications, 1);
  assert.equal(recruiter.ai_shortlisted, 0);
  assert.equal(recruiter.hr_selected, 0);
  assert.equal(recruiter.interviews_completed, 0);
  assert.equal(recruiter.hired, 0);
  assert.equal(recruiter.rejected, 0);
});

test('a vacancy with zero applications still appears in by_vacancy, all zeros', () => {
  const { by_vacancy } = buildRecruitmentReport({
    vacancies: [{ id: 'v1', job_title: 'Untouched Role', department: 'Ops' }],
  });
  assert.equal(by_vacancy.length, 1);
  assert.equal(by_vacancy[0].applications, 0);
  assert.equal(by_vacancy[0].hired, 0);
});

test('an early rejection (never selected) does not count as hr_selected in the report either', () => {
  const { totals } = buildRecruitmentReport({
    applications: [{ id: 'a1', status: 'rejected', vacancy_id: 'v1' }],
    vacancies: [{ id: 'v1', job_title: 'Role', department: 'Dept' }],
  });
  assert.equal(totals.hr_selected, 0);
});
