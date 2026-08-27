const express = require('express');
const { authenticateUser, requireHR } = require('../middleware/auth.middleware');
const vacancyController = require('../controllers/vacancy.controller');
const applicationController = require('../controllers/application.controller');

const router = express.Router();

// Every vacancy route is HR-only: a verified Supabase session AND role = 'hr'.
router.use(authenticateUser, requireHR);

router.post('/', vacancyController.createVacancy);
router.get('/', vacancyController.listVacancies);
router.get('/:id', vacancyController.getVacancy);
router.post('/:id/publish', vacancyController.publishVacancy);
router.get('/:id/applications', applicationController.listVacancyApplications);

module.exports = router;
