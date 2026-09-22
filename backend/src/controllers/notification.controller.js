const { successResponse, errorResponse } = require('../utils/response');
const notificationService = require('../services/notification.service');

function handleError(res, err, label) {
  if (err && err.isNotificationError) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

// GET /api/notifications?unread_only= — any authenticated role, own only.
async function listNotifications(req, res) {
  try {
    const unreadOnly = ['1', 'true'].includes(String(req.query.unread_only || '').toLowerCase());
    const [notifications, unreadCount] = await Promise.all([
      notificationService.listForProfile(req.profile.id, { unreadOnly }),
      notificationService.unreadCountForProfile(req.profile.id),
    ]);
    return successResponse(res, { notifications, unread_count: unreadCount });
  } catch (err) {
    return handleError(res, err, 'listNotifications');
  }
}

// POST /api/notifications/:id/read — own only.
async function markNotificationRead(req, res) {
  try {
    const notification = await notificationService.markRead(req.profile.id, req.params.id);
    return successResponse(res, notification);
  } catch (err) {
    return handleError(res, err, 'markNotificationRead');
  }
}

module.exports = { listNotifications, markNotificationRead };
