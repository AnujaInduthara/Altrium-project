const express = require('express');
const { authenticateUser, requireHR } = require('../middleware/auth.middleware');
const vacancyController = require('../controllers/vacancy.controller');
const applicationController = require('../controllers/application.controller');
const screeningController = require('../controllers/screening.controller');

const router = express.Router();

// Every vacancy route is HR-only: a verified Supabase session AND role = 'hr'.
router.use(authenticateUser, requireHR);

router.post('/', vacancyController.createVacancy);
router.get('/', vacancyController.listVacancies);
router.get('/:id', vacancyController.getVacancy);
router.post('/:id/publish', vacancyController.publishVacancy);
router.post('/:id/close', vacancyController.closeVacancy);
router.get('/:id/applications', applicationController.listVacancyApplications);

// PB-05 — bulk (re)run AI screening for every not-yet-completed application.
router.post('/:id/screenings/run-pending', screeningController.runPendingScreenings);

// PB-07 — HR selects applicants to proceed as candidates (submitted -> selected).
router.post('/:id/candidates/select', applicationController.selectCandidates);

module.exports = router;
