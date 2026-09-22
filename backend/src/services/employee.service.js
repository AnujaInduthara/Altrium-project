const { supabaseAdmin } = require('../config/supabase');
const { INTERVIEWER_ELIGIBLE_ROLES } = require('../config/roles');
const { meetsMinimumSeniority } = require('../config/seniority');

// Fields an interviewer picker needs. Never auth_user_id — that's an internal
// identity detail, not something a picker UI should see.
const EMPLOYEE_FIELDS = ['id', 'full_name', 'email', 'department', 'job_position', 'seniority_level'];

function wrapDbError(message, error) {
  const err = new Error(`${message}: ${error.message}`);
  err.cause = error;
  return err;
}

function escapeLikeWildcards(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Active employees whose role can conduct interviews (employee, hr,
// hiring_manager — see config/roles.js), optionally filtered by exact
// department, a minimum seniority (>=, evaluated in JS via
// meetsMinimumSeniority since the ordering isn't a plain SQL comparison), and
// a name/job_position search.
async function listEmployees({ department, minSeniority, q }) {
  let query = supabaseAdmin
    .from('profiles')
    .select(EMPLOYEE_FIELDS.join(', '))
    .eq('is_active', true)
    .in('role', INTERVIEWER_ELIGIBLE_ROLES)
    .order('full_name', { ascending: true });

  if (department) {
    query = query.eq('department', department);
  }
  if (q) {
    // Double-quoted so a comma/paren in the search term can't be parsed as a
    // second condition by PostgREST's or() grammar (same fix as
    // vacancy.service.js's listPublishedVacancies).
    const value = `%${escapeLikeWildcards(q)}%`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    query = query.or(`full_name.ilike."${value}",job_position.ilike."${value}"`);
  }

  const { data, error } = await query;
  if (error) throw wrapDbError('Failed to list employees', error);

  const employees = data || [];
  if (!minSeniority) return employees;
  return employees.filter((employee) => meetsMinimumSeniority(employee.seniority_level, minSeniority));
}

module.exports = { listEmployees };
