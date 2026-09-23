const express = require('express');
const { authenticateUser, requireHR, requireRole } = require('../middleware/auth.middleware');
const applicationController = require('../controllers/application.controller');
const screeningController = require('../controllers/screening.controller');

// Every route below requires a verified Supabase session. Most are HR-only
// (role = 'hr'); per-application access is further restricted to the HR user
// who owns the parent vacancy, inside the controller.
const router = express.Router();

router.use(authenticateUser);

// PB-18: also reachable by an assigned, non-cancelled interviewer — narrowed
// further inside the controller (HR-owns-vacancy OR assigned-interviewer).
// Registered before the blanket requireHR below so it isn't HR-only.
router.get('/:id/cv', requireRole('hr', 'employee', 'hiring_manager'), applicationController.getApplicationCv);

router.use(requireHR);

// PB-06 — the read-only applicant-review payload (applicant details + vacancy
// summary + stored AI screening result), owner-checked.
router.get('/:id/review', applicationController.getApplicationReview);

// PB-07 — move an application through the HR status lifecycle (Applicant
// Review's decision panel).
router.patch('/:id/status', applicationController.updateApplicationStatus);

// PB-05 — read the AI screening result, or (HR-authorized) retry a failed one.
// AI screening is otherwise a system function: there is no endpoint that lets a
// client trigger screening for an arbitrary application.
router.get('/:id/screening', screeningController.getApplicationScreening);
router.post('/:id/screening/retry', screeningController.retryApplicationScreening);

module.exports = router;
