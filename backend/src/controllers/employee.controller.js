const { successResponse, errorResponse } = require('../utils/response');
const employeeService = require('../services/employee.service');
const { DEPARTMENTS } = require('../config/vacancyOptions');
const { SENIORITY_LEVELS } = require('../config/seniority');

const Q_MAX = 100;

// GET /api/employees?department=&min_seniority=&q= — HR only. Lists active
// employees eligible to be interviewers, for the Sprint-2 interviewer picker.
async function listEmployees(req, res) {
  const errors = {};

  let department = null;
  if (req.query.department) {
    const raw = String(req.query.department).trim();
    if (!DEPARTMENTS.includes(raw)) {
      errors.department = 'Select a valid department.';
    } else {
      department = raw;
    }
  }

  let minSeniority = null;
  if (req.query.min_seniority) {
    const raw = String(req.query.min_seniority).trim();
    if (!SENIORITY_LEVELS.includes(raw)) {
      errors.min_seniority = 'Select a valid seniority level.';
    } else {
      minSeniority = raw;
    }
  }

  let q = '';
  if (req.query.q) {
    const raw = String(req.query.q).trim();
    if (raw.length > Q_MAX) {
      errors.q = `Search text must be ${Q_MAX} characters or fewer.`;
    } else {
      q = raw;
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the query parameters and try again.',
        fields: errors,
      },
    });
  }

  try {
    const employees = await employeeService.listEmployees({ department, minSeniority, q });
    return successResponse(res, { employees });
  } catch (err) {
    console.error('listEmployees failed:', err.message);
    return errorResponse(res, 500, 'INTERNAL_ERROR', 'Unable to load employees. Please try again later.');
  }
}

module.exports = { listEmployees };
