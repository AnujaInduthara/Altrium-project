const express = require('express');
const { authenticateUser, requireHR } = require('../middleware/auth.middleware');
const interviewController = require('../controllers/interview.controller');

// Mounted at /api/interviews — HR only, owner-checked per interview/vacancy
// inside the service.
const router = express.Router();

router.use(authenticateUser, requireHR);

router.get('/', interviewController.listInterviews);
router.post('/:id/cancel', interviewController.cancelInterview);

module.exports = router;
