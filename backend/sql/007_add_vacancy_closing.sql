-- PB-08: HR closes a job vacancy (PUBLISHED -> CLOSED).
-- Run in the Supabase SQL editor after 006_add_candidate_selection.sql.
--
-- Closing is the final Sprint-1 step. When recruitment for a vacancy no longer
-- needs to accept new applications, HR explicitly closes it. This is a one-way
-- workflow state change, NOT a deletion:
--
--   * The vacancy row, its description, requirements and every timestamp stay.
--   * Existing applications, CVs, AI screening results and selected candidates
--     are NOT touched — all remain accessible to the owning HR user.
--   * The public application link stays resolvable, but the public endpoint
--     stops accepting new applications for a non-published vacancy (already the
--     behaviour of getApplicableVacancyByToken since PB-03).
--
-- IMPORTANT — the only allowed transition is 'published' -> 'closed':
--   * 'draft' vacancies cannot be closed (nothing to close).
--   * 'closed' -> 'published' / 'closed' -> 'draft' are never allowed. Closing
--     is irreversible; the app layer and the conditional UPDATE both enforce it.
--
-- 'closed' was already an allowed value in job_vacancies_status_allowed
-- (migration 002), so no data migration is required and existing rows stay
-- valid. This migration only ADDS two audit columns + a supporting constraint.

alter table public.job_vacancies
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users (id);

comment on column public.job_vacancies.closed_at is
  'PB-08: server timestamp of the HR published -> closed transition. NULL unless status = closed.';
comment on column public.job_vacancies.closed_by is
  'PB-08: the HR (auth.users) user who closed this vacancy. NULL unless status = closed.';

-- A 'closed' vacancy must carry its audit trail; a non-closed one must not.
-- NOT VALID: enforced for new writes without a full-table rescan (existing rows
-- are already consistent — none are 'closed' yet). Mirrors the approach
-- migrations 003 and 006 used for their publish / selection audit fields.
alter table public.job_vacancies
  drop constraint if exists job_vacancies_closed_audit;
alter table public.job_vacancies
  add constraint job_vacancies_closed_audit
  check (
    (status = 'closed' and closed_at is not null and closed_by is not null)
    or (status <> 'closed' and closed_at is null and closed_by is null)
  ) not valid;

-- "Vacancies by status" is already indexed (job_vacancies_status_idx, migration
-- 002); closing needs no new index.

-- RLS is unchanged: job_vacancies keeps its per-owner SELECT / INSERT policies
-- for the authenticated role and no anon policy. Closing is a backend-only
-- mutation performed with the service-role key after the API layer has
-- authenticated the HR user and confirmed they own the vacancy. There is
-- deliberately no authenticated UPDATE policy — a leaked browser key cannot
-- change a vacancy's status.
