const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateApplicationInput,
  validateCvFile,
} = require('../src/utils/applicationValidation');
const { LIMITS } = require('../src/config/applicationOptions');

// --- helpers ---------------------------------------------------------------

const PDF_HEADER = Buffer.from('%PDF-1.7\n');
// Minimal DOCX-shaped buffer: ZIP local-file header + the OOXML marker.
const DOCX_HEADER = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('....[Content_Types].xml....'),
]);

function cvFile({ name = 'cv.pdf', mimetype = 'application/pdf', buffer = PDF_HEADER, size } = {}) {
  return { originalname: name, mimetype, buffer, size: size ?? buffer.length };
}

const validBody = {
  full_name: '  John  Perera ',
  email: 'John.Perera@Example.COM',
  phone: '+94 (77) 123-4567',
  location: ' Colombo ',
};

// --- field validation ----------------------------------------------------

test('accepts a well-formed application and normalizes the values', () => {
  const { valid, errors, value } = validateApplicationInput(validBody);
  assert.equal(valid, true);
  assert.deepEqual(errors, {});
  assert.equal(value.full_name, 'John Perera');
  assert.equal(value.email, 'john.perera@example.com');
  assert.equal(value.location, 'Colombo');
});

test('rejects a missing full name', () => {
  const { valid, errors } = validateApplicationInput({ ...validBody, full_name: '   ' });
  assert.equal(valid, false);
  assert.match(errors.full_name, /full name/i);
});

test('rejects an over-long full name', () => {
  const { errors } = validateApplicationInput({
    ...validBody,
    full_name: 'a'.repeat(LIMITS.FULL_NAME_MAX + 1),
  });
  assert.ok(errors.full_name);
});

test('rejects an invalid email', () => {
  for (const email of ['', 'not-an-email', 'foo@bar', 'a b@c.com']) {
    const { valid, errors } = validateApplicationInput({ ...validBody, email });
    assert.equal(valid, false, `expected "${email}" to be invalid`);
    assert.ok(errors.email);
  }
});

test('rejects a missing or implausible phone', () => {
  for (const phone of ['', '123', 'call me', '1'.repeat(40)]) {
    const { valid, errors } = validateApplicationInput({ ...validBody, phone });
    assert.equal(valid, false, `expected "${phone}" to be invalid`);
    assert.ok(errors.phone);
  }
});

test('accepts varied international phone formats', () => {
  for (const phone of ['+94771234567', '077 123 4567', '(011) 234-5678', '+1 202 555 0143']) {
    const { valid } = validateApplicationInput({ ...validBody, phone });
    assert.equal(valid, true, `expected "${phone}" to be valid`);
  }
});

test('rejects a missing location', () => {
  const { valid, errors } = validateApplicationInput({ ...validBody, location: '' });
  assert.equal(valid, false);
  assert.ok(errors.location);
});

test('ignores unexpected extra fields', () => {
  const { valid, value } = validateApplicationInput({ ...validBody, status: 'selected', id: 'x' });
  assert.equal(valid, true);
  assert.equal('status' in value, false);
  assert.equal('id' in value, false);
});

// --- CV file validation -------------------------------------------------

test('accepts a PDF with a real %PDF- header', () => {
  const res = validateCvFile(cvFile());
  assert.equal(res.valid, true);
  assert.equal(res.ext, 'pdf');
  assert.equal(res.contentType, 'application/pdf');
});

test('accepts a DOCX that is a real OOXML zip', () => {
  const res = validateCvFile(
    cvFile({
      name: 'resume.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: DOCX_HEADER,
    })
  );
  assert.equal(res.valid, true);
  assert.equal(res.ext, 'docx');
});

test('rejects a missing CV', () => {
  assert.equal(validateCvFile(undefined).code, 'CV_REQUIRED');
  assert.equal(validateCvFile({ originalname: 'x.pdf', mimetype: 'application/pdf', buffer: Buffer.alloc(0), size: 0 }).code, 'CV_REQUIRED');
});

test('rejects an oversized CV with 413', () => {
  const res = validateCvFile(cvFile({ size: LIMITS.CV_MAX_BYTES + 1 }));
  assert.equal(res.valid, false);
  assert.equal(res.status, 413);
  assert.equal(res.code, 'CV_TOO_LARGE');
});

test('rejects an unsupported extension with 415', () => {
  const res = validateCvFile(cvFile({ name: 'malware.exe', mimetype: 'application/pdf' }));
  assert.equal(res.status, 415);
  assert.equal(res.code, 'CV_UNSUPPORTED_TYPE');
});

test('rejects a mismatched MIME type', () => {
  const res = validateCvFile(cvFile({ name: 'cv.pdf', mimetype: 'image/png' }));
  assert.equal(res.status, 415);
});

test('rejects a file whose bytes are not really a PDF (renamed .txt)', () => {
  const res = validateCvFile(cvFile({ buffer: Buffer.from('just some text, not a pdf at all') }));
  assert.equal(res.status, 415);
  assert.equal(res.code, 'CV_UNSUPPORTED_TYPE');
});

test('rejects a .docx that is a zip but not OOXML', () => {
  const res = validateCvFile(
    cvFile({
      name: 'cv.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('random zip contents')]),
    })
  );
  assert.equal(res.status, 415);
});
