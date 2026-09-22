-- Step 2.1: turn profiles into a real employee directory with roles, so
-- Sprint 2 (interviewers, hiring managers, management) has people to work
-- with. Run in the Supabase SQL editor after 008_add_application_status_audit.sql.
--
-- Every Sprint-2 person (interviewer, hiring manager, management) is an
-- ordinary row in this same table — an "interviewer" is not a separate role,
-- it's any active employee/hr/hiring_manager profile that meets a stage's
-- department + minimum-seniority requirement (see backend/src/config/roles.js
-- and seniority.js). This migration only adds columns; it does not touch the
-- existing per-owner RLS select policy.

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists department text,
  add column if not exists job_position text,
  add column if not exists seniority_level text,
  add column if not exists is_active boolean not null default true;

-- Role vocabulary. Defaulting new rows to 'employee' (least privilege) means a
-- provisioning mistake never accidentally grants HR access; existing rows keep
-- whatever role they already have (today, always 'hr').
alter table public.profiles
  drop constraint if exists profiles_role_allowed;
alter table public.profiles
  add constraint profiles_role_allowed
  check (role in ('hr', 'employee', 'hiring_manager', 'management', 'admin'));
alter table public.profiles
  alter column role set default 'employee';

alter table public.profiles
  drop constraint if exists profiles_seniority_level_allowed;
alter table public.profiles
  add constraint profiles_seniority_level_allowed
  check (seniority_level is null or seniority_level in ('intern', 'junior', 'mid', 'senior', 'lead'));

-- Serves "find candidate interviewers": active employees in a department at or
-- above a minimum seniority. Partial on is_active since inactive employees are
-- never offered as interviewers and should never be scanned for this query.
create index if not exists profiles_role_department_seniority_idx
  on public.profiles (role, department, seniority_level)
  where is_active;

comment on column public.profiles.full_name is
  'Display name used in interviewer / employee pickers (Sprint 2).';
comment on column public.profiles.department is
  'Must match the department list in backend/src/config/vacancyOptions.js.';
comment on column public.profiles.job_position is
  'Free-text job title, e.g. "Senior Software Engineer". Shown, not matched against.';
comment on column public.profiles.seniority_level is
  'One of intern/junior/mid/senior/lead (backend/src/config/seniority.js), ordered low to high. Null = not set.';
comment on column public.profiles.is_active is
  'Inactive employees are never offered as interviewers and cannot sign in past requireRole (see auth.middleware.js).';

-- Example provisioning (uncomment and fill in after creating the Auth user):
--
-- insert into public.profiles
--   (auth_user_id, email, role, full_name, department, job_position, seniority_level)
-- values
--   ('<auth-user-uuid>', 'jane.doe@example.com', 'employee', 'Jane Doe',
--    'Engineering', 'Senior Software Engineer', 'senior');
--
-- insert into public.profiles
--   (auth_user_id, email, role, full_name, department, job_position, seniority_level)
-- values
--   ('<auth-user-uuid>', 'sam.perera@example.com', 'hiring_manager', 'Sam Perera',
--    'Engineering', 'Engineering Manager', 'lead');
--
-- update public.profiles set is_active = false where email = 'former.employee@example.com';
