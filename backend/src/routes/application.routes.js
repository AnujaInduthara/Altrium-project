const express = require('express');
const { authenticateUser, requireHR } = require('../middleware/auth.middleware');
const applicationController = require('../controllers/application.controller');
const screeningController = require('../controllers/screening.controller');

// HR-only: a verified Supabase session AND role = 'hr'. Per-application access
// is further restricted to the HR user who owns the parent vacancy, inside the
// controller.
const router = express.Router();

router.use(authenticateUser, requireHR);

router.get('/:id/cv', applicationController.getApplicationCv);

// PB-05 — read the AI screening result, or (HR-authorized) retry a failed one.
// AI screening is otherwise a system function: there is no endpoint that lets a
// client trigger screening for an arbitrary application.
router.get('/:id/screening', screeningController.getApplicationScreening);
router.post('/:id/screening/retry', screeningController.retryApplicationScreening);

module.exports = router;
