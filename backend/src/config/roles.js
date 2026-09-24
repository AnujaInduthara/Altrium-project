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
  // Not a staff role — see candidateAccount.service.js. Deliberately excluded
  // from ALL_ROLES below.
  CANDIDATE: 'candidate',
});

// Staff roles only — deliberately NOT Object.values(ROLES). The only
// consumer today is notification.routes.js's requireRole(...ALL_ROLES), and
// candidate notifications are always addressed by recipient_email (see
// notification.service.js), never recipient_profile_id. If this silently
// picked up CANDIDATE, every candidate would become authorized to call the
// general notifications API with no change to that route file.
const ALL_ROLES = Object.freeze([
  ROLES.HR,
  ROLES.EMPLOYEE,
  ROLES.HIRING_MANAGER,
  ROLES.MANAGEMENT,
  ROLES.ADMIN,
]);

// Roles that may be assigned as an interview panel member (Sprint 2). An
// "interviewer" is not a separate role — it's any active employee, hr, or
// hiring_manager profile that meets a stage's requirements. Management/admin
// are organisational oversight roles, not interview panel members.
const INTERVIEWER_ELIGIBLE_ROLES = Object.freeze([ROLES.EMPLOYEE, ROLES.HR, ROLES.HIRING_MANAGER]);

module.exports = { ROLES, ALL_ROLES, INTERVIEWER_ELIGIBLE_ROLES };
