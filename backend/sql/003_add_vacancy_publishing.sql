-- PB-02: HR publishes a job vacancy (DRAFT -> PUBLISHED).
-- Run in the Supabase SQL editor after 002_create_job_vacancies.sql.
--
-- Publishing (backend only, service-role) generates a cryptographically random,
-- URL-safe public_token that backs a public application link:
--   ${APP_URL}/apply.html#token=<public_token>
-- The internal uuid `id` is never exposed in that link. PB-03 will build the
-- actual applicant experience on top of this token.

alter table public.job_vacancies
  add column if not exists public_token text,
  add column if not exists published_at timestamptz;

-- Unique when set. Postgres treats NULLs as distinct, so any number of DRAFT
-- rows (public_token IS NULL) coexist, but two vacancies can never share a
-- token. This is the database-level guard against token collisions.
create unique index if not exists job_vacancies_public_token_key
  on public.job_vacancies (public_token);

-- A published vacancy must carry both a token and a published_at timestamp.
-- NOT VALID keeps the migration safe against any pre-existing rows; every
-- insert/update from now on is checked.
alter table public.job_vacancies
  drop constraint if exists job_vacancies_published_fields_present;
alter table public.job_vacancies
  add constraint job_vacancies_published_fields_present
  check (
    status <> 'published'
    or (public_token is not null and published_at is not null)
  )
  not valid;

comment on column public.job_vacancies.public_token is
  'URL-safe random token for the public application link. Set once, at publish time.';
comment on column public.job_vacancies.published_at is
  'Timestamp of the DRAFT -> PUBLISHED transition. NULL while the vacancy is a draft.';

-- RLS is intentionally unchanged: the backend performs publishing with the
-- service-role key and enforces authentication + HR ownership itself. There is
-- deliberately NO public/anon UPDATE or SELECT policy on job_vacancies — the
-- public "view a published vacancy" path also goes through the backend.
