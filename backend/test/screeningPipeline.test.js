const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { analyzeCv } = require('../src/services/screening/screeningService');

const docxBuffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-cv.docx'));

const vacancy = {
  id: 'v1',
  job_title: 'Software Engineer',
  department: 'Engineering',
  location: 'Colombo',
  employment_type: 'Full-time',
  experience_level: '2+ Years',
  job_description: 'Build backend services in Python.',
  job_requirements: ['Python', 'FastAPI', 'PostgreSQL', 'Git', 'Docker'],
};

// A fake provider lets us test the pipeline (extract -> prompt -> validate ->
// score) with no network. It also captures the prompt it received.
function fakeProvider(responder) {
  return {
    name: 'fake',
    model: 'fake-model',
    calls: [],
    async complete(prompt) {
      this.calls.push(prompt);
      return { text: responder(prompt, this.calls.length) };
    },
  };
}

const goodJson = JSON.stringify({
  candidate_name: 'Jane Doe',
  skills: ['Python', 'FastAPI', 'PostgreSQL', 'Git', 'JavaScript'],
  matched_skills: ['Python', 'FastAPI', 'PostgreSQL', 'Git'],
  missing_skills: ['Docker'],
  skills_score: 88,
  experience_score: 82,
  requirements_score: 80,
  education_score: 70,
  overall_score: 82,
  experience_match: 'STRONG',
  education_match: 'GOOD',
  recommendation: 'GOOD_MATCH',
  summary: 'Solid backend match; Docker not demonstrated in the CV.',
});

test('happy path: extracts the CV, sends structured input, stores a validated result', async () => {
  const provider = fakeProvider(() => goodJson);
  const { result, meta } = await analyzeCv({ vacancy, cvBuffer: docxBuffer, ext: 'docx', provider });

  assert.equal(meta.provider, 'fake');
  assert.equal(result.recommendation, 'GOOD_MATCH');
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.deepEqual(result.missing_skills, ['Docker']);

  // The provider received the vacancy + the CV as untrusted, delimited data.
  const { system, user } = provider.calls[0];
  assert.match(system, /not a decision maker|do NOT hire/i);
  assert.match(user, /FastAPI/);
  assert.match(user, /CANDIDATE_CV_UNTRUSTED_DATA/);
  assert.match(user, /Jane Doe/); // extracted from the DOCX
});

test('the score is always recomputed server-side, never taken from the model verbatim', async () => {
  // Model claims overall_score 100 but the dimensions say otherwise — the
  // stored score follows the weighted dimensions, not the model's number.
  const provider = fakeProvider(() =>
    JSON.stringify({
      ...JSON.parse(goodJson),
      overall_score: 100,
      skills_score: 40,
      experience_score: 30,
      requirements_score: 20,
      education_score: 10,
    })
  );
  const { result } = await analyzeCv({ vacancy, cvBuffer: docxBuffer, ext: 'docx', provider });
  assert.ok(result.score < 50);
  assert.equal(result.score_breakdown.method, 'weighted');
});

test('a model returning score 100 with no dimensions is still clamped/normalized, never auto-accepted as a decision', async () => {
  const provider = fakeProvider(() =>
    JSON.stringify({ overall_score: 100, summary: 'x'.repeat(30), recommendation: 'STRONG_MATCH' })
  );
  const { result } = await analyzeCv({ vacancy, cvBuffer: docxBuffer, ext: 'docx', provider });
  assert.equal(result.score, 100);
  assert.equal(result.recommendation, 'STRONG_MATCH');
  // Crucially, the result object has no field that could express a hiring action.
  assert.equal('decision' in result, false);
  assert.equal('hired' in result, false);
  assert.equal('rejected' in result, false);
});

test('malformed JSON triggers one corrective retry, then fails with INVALID_AI_RESPONSE', async () => {
  const provider = fakeProvider((_p, callNo) => (callNo === 1 ? 'not json at all' : 'still not json'));
  await assert.rejects(
    () => analyzeCv({ vacancy, cvBuffer: docxBuffer, ext: 'docx', provider }),
    (err) => err.isScreeningError && err.code === 'INVALID_AI_RESPONSE'
  );
  assert.equal(provider.calls.length, 2);
});

test('malformed-then-valid: the corrective retry recovers', async () => {
  const provider = fakeProvider((_p, callNo) => (callNo === 1 ? 'oops' : goodJson));
  const { result } = await analyzeCv({ vacancy, cvBuffer: docxBuffer, ext: 'docx', provider });
  assert.equal(result.recommendation, 'GOOD_MATCH');
  assert.equal(provider.calls.length, 2);
});

test('a provider error surfaces as a typed screening error (AI_PROVIDER_ERROR)', async () => {
  const { AIProviderError, AI_ERROR } = require('../src/services/ai/errors');
  const provider = {
    name: 'fake',
    model: 'fake',
    async complete() {
      throw new AIProviderError(AI_ERROR.PROVIDER_ERROR, 'boom', { retryable: false });
    },
  };
  await assert.rejects(
    () => analyzeCv({ vacancy, cvBuffer: docxBuffer, ext: 'docx', provider }),
    (err) => err.isScreeningError && err.code === 'AI_PROVIDER_ERROR'
  );
});

test('an unreadable CV fails before the provider is ever called', async () => {
  const provider = fakeProvider(() => goodJson);
  await assert.rejects(
    () => analyzeCv({ vacancy, cvBuffer: Buffer.from('%PDF- nope'), ext: 'pdf', provider }),
    (err) => err.isScreeningError && err.code === 'CV_EXTRACTION_ERROR'
  );
  assert.equal(provider.calls.length, 0);
});
