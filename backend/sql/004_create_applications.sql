-- PB-03: Applicant submits a CV application.
-- Run in the Supabase SQL editor after 003_add_vacancy_publishing.sql.
--
-- An external applicant (no account, no login) opens a published vacancy's
-- public application link, fills a short form, uploads a CV (PDF or DOCX) and
-- submits. The submission always goes through the backend, which talks to the
-- database with the service-role key and validates everything itself. There is
-- deliberately NO anon RLS policy — the browser never touches this table or the
-- CV storage bucket directly. AI screening, HR review and status transitions
-- beyond "submitted" belong to later backlog items (PB-04+).

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.job_vacancies (id),
  -- Safe, public-facing reference shown to the applicant (e.g. APP-1A2B3C4D).
  -- Never expose `id`.
  reference text not null unique,
  full_name text not null,
  email text not null,
  phone text not null,
  location text not null,
  -- Storage key inside the private `candidate-cvs` bucket. Never a public URL.
  cv_path text not null,
  cv_original_name text,
  cv_size_bytes integer,
  cv_content_type text,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint applications_full_name_not_blank check (length(btrim(full_name)) > 0),
  constraint applications_email_not_blank check (length(btrim(email)) > 0),
  constraint applications_phone_not_blank check (length(btrim(phone)) > 0),
  constraint applications_location_not_blank check (length(btrim(location)) > 0),
  constraint applications_cv_path_not_blank check (length(btrim(cv_path)) > 0),
  constraint applications_cv_size_non_negative
    check (cv_size_bytes is null or cv_size_bytes >= 0),
  -- 'submitted' is the only status PB-03 ever sets. The later values are listed
  -- now (mirroring how 002 pre-listed vacancy statuses) so PB-06/PB-07 only add
  -- transitions, never a schema change.
  constraint applications_status_allowed
    check (status in ('submitted', 'under_review', 'shortlisted', 'rejected', 'selected'))
);

-- Query patterns the next backlog items need: "applications for a vacancy",
-- "applications by this email", most-recent-first listings, and the short-window
-- accidental-duplicate check PB-03 runs on (vacancy_id, lower(email)).
create index if not exists applications_vacancy_id_idx
  on public.applications (vacancy_id);
create index if not exists applications_email_idx
  on public.applications (lower(email));
create index if not exists applications_vacancy_email_idx
  on public.applications (vacancy_id, lower(email));
create index if not exists applications_created_at_idx
  on public.applications (created_at desc);

-- Reuse the shared updated_at trigger function (defined in 001 / 002).
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
  before update on public.applications
  for each row
  execute function public.set_updated_at();

alter table public.applications enable row level security;

-- No policies for `anon` or `authenticated`. Like job_vacancies, all access is
-- backend-only via the service-role key, which bypasses RLS. RLS-with-no-policy
-- means a leaked anon/authenticated key still cannot read applicant PII or CVs.

-- ---------------------------------------------------------------------------
-- Private CV storage bucket.
-- `public = false`: objects are only reachable with the service-role key or a
-- short-lived signed URL the backend mints. CVs contain personal data and must
-- never be world-readable. No storage.objects policies are added, so the anon
-- and authenticated roles cannot list, read, or upload.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidate-cvs',
  'candidate-cvs',
  false,
  5242880, -- 5 MiB; keep in sync with CV_MAX_BYTES in the backend config
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

comment on table public.applications is
  'PB-03 applicant CV submissions. Backend-only access (service role); no anon RLS policy.';
comment on column public.applications.reference is
  'Public-facing application reference shown to the applicant. Not sensitive; `id` is never exposed.';
comment on column public.applications.cv_path is
  'Object key inside the private candidate-cvs bucket. Access only via backend / signed URL.';
