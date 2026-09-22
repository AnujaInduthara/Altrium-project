const express = require('express');
const { authenticateUser, requireHR } = require('../middleware/auth.middleware');
const interviewProcessController = require('../controllers/interviewProcess.controller');

// Mounted at /api/applications/:id/interview-process — HR only, owner-checked
// per application inside the controller/service (never a fabricated 403 that
// would confirm an application exists).
const router = express.Router({ mergeParams: true });

router.use(authenticateUser, requireHR);

router.post('/', interviewProcessController.createInterviewProcess);
router.get('/', interviewProcessController.getInterviewProcess);
router.put('/stages', interviewProcessController.replaceInterviewStages);
router.delete('/', interviewProcessController.cancelInterviewProcess);

module.exports = router;
