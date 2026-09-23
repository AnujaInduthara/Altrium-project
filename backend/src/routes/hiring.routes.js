const express = require('express');
const { authenticateUser, requireRole } = require('../middleware/auth.middleware');
const hiringController = require('../controllers/hiring.controller');
const hiringDecisionController = require('../controllers/hiringDecision.controller');

// Mounted at /api/hiring — 'hiring_manager' and 'management' only for reads.
// HR must get 403 here: this is the Hiring Manager's own view, and role
// separation is the point (DEVELOPMENT_PLAN.md Step 5.1's rule).
const router = express.Router();

router.use(authenticateUser, requireRole('hiring_manager', 'management'));

router.get('/candidates', hiringController.listCandidates);
router.get('/candidates/:applicationId', hiringController.getCandidate);
router.get('/candidates/:applicationId/cv', hiringController.getCandidateCv);

// PB-21 — only 'hiring_manager' may decide; 'management' is read-only (Step
// 5.2's rule), so this route needs its own, stricter role check rather than
// the router-wide one above.
router.post(
  '/candidates/:applicationId/decision',
  requireRole('hiring_manager'),
  hiringDecisionController.decide
);

module.exports = router;
