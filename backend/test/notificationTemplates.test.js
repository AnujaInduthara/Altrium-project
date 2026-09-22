const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildInterviewScheduledForCandidate,
  buildInterviewCancelledForCandidate,
  buildInterviewScheduledForInterviewer,
  buildInterviewCancelledForInterviewer,
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
