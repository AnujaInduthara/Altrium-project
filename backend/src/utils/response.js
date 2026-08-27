function successResponse(res, data = {}, status = 200) {
  return res.status(status).json({ success: true, data });
}

function errorResponse(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

module.exports = { successResponse, errorResponse };
