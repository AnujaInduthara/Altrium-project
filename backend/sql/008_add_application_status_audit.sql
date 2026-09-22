-- PB-07: HR moves an applicant through the full review lifecycle.
-- Run in the Supabase SQL editor after 007_add_vacancy_closing.sql.
--
-- Migration 006 added a one-step 'submitted' -> 'selected' shortcut (the bulk
-- "Select Candidates" page) with its own selected_at/selected_by audit pair.
-- This migration generalises that into the full status lifecycle already
-- allowed by the applications_status_allowed check constraint (migration 004):
-- submitted -> under_review / shortlisted / rejected -> shortlisted / selected,
-- with rejected -> under_review to re-open a mistaken rejection. Every
-- transition (including the existing bulk-select shortcut) now stamps the same
-- audit trail, so there is one record of who changed an applicant's status and
-- when, plus an optional internal note.
--
-- The AI is never the actor here: application_screenings (PB-05) is untouched
-- by any status change, and status_updated_by always points at the HR user who
-- made the call.

alter table public.applications
  add column if not exists status_updated_at timestamptz,
  add column if not exists status_updated_by uuid references auth.users (id),
  add column if not exists hr_note text;

comment on column public.applications.status_updated_at is
  'PB-07: server timestamp of the most recent HR status change (any transition, including submitted -> selected).';
comment on column public.applications.status_updated_by is
  'PB-07: the HR (auth.users) user who made the most recent status change.';
comment on column public.applications.hr_note is
  'PB-07: optional internal note attached to the most recent status change. Never shown to the candidate.';

alter table public.applications
  add constraint applications_hr_note_max_length check (hr_note is null or length(hr_note) <= 1000);

-- "Selected candidates" / "applicants by status for this vacancy" is already
-- indexed by applications_vacancy_status_idx (migration 006); no new index.

-- RLS is unchanged: backend-only via the service-role key, as every other
-- application mutation.
