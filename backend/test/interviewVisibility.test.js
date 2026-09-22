const test = require('node:test');
const assert = require('node:assert/strict');

const { toInterviewerView, filterByScope } = require('../src/utils/interviewerView');

// --- toInterviewerView: the privacy boundary -------------------------------

// A row polluted with every field an interviewer must never see, alongside
// the real, allowed ones — mirrors how a careless `select('*')`-style query
// might look if this weren't an explicit allow-list projection.
const POLLUTED_ROW = {
  id: 'interview-1',
  scheduled_date: '2026-06-15',
  start_time: '10:00',
  end_time: '10:30',
  status: 'scheduled',
  candidate_interview_stages: { stage_name: 'Technical' },
  job_vacancies: { job_title: 'Backend Engineer', department: 'Engineering' },
  applications: { full_name: 'Jordan Candidate', email: 'jordan@example.com', phone: '+1 555 0100' },
  // Forbidden fields that must never reach the interviewer:
  ai_score: 93,
  recommendation: 'STRONG_MATCH',
  matched_skills: ['Node.js', 'PostgreSQL'],
  missing_skills: ['Kubernetes'],
  screening_summary: 'A very strong candidate overall.',
  hr_note: 'Internal: pushy on salary during phone screen.',
  cv_path: 'applications/vacancy-1/secret-cv.pdf',
};

test('toInterviewerView returns only the allowed fields', () => {
  const view = toInterviewerView(POLLUTED_ROW);
  assert.deepEqual(Object.keys(view).sort(), [
    'candidate_name',
    'department',
    'end_time',
    'evaluation_submitted',
    'id',
    'job_title',
    'scheduled_date',
    'stage_name',
    'start_time',
    'status',
  ]);
});

test('toInterviewerView never leaks a forbidden key or its value', () => {
  const view = toInterviewerView(POLLUTED_ROW);
  const serialized = JSON.stringify(view);

  const forbiddenKeys = [
    'ai_score',
    'recommendation',
    'matched_skills',
    'missing_skills',
    'screening_summary',
    'hr_note',
    'cv_path',
  ];
  for (const key of forbiddenKeys) {
    assert.ok(!(key in view), `${key} must not be a key on the interviewer view`);
    assert.ok(!serialized.includes(key), `${key} must not appear anywhere in the serialized view`);
  }

  const forbiddenValues = [
    93,
    'STRONG_MATCH',
    'Node.js',
    'Kubernetes',
    'A very strong candidate overall.',
    'pushy on salary',
    'secret-cv.pdf',
  ];
  for (const value of forbiddenValues) {
    assert.ok(!serialized.includes(String(value)), `${value} must not appear anywhere in the serialized view`);
  }
});

test('toInterviewerView projects the allowed fields correctly', () => {
  const view = toInterviewerView(POLLUTED_ROW);
  assert.deepEqual(view, {
    id: 'interview-1',
    scheduled_date: '2026-06-15',
    start_time: '10:00',
    end_time: '10:30',
    status: 'scheduled',
    stage_name: 'Technical',
    job_title: 'Backend Engineer',
    department: 'Engineering',
    candidate_name: 'Jordan Candidate',
    evaluation_submitted: false,
  });
});

test('toInterviewerView tolerates missing nested relations', () => {
  const view = toInterviewerView({
    id: 'interview-2',
    scheduled_date: '2026-06-16',
    start_time: '09:00',
    end_time: '09:30',
    status: 'scheduled',
  });
  assert.equal(view.stage_name, null);
  assert.equal(view.job_title, null);
  assert.equal(view.department, null);
  assert.equal(view.candidate_name, null);
});

// --- filterByScope: upcoming/past split -------------------------------------

const TODAY = '2026-06-15';

const VIEWS = [
  { id: 'future-scheduled', scheduled_date: '2026-06-20', start_time: '10:00', status: 'scheduled' },
  { id: 'today-scheduled', scheduled_date: '2026-06-15', start_time: '14:00', status: 'scheduled' },
  { id: 'past-scheduled-date', scheduled_date: '2026-06-01', start_time: '10:00', status: 'scheduled' },
  { id: 'completed', scheduled_date: '2026-06-20', start_time: '10:00', status: 'completed' },
  { id: 'cancelled', scheduled_date: '2026-06-20', start_time: '10:00', status: 'cancelled' },
  { id: 'no-show', scheduled_date: '2026-06-01', start_time: '10:00', status: 'no_show' },
];

test('upcoming scope keeps only status=scheduled with a date on/after today', () => {
  const result = filterByScope(VIEWS, 'upcoming', TODAY);
  assert.deepEqual(
    result.map((v) => v.id),
    ['today-scheduled', 'future-scheduled']
  );
});

test('past scope is everything else: completed, cancelled, no_show, and scheduled dates already gone by', () => {
  const result = filterByScope(VIEWS, 'past', TODAY);
  assert.deepEqual(
    result.map((v) => v.id).sort(),
    ['cancelled', 'completed', 'no-show', 'past-scheduled-date'].sort()
  );
});

test('upcoming scope is sorted ascending by date then time', () => {
  const result = filterByScope(
    [
      { id: 'a', scheduled_date: '2026-06-20', start_time: '09:00', status: 'scheduled' },
      { id: 'b', scheduled_date: '2026-06-15', start_time: '16:00', status: 'scheduled' },
      { id: 'c', scheduled_date: '2026-06-15', start_time: '09:00', status: 'scheduled' },
    ],
    'upcoming',
    TODAY
  );
  assert.deepEqual(result.map((v) => v.id), ['c', 'b', 'a']);
});

test('past scope is sorted descending by date then time', () => {
  const result = filterByScope(
    [
      { id: 'a', scheduled_date: '2026-06-01', start_time: '09:00', status: 'completed' },
      { id: 'b', scheduled_date: '2026-06-05', start_time: '09:00', status: 'completed' },
      { id: 'c', scheduled_date: '2026-06-05', start_time: '16:00', status: 'completed' },
    ],
    'past',
    TODAY
  );
  assert.deepEqual(result.map((v) => v.id), ['c', 'b', 'a']);
});

test('an empty list produces an empty result for either scope', () => {
  assert.deepEqual(filterByScope([], 'upcoming', TODAY), []);
  assert.deepEqual(filterByScope([], 'past', TODAY), []);
});
