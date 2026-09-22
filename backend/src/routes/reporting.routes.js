const express = require('express');
const { authenticateUser, requireRole } = require('../middleware/auth.middleware');
const reportingController = require('../controllers/reporting.controller');

// Mounted at /api/reports — 'management' and 'hr' only (Step 6.1's rule: HR
// needs its own numbers too, scoped to their own vacancies inside the
// service; management sees everything).
const router = express.Router();

router.use(authenticateUser, requireRole('management', 'hr'));

router.get('/pipeline', reportingController.getPipeline);

module.exports = router;
