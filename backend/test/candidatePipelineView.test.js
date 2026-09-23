const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCandidateRow, sortCandidates } = require('../src/utils/candidatePipelineView');

const APPLICATION = { id: 'app-1', full_name: 'Jordan Candidate' };
const VACANCY = { job_title: 'Backend Engineer', department: 'Engineering' };

const THREE_STAGES = [
  { id: 'stage-1', stage_name: 'HR/Behavioural', stage_order: 1, status: 'completed' },
  { id: 'stage-2', stage_name: 'Technical', stage_order: 2, status: 'completed' },
  { id: 'stage-3', stage_name: 'Hiring Manager', stage_order: 3, status: 'pending' },
];

// --- buildCandidateRow: zero / partial / all stages completed --------------

test('zero stages completed: every stage rating is null, average is null', () => {
  const stages = [
    { id: 'stage-1', stage_name: 'HR/Behavioural', stage_order: 1, status: 'scheduled' },
    { id: 'stage-2', stage_name: 'Technical', stage_order: 2, status: 'pending' },
  ];
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: VACANCY,
    screening: { score: 82 },
    stages,
    evaluations: [],
    decision: null,
  });

  assert.equal(row.stages_completed, 0);
  assert.equal(row.stages_total, 2);
  assert.deepEqual(row.stages.map((s) => s.overall_rating), [null, null]);
  assert.equal(row.average_interview_rating, null);
});

test('partial stages completed: only completed-stage ratings feed the average', () => {
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: VACANCY,
    screening: { score: 82 },
    stages: THREE_STAGES,
    evaluations: [
      { stage_id: 'stage-1', overall_rating: 4 },
      { stage_id: 'stage-2', overall_rating: 5 },
      // stage-3 (pending) has no evaluation yet
    ],
    decision: null,
  });

  assert.equal(row.stages_completed, 2);
  assert.equal(row.stages_total, 3);
  assert.deepEqual(row.stages.map((s) => s.overall_rating), [4, 5, null]);
  // Mean of the two COMPLETED stages' overalls: (4 + 5) / 2 = 4.5
  assert.equal(row.average_interview_rating, 4.5);
});

test('a stage with a submitted evaluation but not yet completed still shows its own rating, excluded from the average', () => {
  const stages = [
    { id: 'stage-1', stage_name: 'HR/Behavioural', stage_order: 1, status: 'completed' },
    { id: 'stage-2', stage_name: 'Technical', stage_order: 2, status: 'scheduled' },
  ];
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: VACANCY,
    screening: null,
    stages,
    evaluations: [
      { stage_id: 'stage-1', overall_rating: 4 },
      { stage_id: 'stage-2', overall_rating: 3 }, // one of two interviewers submitted; stage not completed
    ],
    decision: null,
  });

  assert.deepEqual(row.stages.map((s) => s.overall_rating), [4, 3]);
  // stage-2 isn't 'completed', so its rating is excluded from the average.
  assert.equal(row.average_interview_rating, 4);
});

test('all stages completed: every stage has a rating and the average covers all of them', () => {
  const stages = THREE_STAGES.map((s) => ({ ...s, status: 'completed' }));
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: VACANCY,
    screening: { score: 90 },
    stages,
    evaluations: [
      { stage_id: 'stage-1', overall_rating: 4 },
      { stage_id: 'stage-2', overall_rating: 5 },
      { stage_id: 'stage-3', overall_rating: 3 },
    ],
    decision: null,
  });

  assert.equal(row.stages_completed, 3);
  assert.deepEqual(row.stages.map((s) => s.overall_rating), [4, 5, 3]);
  // (4 + 5 + 3) / 3 = 4
  assert.equal(row.average_interview_rating, 4);
});

// --- buildCandidateRow: averaging multiple interviewers per stage ----------

test('a stage rated by multiple interviewers shows the mean of their overalls, rounded to 2dp', () => {
  const stages = [{ id: 'stage-1', stage_name: 'Panel', stage_order: 1, status: 'completed' }];
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: VACANCY,
    screening: null,
    stages,
    evaluations: [
      { stage_id: 'stage-1', overall_rating: 4 },
      { stage_id: 'stage-1', overall_rating: 5 },
      { stage_id: 'stage-1', overall_rating: 4 },
    ],
    decision: null,
  });

  // (4 + 5 + 4) / 3 = 4.333... -> 4.33
  assert.equal(row.stages[0].overall_rating, 4.33);
  assert.equal(row.average_interview_rating, 4.33);
});

// --- buildCandidateRow: null AI score ---------------------------------------

test('a missing screening row yields a null ai_score', () => {
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: VACANCY,
    screening: null,
    stages: [],
    evaluations: [],
    decision: null,
  });
  assert.equal(row.ai_score, null);
});

test('a screening row with a non-numeric score yields a null ai_score', () => {
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: VACANCY,
    screening: { score: null },
    stages: [],
    evaluations: [],
    decision: null,
  });
  assert.equal(row.ai_score, null);
});

test('a completed screening yields its numeric ai_score', () => {
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: VACANCY,
    screening: { score: 77 },
    stages: [],
    evaluations: [],
    decision: null,
  });
  assert.equal(row.ai_score, 77);
});

// --- buildCandidateRow: decision status --------------------------------------

test('no decision yields decision_status "pending"', () => {
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: VACANCY,
    screening: null,
    stages: [],
    evaluations: [],
    decision: null,
  });
  assert.equal(row.decision_status, 'pending');
});

test('an existing decision carries its status through', () => {
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: VACANCY,
    screening: null,
    stages: [],
    evaluations: [],
    decision: { status: 'hired' },
  });
  assert.equal(row.decision_status, 'hired');
});

test('a vacancy-less row degrades gracefully to null job_title/department', () => {
  const row = buildCandidateRow({
    application: APPLICATION,
    vacancy: null,
    screening: null,
    stages: [],
    evaluations: [],
    decision: null,
  });
  assert.equal(row.job_title, null);
  assert.equal(row.department, null);
});

// --- sortCandidates -----------------------------------------------------------

function row(overrides) {
  return {
    application_id: 'x',
    candidate_name: 'x',
    job_title: 'x',
    department: 'x',
    ai_score: null,
    stages: [],
    stages_completed: 0,
    stages_total: 0,
    average_interview_rating: null,
    decision_status: 'pending',
    ...overrides,
  };
}

test('sortCandidates puts decision-pending candidates before decided ones', () => {
  const decided = row({ application_id: 'decided', decision_status: 'hired', ai_score: 99 });
  const pending = row({ application_id: 'pending', decision_status: 'pending', ai_score: 10 });
  const result = sortCandidates([decided, pending]);
  assert.deepEqual(result.map((r) => r.application_id), ['pending', 'decided']);
});

test('sortCandidates orders by average_interview_rating desc within the same decision tier', () => {
  const low = row({ application_id: 'low', average_interview_rating: 3 });
  const high = row({ application_id: 'high', average_interview_rating: 4.5 });
  const result = sortCandidates([low, high]);
  assert.deepEqual(result.map((r) => r.application_id), ['high', 'low']);
});

test('sortCandidates falls back to ai_score desc when average_interview_rating ties', () => {
  const lowScore = row({ application_id: 'low-score', average_interview_rating: 4, ai_score: 50 });
  const highScore = row({ application_id: 'high-score', average_interview_rating: 4, ai_score: 90 });
  const result = sortCandidates([lowScore, highScore]);
  assert.deepEqual(result.map((r) => r.application_id), ['high-score', 'low-score']);
});

test('sortCandidates puts a null average_interview_rating after any numeric value, within the same tier', () => {
  const withRating = row({ application_id: 'has-rating', average_interview_rating: 1 });
  const noRating = row({ application_id: 'no-rating', average_interview_rating: null, ai_score: 99 });
  const result = sortCandidates([noRating, withRating]);
  assert.deepEqual(result.map((r) => r.application_id), ['has-rating', 'no-rating']);
});

test('sortCandidates puts a null ai_score after any numeric value, within the same tier', () => {
  const withScore = row({ application_id: 'has-score', ai_score: 1 });
  const noScore = row({ application_id: 'no-score', ai_score: null });
  const result = sortCandidates([noScore, withScore]);
  assert.deepEqual(result.map((r) => r.application_id), ['has-score', 'no-score']);
});

test('sortCandidates: both null average_interview_rating and null ai_score sort last, in original relative order among themselves', () => {
  const a = row({ application_id: 'a', average_interview_rating: null, ai_score: null });
  const b = row({ application_id: 'b', average_interview_rating: 4, ai_score: null });
  const result = sortCandidates([a, b]);
  assert.deepEqual(result.map((r) => r.application_id), ['b', 'a']);
});

test('sortCandidates does not mutate the input array', () => {
  const rows = [row({ application_id: 'a', average_interview_rating: 1 }), row({ application_id: 'b', average_interview_rating: 2 })];
  const copy = [...rows];
  sortCandidates(rows);
  assert.deepEqual(rows, copy);
});
