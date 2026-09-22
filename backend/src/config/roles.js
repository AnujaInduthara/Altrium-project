// Canonical role vocabulary (mirrors the profiles_role_allowed check
// constraint in sql/009_extend_profiles_employees.sql). The backend is the
// single source of truth — a client-supplied role is never trusted; roles
// only ever come from the profiles table (see auth.middleware.js).

const ROLES = Object.freeze({
  HR: 'hr',
  EMPLOYEE: 'employee',
  HIRING_MANAGER: 'hiring_manager',
  MANAGEMENT: 'management',
  ADMIN: 'admin',
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));

// Roles that may be assigned as an interview panel member (Sprint 2). An
// "interviewer" is not a separate role — it's any active employee, hr, or
// hiring_manager profile that meets a stage's requirements. Management/admin
// are organisational oversight roles, not interview panel members.
const INTERVIEWER_ELIGIBLE_ROLES = Object.freeze([ROLES.EMPLOYEE, ROLES.HR, ROLES.HIRING_MANAGER]);

module.exports = { ROLES, ALL_ROLES, INTERVIEWER_ELIGIBLE_ROLES };
