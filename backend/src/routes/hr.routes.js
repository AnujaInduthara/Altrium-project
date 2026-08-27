const express = require('express');
const { authenticateUser, requireHR } = require('../middleware/auth.middleware');
const hrController = require('../controllers/hr.controller');

const router = express.Router();

router.get('/me', authenticateUser, requireHR, hrController.getMe);

module.exports = router;
