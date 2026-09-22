const express = require('express');
const { authenticateUser, requireRole } = require('../middleware/auth.middleware');
const hiringController = require('../controllers/hiring.controller');

// Mounted at /api/hiring — 'hiring_manager' and 'management' only. HR must
// get 403 here: this is the Hiring Manager's own view, and role separation
// is the point (DEVELOPMENT_PLAN.md Step 5.1's rule).
const router = express.Router();

router.use(authenticateUser, requireRole('hiring_manager', 'management'));

router.get('/candidates', hiringController.listCandidates);
router.get('/candidates/:applicationId', hiringController.getCandidate);
router.get('/candidates/:applicationId/cv', hiringController.getCandidateCv);

module.exports = router;
