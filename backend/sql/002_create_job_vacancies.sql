-- PB-01: HR creates a job vacancy.
-- Run this once in the Supabase SQL editor, after 001_create_profiles.sql.
--
-- A job vacancy is created by an authenticated HR user and starts life as a
-- DRAFT. Publishing, public application links, applicant storage and AI CV
-- screening are later backlog items (PB-02+) and are intentionally NOT
-- modelled here. `status` allows the future values so that later steps only
-- add transitions, never a schema change.
--
-- job_requirements is stored as a JSONB array of short strings, e.g.
--   ["Python", "FastAPI", "PostgreSQL", "Git", "JavaScript"]
-- This keeps the data trivially machine-readable for the future AI CV
-- screening step (PB-05) without introducing a normalized skills taxonomy now.

create table if not exists public.job_vacancies (
  id uuid primary key default gen_random_uuid(),
  job_title text not null,
  department text not null,
  location text not null,
  employment_type text not null,
  experience_level text not null,
  number_of_positions integer not null,
  job_description text not null,
  job_requirements jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint job_vacancies_job_title_not_blank
    check (length(btrim(job_title)) > 0),
  constraint job_vacancies_department_not_blank
    check (length(btrim(department)) > 0),
  constraint job_vacancies_location_not_blank
    check (length(btrim(location)) > 0),
  constraint job_vacancies_employment_type_not_blank
    check (length(btrim(employment_type)) > 0),
  constraint job_vacancies_experience_level_not_blank
    check (length(btrim(experience_level)) > 0),
  constraint job_vacancies_job_description_not_blank
    check (length(btrim(job_description)) > 0),
  constraint job_vacancies_positions_positive
    check (number_of_positions >= 1),
  constraint job_vacancies_requirements_is_array
    check (jsonb_typeof(job_requirements) = 'array'),
  constraint job_vacancies_status_allowed
    check (status in ('draft', 'published', 'closed'))
);

-- Indexes for the query patterns this and the next few backlog items need:
-- "my vacancies", "vacancies by status", most-recent-first listings.
create index if not exists job_vacancies_created_by_idx
  on public.job_vacancies (created_by);
create index if not exists job_vacancies_status_idx
  on public.job_vacancies (status);
create index if not exists job_vacancies_created_at_idx
  on public.job_vacancies (created_at desc);

alter table public.job_vacancies enable row level security;

-- The backend talks to the database with the service-role key and enforces
-- authentication + HR authorization itself (see auth.middleware.js). These
-- policies exist as defence in depth: even if a browser (anon/authenticated
-- key) ever queried this table directly, an HR user could only read or create
-- their OWN vacancies and could never insert one as another creator or with a
-- non-draft status. There is deliberately no policy for the anon role.
drop policy if exists "HR can view their own vacancies" on public.job_vacancies;
create policy "HR can view their own vacancies"
  on public.job_vacancies
  for select
  to authenticated
  using (auth.uid() = created_by);

drop policy if exists "HR can create their own draft vacancies" on public.job_vacancies;
create policy "HR can create their own draft vacancies"
  on public.job_vacancies
  for insert
  to authenticated
  with check (auth.uid() = created_by and status = 'draft');

-- Reuse the shared updated_at trigger function (also defined in 001). Repeated
-- here with create-or-replace so this migration is runnable on its own.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists job_vacancies_set_updated_at on public.job_vacancies;
create trigger job_vacancies_set_updated_at
  before update on public.job_vacancies
  for each row
  execute function public.set_updated_at();
