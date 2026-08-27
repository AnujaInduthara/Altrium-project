const express = require('express');
const publicController = require('../controllers/public.controller');

// Unauthenticated, read-only. Mounted at /api/public — deliberately NOT behind
// the auth middleware the HR vacancy routes use.
const router = express.Router();

router.get('/vacancies/:token', publicController.getPublishedVacancy);

module.exports = router;
