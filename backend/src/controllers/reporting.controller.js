const { successResponse, errorResponse } = require('../utils/response');
const reportingService = require('../services/reporting.service');
const { parseReportRange } = require('../utils/dateRange');
const { toCsv, reportFilename } = require('../utils/csv');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMATS = ['json', 'csv'];

const REPORT_COLUMNS = [
  { key: 'job_title', label: 'Job Title' },
  { key: 'department', label: 'Department' },
  { key: 'applications', label: 'Applications' },
  { key: 'ai_shortlisted', label: 'AI Shortlisted' },
  { key: 'hr_selected', label: 'HR Selected' },
  { key: 'interviews_completed', label: 'Interviews Completed' },
  { key: 'hired', label: 'Hired' },
  { key: 'rejected', label: 'Rejected' },
];

function handleError(res, err, label) {
  if (err && err.isReportingError) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  console.error(`${label} failed:`, err.message);
  return errorResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

// Shared query validation for both report endpoints. Returns null (after
// sending the 400 itself) on failure, or the resolved { vacancyId, from, to }.
function parseCommonQuery(req, res) {
  const vacancyId = typeof req.query.vacancy_id === 'string' ? req.query.vacancy_id.trim() : '';
  if (vacancyId && !UUID_RE.test(vacancyId)) {
    errorResponse(res, 400, 'VALIDATION_ERROR', 'vacancy_id must be a valid id.');
    return null;
  }

  const { valid, errors, value } = parseReportRange({
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
  });
  if (!valid) {
    errorResponse(res, 400, 'VALIDATION_ERROR', errors.to || errors.from || 'Invalid date range.');
    return null;
  }

  return { vacancyId: vacancyId || undefined, from: value.from, to: value.to };
}

// GET /api/reports/pipeline?from=&to=&vacancy_id= — 'management' sees every
// vacancy; 'hr' sees only their own (scoped inside the service).
async function getPipeline(req, res) {
  try {
    const parsed = parseCommonQuery(req, res);
    if (!parsed) return undefined;

    const pipeline = await reportingService.getPipeline({
      from: parsed.from,
      to: parsed.to,
      vacancyId: parsed.vacancyId,
      requesterProfile: { role: req.profile.role, authUserId: req.user.id },
    });

    return successResponse(res, pipeline);
  } catch (err) {
    return handleError(res, err, 'getPipeline');
  }
}

// GET /api/reports/recruitment?from=&to=&vacancy_id=&format=json|csv
async function getRecruitmentReport(req, res) {
  try {
    const format = typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : 'json';
    if (!FORMATS.includes(format)) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', `format must be one of: ${FORMATS.join(', ')}.`);
    }

    const parsed = parseCommonQuery(req, res);
    if (!parsed) return undefined;

    const report = await reportingService.getRecruitmentReport({
      from: parsed.from,
      to: parsed.to,
      vacancyId: parsed.vacancyId,
      requesterProfile: { role: req.profile.role, authUserId: req.user.id },
    });

    if (format === 'csv') {
      const totalsRow = {
        job_title: 'Total',
        department: '',
        applications: report.totals.applications,
        ai_shortlisted: report.totals.ai_shortlisted,
        hr_selected: report.totals.hr_selected,
        interviews_completed: report.totals.interviews_completed,
        hired: report.totals.hired,
        rejected: report.totals.rejected,
      };
      const csv = toCsv({ columns: REPORT_COLUMNS, rows: [...report.by_vacancy, totalsRow] });
      const filename = reportFilename('recruitment-report', report.period.from, report.period.to);

      res.status(200);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.attachment(filename);
      return res.send(csv);
    }

    return successResponse(res, report);
  } catch (err) {
    return handleError(res, err, 'getRecruitmentReport');
  }
}

module.exports = { getPipeline, getRecruitmentReport };
