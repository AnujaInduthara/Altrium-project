const express = require('express');
const { authenticateUser, requireRole } = require('../middleware/auth.middleware');
const availabilityController = require('../controllers/availability.controller');

// Anyone who can be an interviewer manages their own calendar — not HR-only.
const router = express.Router();

router.use(authenticateUser, requireRole('employee', 'hr', 'hiring_manager'));

router.get('/', availabilityController.listAvailability);
router.post('/', availabilityController.createAvailability);
router.delete('/:id', availabilityController.removeAvailability);

module.exports = router;
