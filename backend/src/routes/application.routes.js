const express = require('express');
const { authenticateUser, requireHR } = require('../middleware/auth.middleware');
const applicationController = require('../controllers/application.controller');

// HR-only: a verified Supabase session AND role = 'hr'. Per-application access
// is further restricted to the HR user who owns the parent vacancy, inside the
// controller.
const router = express.Router();

router.use(authenticateUser, requireHR);

router.get('/:id/cv', applicationController.getApplicationCv);

module.exports = router;
