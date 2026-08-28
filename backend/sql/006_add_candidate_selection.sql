-- PB-07: HR selects candidates.
-- Run in the Supabase SQL editor after 005_create_application_screenings.sql.
--
-- After reviewing the AI-screened applicants (PB-06), HR explicitly selects the
-- applicants who should proceed to the interview process. A "candidate" is not a
-- new entity — it is an application whose lifecycle has advanced to 'selected'.
-- The application keeps every existing relationship (vacancy, CV, AI screening).
--
-- IMPORTANT — this is the HR decision, never the AI's:
--   * The AI screening row in application_screenings is NOT touched here. Its
--     score / rank / matched-missing skills / summary remain exactly as PB-05
--     stored them. It stays advisory evidence.
--   * The CV file and its metadata are NOT touched here.
--   * Only 'submitted' -> 'selected' is a valid transition (see the app layer).
--     'rejected' applications and applications from other vacancies can never be
--     selected.
--
-- This migration only ADDS two audit columns + supporting constraints/index.
-- 'selected' was already an allowed value in applications_status_allowed
-- (migration 004), so no data migration is required and existing rows are valid.

alter table public.applications
  add column if not exists selected_at timestamptz,
  add column if not exists selected_by uuid references auth.users (id);

comment on column public.applications.selected_at is
  'PB-07: server timestamp of the HR submitted -> selected transition. NULL unless status = selected.';
comment on column public.applications.selected_by is
  'PB-07: the HR (auth.users) user who selected this applicant as a candidate. NULL unless status = selected.';

-- A 'selected' application must carry its audit trail; a non-selected one must
-- not. NOT VALID: enforced for new writes without a full-table rescan (existing
-- rows are already consistent — none are 'selected' yet). Mirrors the approach
-- migration 003 used for the publish audit fields.
alter table public.applications
  drop constraint if exists applications_selected_audit;
alter table public.applications
  add constraint applications_selected_audit
  check (
    (status = 'selected' and selected_at is not null and selected_by is not null)
    or (status <> 'selected' and selected_at is null and selected_by is null)
  ) not valid;

-- "Selected candidates for this vacancy" is the core PB-07 / Sprint-2 read.
create index if not exists applications_vacancy_status_idx
  on public.applications (vacancy_id, status);

-- RLS is unchanged: applications has RLS enabled with NO policies. Candidate
-- selection is a backend-only mutation performed with the service-role key after
-- the API layer has authenticated the HR user, confirmed they own the parent
-- vacancy, and verified every application belongs to that vacancy. There is
-- deliberately no anon / authenticated policy — a leaked browser key cannot
-- select candidates or read applicant data.
