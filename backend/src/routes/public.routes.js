const express = require('express');
const publicController = require('../controllers/public.controller');
const { uploadCvMiddleware } = require('../middleware/upload');
const { createRateLimiter } = require('../middleware/rateLimit');

// Unauthenticated, public. Mounted at /api/public — deliberately NOT behind the
// auth middleware the HR vacancy routes use. Coarse per-IP rate limits guard
// against enumeration / submission abuse.
const router = express.Router();

const lookupLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests. Please slow down and try again shortly.',
});

const submitLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 8,
  message: 'You have submitted several applications recently. Please try again later.',
});

router.get('/vacancies/:token', lookupLimiter, publicController.getPublishedVacancy);

router.post(
  '/vacancies/:token/applications',
  submitLimiter,
  uploadCvMiddleware,
  publicController.submitApplication
);

module.exports = router;
