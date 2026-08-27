const express = require('express');
const { authenticateUser } = require('../middleware/auth.middleware');
const authController = require('../controllers/auth.controller');

const router = express.Router();

router.get('/me', authenticateUser, authController.getMe);

module.exports = router;
