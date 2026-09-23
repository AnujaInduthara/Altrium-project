const { successResponse, errorResponse } = require('../utils/response');
const availabilityService = require('../services/availability.service');
const { validateSlotInput } = require('../utils/timeSlots');

function handleError(res, err, label) {
  if (err && err.isAvailabilityError) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/availability?from=&to= — the caller's own slots only.
async function listAvailability(req, res) {
  try {
    const from = typeof req.query.from === 'string' && DATE_RE.test(req.query.from) ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' && DATE_RE.test(req.query.to) ? req.query.to : undefined;
    const slots = await availabilityService.listMine(req.profile.id, { from, to });
    return successResponse(res, { slots });
  } catch (err) {
    return handleError(res, err, 'listAvailability');
  }
}

// POST /api/availability — body: { slot_date, start_time, end_time }.
async function createAvailability(req, res) {
  const { valid, errors, value } = validateSlotInput({ ...(req.body || {}), todayIso: todayIso() });
  if (!valid) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the slot details and try again.',
        fields: errors,
      },
    });
  }

  try {
    const slot = await availabilityService.create(req.profile.id, value);
    return successResponse(res, slot, 201);
  } catch (err) {
    return handleError(res, err, 'createAvailability');
  }
}

// DELETE /api/availability/:id — scoped to the caller's own slots.
async function removeAvailability(req, res) {
  try {
    const result = await availabilityService.remove(req.profile.id, req.params.id);
    return successResponse(res, result);
  } catch (err) {
    return handleError(res, err, 'removeAvailability');
  }
}

module.exports = { listAvailability, createAvailability, removeAvailability };
