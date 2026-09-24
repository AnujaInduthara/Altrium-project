-- Candidate accounts: a candidate selected for interview gets an ordinary
-- profiles row (role = 'candidate') so requireRole/getMe keep working
-- unchanged, plus an explicit link from their application(s) back to that
-- profile. Run in the Supabase SQL editor after 015_create_hiring_decisions.sql.
--
-- This is a deliberately narrow reversal of "candidates are not users"
-- (see DEVELOPMENT_PLAN.md): a candidate profile can only ever see their own
-- interviews (backend/src/services/candidate.service.js), never another
-- candidate's data, an AI score, an HR note, or an interviewer's identity.
-- Every existing candidate-facing privacy boundary is unchanged by this
-- migration. Nothing here adds an anon/authenticated RLS policy — access
-- continues to go through the backend with the service-role key exactly as
-- it does today; a candidate's Supabase Auth JWT is only ever used for
-- authenticateUser/requireRole, same as staff.

alter table public.profiles
  drop constraint if exists profiles_role_allowed;
alter table public.profiles
  add constraint profiles_role_allowed
  check (role in ('hr', 'employee', 'hiring_manager', 'management', 'admin', 'candidate'));

-- Nothing looked profiles up by email before now (every staff lookup goes by
-- auth_user_id) — candidateAccount.service.js's find-or-create step needs it.
create index if not exists profiles_email_lower_idx
  on public.profiles (lower(email));

-- The real guard against ever provisioning two candidate profiles for the
-- same email under a race (e.g. two concurrent "selected" events for the
-- same person across two vacancies) — same philosophy as the
-- interview_interviewers exclusion constraint: the database, not the
-- application, is the final guarantee. Scoped to role = 'candidate' so it
-- says nothing about staff emails, which may legitimately repeat elsewhere.
create unique index if not exists profiles_candidate_email_unique_idx
  on public.profiles (lower(email))
  where role = 'candidate';

-- Explicit FK from an application back to the candidate's own account.
-- Nullable: most applications never reach 'selected' and never get one.
-- ON DELETE SET NULL: deleting a profile must never cascade into deleting
-- application history.
alter table public.applications
  add column if not exists candidate_profile_id uuid references public.profiles (id) on delete set null;

create index if not exists applications_candidate_profile_id_idx
  on public.applications (candidate_profile_id)
  where candidate_profile_id is not null;

-- Set only when an applicant's email collides with an existing STAFF profile
-- (hr/employee/hiring_manager/management/admin) at provisioning time, so the
-- account cannot be auto-created — surfaced to HR on the Applicant Review
-- page instead of failing silently. Null in every other case.
alter table public.applications
  add column if not exists candidate_provisioning_note text;

comment on column public.profiles.role is
  'One of hr/employee/hiring_manager/management/admin (staff) or candidate. A candidate profile is created only when an application reaches ''selected'' — see candidateAccount.service.js. Never assignable by the client (see auth.middleware.js).';
comment on column public.applications.candidate_profile_id is
  'Set once, when this application''s candidate is first invited to create an account (on selection) or found to already have one (a prior application''s selection). Null for every application that never reached ''selected''. Only ever written by candidateAccount.service.js using the service-role key.';
comment on column public.applications.candidate_provisioning_note is
  'Set when the applicant''s email matches an existing staff profile, so an account could not be auto-created. Shown to HR on the Applicant Review page. Null otherwise.';
