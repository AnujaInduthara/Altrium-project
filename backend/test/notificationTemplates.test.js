const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildInterviewScheduledForCandidate,
  buildInterviewCancelledForCandidate,
  buildInterviewScheduledForInterviewer,
  buildInterviewCancelledForInterviewer,
  buildDecisionForHr,
  buildDecisionForCandidate,
} = require('../src/utils/notificationTemplates');

const BASE_CTX = {
  vacancyTitle: 'Senior Backend Engineer',
  stageName: 'Technical Interview',
  scheduledDate: '2026-06-20',
  startTime: '14:00',
  durationMinutes: 45,
  candidateName: 'Priya Fernando',
  interviewerName: 'Sam Perera',
};

// A context polluted with everything a candidate must never see. Each value
// is distinctive enough that its presence anywhere in the serialized output
// would be unambiguous.
const POLLUTED_CTX = {
  ...BASE_CTX,
  ai_score: 87,
  rank: 3,
  recommendation: 'STRONG_MATCH',
  matched_skills: ['Python', 'PostgreSQL'],
  missing_skills: ['Kubernetes'],
  screening_summary: 'CONFIDENTIAL_SCREENING_SUMMARY_TEXT',
  interviewer_comments: 'CONFIDENTIAL_INTERVIEWER_COMMENT_TEXT',
  hr_note: 'CONFIDENTIAL_HR_NOTE_TEXT',
  other_candidates: ['CONFIDENTIAL_OTHER_CANDIDATE_ONE', 'CONFIDENTIAL_OTHER_CANDIDATE_TWO'],
  application_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  vacancy_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  candidate_stage_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
};

const FORBIDDEN_VALUES = [
  'ai_score',
  '87',
  'rank',
  'STRONG_MATCH',
  'Kubernetes',
  'CONFIDENTIAL_SCREENING_SUMMARY_TEXT',
  'CONFIDENTIAL_INTERVIEWER_COMMENT_TEXT',
  'CONFIDENTIAL_HR_NOTE_TEXT',
  'CONFIDENTIAL_OTHER_CANDIDATE_ONE',
  'CONFIDENTIAL_OTHER_CANDIDATE_TWO',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
];

// --- allowed-keys shape ---------------------------------------------------

const ALLOWED_CANDIDATE_PAYLOAD_KEYS = [
  'job_title',
  'stage_name',
  'scheduled_date',
  'start_time',
  'duration_minutes',
].sort();

test('scheduled candidate payload contains exactly the allowed keys', () => {
  const { payload } = buildInterviewScheduledForCandidate(BASE_CTX);
  assert.deepEqual(Object.keys(payload).sort(), ALLOWED_CANDIDATE_PAYLOAD_KEYS);
});

test('cancelled candidate payload contains exactly the allowed keys', () => {
  const { payload } = buildInterviewCancelledForCandidate(BASE_CTX);
  assert.deepEqual(Object.keys(payload).sort(), ALLOWED_CANDIDATE_PAYLOAD_KEYS);
});

test('scheduled candidate payload carries the right values', () => {
  const { type, title, payload } = buildInterviewScheduledForCandidate(BASE_CTX);
  assert.equal(type, 'interview_scheduled_candidate');
  assert.match(title, /scheduled/i);
  assert.equal(payload.job_title, 'Senior Backend Engineer');
  assert.equal(payload.stage_name, 'Technical Interview');
  assert.equal(payload.scheduled_date, '2026-06-20');
  assert.equal(payload.start_time, '14:00');
  assert.equal(payload.duration_minutes, 45);
});

// --- privacy boundary: polluted context never leaks ------------------------

test('a polluted context never leaks into the scheduled candidate notification', () => {
  const result = buildInterviewScheduledForCandidate(POLLUTED_CTX);
  const serialized = JSON.stringify(result);
  for (const forbidden of FORBIDDEN_VALUES) {
    assert.ok(!serialized.includes(forbidden), `leaked forbidden value: ${forbidden}`);
  }
  assert.deepEqual(Object.keys(result.payload).sort(), ALLOWED_CANDIDATE_PAYLOAD_KEYS);
});

test('a polluted context never leaks into the cancelled candidate notification', () => {
  const result = buildInterviewCancelledForCandidate(POLLUTED_CTX);
  const serialized = JSON.stringify(result);
  for (const forbidden of FORBIDDEN_VALUES) {
    assert.ok(!serialized.includes(forbidden), `leaked forbidden value: ${forbidden}`);
  }
  assert.deepEqual(Object.keys(result.payload).sort(), ALLOWED_CANDIDATE_PAYLOAD_KEYS);
});

test('a polluted context never leaks into the scheduled interviewer notification', () => {
  const result = buildInterviewScheduledForInterviewer(POLLUTED_CTX);
  const serialized = JSON.stringify(result);
  for (const forbidden of FORBIDDEN_VALUES) {
    assert.ok(!serialized.includes(forbidden), `leaked forbidden value: ${forbidden}`);
  }
});

test('a polluted context never leaks into the cancelled interviewer notification', () => {
  const result = buildInterviewCancelledForInterviewer(POLLUTED_CTX);
  const serialized = JSON.stringify(result);
  for (const forbidden of FORBIDDEN_VALUES) {
    assert.ok(!serialized.includes(forbidden), `leaked forbidden value: ${forbidden}`);
  }
});

// --- interviewer templates: sanity (not a privacy boundary, but shouldn't
// be broken by candidate-name inclusion) -----------------------------------

test('interviewer notifications include the candidate name', () => {
  const scheduled = buildInterviewScheduledForInterviewer(BASE_CTX);
  const cancelled = buildInterviewCancelledForInterviewer(BASE_CTX);
  assert.equal(scheduled.payload.candidate_name, 'Priya Fernando');
  assert.equal(cancelled.payload.candidate_name, 'Priya Fernando');
});

// --- missing/partial context degrades gracefully, never throws -------------

test('an empty context never throws and produces sensible fallbacks', () => {
  for (const builder of [
    buildInterviewScheduledForCandidate,
    buildInterviewCancelledForCandidate,
    buildInterviewScheduledForInterviewer,
    buildInterviewCancelledForInterviewer,
  ]) {
    assert.doesNotThrow(() => builder({}));
    assert.doesNotThrow(() => builder(undefined));
    const { type, title, body, payload } = builder({});
    assert.ok(type);
    assert.ok(title);
    assert.ok(body);
    assert.ok(payload && typeof payload === 'object');
  }
});

// ---------------------------------------------------------------------------
// PB-22 — the final hiring decision templates.
// ---------------------------------------------------------------------------

const DECISION_BASE_CTX = {
  candidateName: 'Priya Fernando',
  vacancyTitle: 'Senior Backend Engineer',
  decision: 'hired',
  decidedAt: '2026-06-20T15:30:00.000Z',
  decidedByName: 'Alex Manager',
};

// A context polluted with everything the candidate must never see, matching
// the interviewer-feedback-era data this notification is triggered by.
const DECISION_POLLUTED_CTX = {
  ...DECISION_BASE_CTX,
  ai_score: 91,
  rank: 2,
  interviewer_comments: 'CONFIDENTIAL_INTERVIEWER_COMMENT_TEXT_DECISION',
  ratings: { technical: 5, communication: 4 },
  reason: 'CONFIDENTIAL_DECISION_REASON_TEXT',
  hr_note: 'CONFIDENTIAL_HR_NOTE_TEXT_DECISION',
  other_candidates: ['CONFIDENTIAL_OTHER_CANDIDATE_DECISION_ONE'],
  application_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
};

const DECISION_FORBIDDEN_VALUES = [
  'ai_score',
  '91',
  'rank',
  'CONFIDENTIAL_INTERVIEWER_COMMENT_TEXT_DECISION',
  'technical',
  'CONFIDENTIAL_DECISION_REASON_TEXT',
  'CONFIDENTIAL_HR_NOTE_TEXT_DECISION',
  'CONFIDENTIAL_OTHER_CANDIDATE_DECISION_ONE',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
];

const ALLOWED_DECISION_CANDIDATE_PAYLOAD_KEYS = ['job_title', 'decision'].sort();

test('hired candidate decision payload contains exactly the allowed keys', () => {
  const { payload } = buildDecisionForCandidate({ ...DECISION_BASE_CTX, decision: 'hired' });
  assert.deepEqual(Object.keys(payload).sort(), ALLOWED_DECISION_CANDIDATE_PAYLOAD_KEYS);
});

test('rejected candidate decision payload contains exactly the allowed keys', () => {
  const { payload } = buildDecisionForCandidate({ ...DECISION_BASE_CTX, decision: 'rejected' });
  assert.deepEqual(Object.keys(payload).sort(), ALLOWED_DECISION_CANDIDATE_PAYLOAD_KEYS);
});

test('hired candidate message is a short congratulations naming only the job title', () => {
  const { title, body, payload } = buildDecisionForCandidate({ ...DECISION_BASE_CTX, decision: 'hired' });
  assert.match(`${title} ${body}`, /congratulations/i);
  assert.ok(body.includes('Senior Backend Engineer'));
  assert.equal(payload.job_title, 'Senior Backend Engineer');
  assert.equal(payload.decision, 'hired');
  // The candidate's own name isn't needed in a message addressed to them —
  // and buildDecisionForCandidate never reads ctx.candidateName at all.
  assert.ok(!body.includes('Priya Fernando'));
});

test('rejected candidate message is a short, respectful thank-you naming only the job title', () => {
  const { body, payload } = buildDecisionForCandidate({ ...DECISION_BASE_CTX, decision: 'rejected' });
  assert.match(body, /thank/i);
  assert.ok(body.includes('Senior Backend Engineer'));
  assert.equal(payload.decision, 'rejected');
});

test('a polluted context never leaks into the hired candidate decision notification', () => {
  const result = buildDecisionForCandidate({ ...DECISION_POLLUTED_CTX, decision: 'hired' });
  const serialized = JSON.stringify(result);
  for (const forbidden of DECISION_FORBIDDEN_VALUES) {
    assert.ok(!serialized.includes(forbidden), `leaked forbidden value: ${forbidden}`);
  }
  assert.deepEqual(Object.keys(result.payload).sort(), ALLOWED_DECISION_CANDIDATE_PAYLOAD_KEYS);
});

test('a polluted context never leaks into the rejected candidate decision notification', () => {
  const result = buildDecisionForCandidate({ ...DECISION_POLLUTED_CTX, decision: 'rejected' });
  const serialized = JSON.stringify(result);
  for (const forbidden of DECISION_FORBIDDEN_VALUES) {
    assert.ok(!serialized.includes(forbidden), `leaked forbidden value: ${forbidden}`);
  }
  assert.deepEqual(Object.keys(result.payload).sort(), ALLOWED_DECISION_CANDIDATE_PAYLOAD_KEYS);
});

// HR is not a privacy boundary here — it may include who decided and when.
test('HR decision notification includes the candidate name, decider and timing', () => {
  const hired = buildDecisionForHr({ ...DECISION_BASE_CTX, decision: 'hired' });
  assert.equal(hired.payload.candidate_name, 'Priya Fernando');
  assert.equal(hired.payload.job_title, 'Senior Backend Engineer');
  assert.equal(hired.payload.decision, 'hired');
  assert.equal(hired.payload.decided_by_name, 'Alex Manager');
  assert.match(hired.body, /Priya Fernando/);
  assert.match(hired.body, /selected/i);
  assert.ok(hired.body.includes('Senior Backend Engineer'));

  const rejected = buildDecisionForHr({ ...DECISION_BASE_CTX, decision: 'rejected' });
  assert.match(rejected.body, /not selected/i);
});

test('an empty decision context never throws and produces sensible fallbacks', () => {
  for (const builder of [buildDecisionForHr, buildDecisionForCandidate]) {
    assert.doesNotThrow(() => builder({}));
    assert.doesNotThrow(() => builder(undefined));
    const { type, title, body, payload } = builder({});
    assert.ok(type);
    assert.ok(title);
    assert.ok(body);
    assert.ok(payload && typeof payload === 'object');
  }
});
