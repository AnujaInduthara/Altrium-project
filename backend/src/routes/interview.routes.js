const express = require('express');
const { authenticateUser, requireHR, requireRole } = require('../middleware/auth.middleware');
const interviewController = require('../controllers/interview.controller');
const evaluationController = require('../controllers/evaluation.controller');

// Mounted at /api/interviews.
const router = express.Router();

router.use(authenticateUser);

// HR only, owner-checked per interview/vacancy inside the service.
router.get('/', requireHR, interviewController.listInterviews);
router.post('/:id/cancel', requireHR, interviewController.cancelInterview);

// PB-18 — the interviewer's own view. Interviewers are ordinary employees on
// their existing account (no new role): 'employee', 'hr' and
// 'hiring_manager' can all reach these; per-interview access is still
// assignment-checked inside the service (not assigned -> 404, never 403).
const requireInterviewerRoles = requireRole('employee', 'hr', 'hiring_manager');
router.get('/mine', requireInterviewerRoles, interviewController.listMyInterviews);

// PB-19 — the interviewer's own evaluation of one interview.
router.post('/:id/evaluation', requireInterviewerRoles, evaluationController.submitEvaluation);
router.get('/:id/evaluation', requireInterviewerRoles, evaluationController.getEvaluation);

router.get('/:id', requireInterviewerRoles, interviewController.getMyInterview);

module.exports = router;
