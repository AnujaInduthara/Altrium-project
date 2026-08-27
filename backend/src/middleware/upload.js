const multer = require('multer');
const { errorResponse } = require('../utils/response');
const {
  CV_TYPES,
  CV_EXTENSIONS,
  LIMITS,
} = require('../config/applicationOptions');
const { UNSUPPORTED_CV_MESSAGE } = require('../utils/applicationValidation');

// CV upload for the public application endpoint. In-memory (the file is small,
// streamed straight to Supabase Storage, and never written to the API's disk).
// This is a first-pass filter only — applicationValidation.validateCvFile then
// verifies the magic bytes, since a browser's MIME type and filename are not
// trustworthy.
const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.CV_MAX_BYTES,
    files: 1,
    fields: 12,
    parts: 15,
  },
  fileFilter(req, file, cb) {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (!CV_TYPES[file.mimetype] || !CV_EXTENSIONS.includes(ext)) {
      const err = new Error(UNSUPPORTED_CV_MESSAGE);
      err.code = 'CV_UNSUPPORTED_TYPE';
      return cb(err);
    }
    return cb(null, true);
  },
}).single('cv');

// Wraps multer so its callback-style errors become the project's standard
// JSON error shape with the right HTTP status, instead of bubbling to the
// generic 500 handler.
function uploadCvMiddleware(req, res, next) {
  cvUpload(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return errorResponse(
        res,
        413,
        'CV_TOO_LARGE',
        'Your CV exceeds the maximum allowed file size.'
      );
    }
    if (err.code === 'CV_UNSUPPORTED_TYPE') {
      return errorResponse(res, 415, 'CV_UNSUPPORTED_TYPE', UNSUPPORTED_CV_MESSAGE);
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return errorResponse(res, 400, 'CV_INVALID', 'Please attach a single CV file.');
    }

    console.error('CV upload failed:', err.message);
    return errorResponse(
      res,
      400,
      'CV_INVALID',
      'We could not read the uploaded file. Please try again.'
    );
  });
}

module.exports = { uploadCvMiddleware };
