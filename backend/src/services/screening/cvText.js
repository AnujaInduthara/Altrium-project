const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const { CV_TEXT_MIN_CHARS, CV_TEXT_MAX_CHARS } = require('../../config/screeningOptions');
const { ScreeningError } = require('./errors');

// CV text extraction + normalization for PB-05.
//
//   { buffer, ext }  ->  { text, charCount, pageCount, truncated }
//
// Supports the two formats PB-03 accepts (PDF, DOCX). Extraction failure - an
// image-only/scanned PDF, a corrupt file, an encrypted document - surfaces as a
// ScreeningError('CV_EXTRACTION_ERROR'); we never fabricate candidate content
// from a document we could not read.

// C0/C1 control characters plus zero-width space, BOM. Newline and tab are kept
// (they are handled separately by the whitespace passes below).
const CONTROL_CHARS_RE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u200B\\uFEFF]',
  'g'
);
const TRUNCATION_MARKER = '\n\n[CV text truncated for screening]';

function normalizeText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(/[^\S\n]+/g, ' ') // collapse runs of spaces/tabs, leave newlines
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = Array.isArray(result.pages) ? result.pages : [];
    const text = pages.length
      ? pages.map((p) => p.text || '').join('\n\n')
      : String(result.text || '');
    return { text, pageCount: result.total || pages.length || null };
  } finally {
    // Release the pdf.js worker/document regardless of outcome.
    try {
      await parser.destroy();
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return { text: String(result.value || ''), pageCount: null };
}

// ext is the already-validated extension from PB-03's CV validation ('pdf' | 'docx').
async function extractCvText({ buffer, ext }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ScreeningError('CV_EXTRACTION_ERROR', 'The CV file was empty or unreadable.');
  }

  let raw;
  try {
    if (ext === 'pdf') {
      raw = await extractPdf(buffer);
    } else if (ext === 'docx') {
      raw = await extractDocx(buffer);
    } else {
      throw new ScreeningError('CV_EXTRACTION_ERROR', `Unsupported CV type for screening: ${ext}`);
    }
  } catch (err) {
    if (err && err.isScreeningError) throw err;
    throw new ScreeningError('CV_EXTRACTION_ERROR', 'The CV file could not be parsed.', { cause: err });
  }

  const normalized = normalizeText(raw.text);

  // Guard against "extracted" output that is really just whitespace/artefacts.
  const readable = normalized.replace(/\s/g, '');
  if (readable.length < CV_TEXT_MIN_CHARS) {
    throw new ScreeningError(
      'CV_EXTRACTION_ERROR',
      'Unable to extract readable text from CV. It may be a scanned image or an empty document.'
    );
  }

  let text = normalized;
  let truncated = false;
  if (text.length > CV_TEXT_MAX_CHARS) {
    text = text.slice(0, CV_TEXT_MAX_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
    truncated = true;
  }

  return {
    text,
    charCount: text.length,
    pageCount: raw.pageCount,
    truncated,
  };
}

module.exports = { extractCvText, normalizeText };
