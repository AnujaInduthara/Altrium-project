const express = require('express');
const { authenticateUser, requireHR } = require('../middleware/auth.middleware');
const schedulingController = require('../controllers/scheduling.controller');

// Mounted at /api/interview-stages — HR only, owner-checked per stage inside
// the service (stage -> process -> application -> vacancy).
const router = express.Router();

router.use(authenticateUser, requireHR);

router.get('/:stageId/available-interviewers', schedulingController.getAvailableInterviewers);
router.post('/:stageId/schedule', schedulingController.scheduleInterview);

module.exports = router;
