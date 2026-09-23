const express = require('express');
const { authenticateUser, requireHR } = require('../middleware/auth.middleware');
const employeeController = require('../controllers/employee.controller');

// HR-only for now: this is Sprint 2's interviewer picker data source. Nothing
// here is per-owner (employees aren't scoped to a vacancy), so there is no
// further ownership check beyond the role gate.
const router = express.Router();

router.use(authenticateUser, requireHR);

router.get('/', employeeController.listEmployees);

module.exports = router;
