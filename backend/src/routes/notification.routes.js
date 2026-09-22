const express = require('express');
const { authenticateUser, requireRole } = require('../middleware/auth.middleware');
const { ALL_ROLES } = require('../config/roles');
const notificationController = require('../controllers/notification.controller');

// Any authenticated, active role — notifications aren't HR-specific.
const router = express.Router();

router.use(authenticateUser, requireRole(...ALL_ROLES));

router.get('/', notificationController.listNotifications);
router.post('/:id/read', notificationController.markNotificationRead);

module.exports = router;
