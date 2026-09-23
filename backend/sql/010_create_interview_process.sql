-- PB-09 … PB-12: the interview process schema.
-- Run in the Supabase SQL editor after 009_extend_profiles_employees.sql.
-- (Renumbered from the plan's "008" — 008 and 009 were already taken by the
-- PB-07 status audit and the Step 2.1 employee directory by the time this
-- step was built. Nothing below depends on the exact number.)
--
-- SCHEMA ONLY — no application code in this migration, so it can be reviewed
-- on its own.
--
-- Two layers:
--
--   TEMPLATE (shared, reusable) — interview_stages is a catalogue of stage
--   types. interview_stage_defaults proposes an ordered stage list per
--   (vacancy, level), falling back to a (level)-only GLOBAL default when
--   vacancy_id is null. PB-10 reads this to propose a starting process.
--
--   INSTANCE (per candidate) — when HR picks a level for a candidate (PB-09),
--   the matching defaults are COPIED into candidate_interview_stages under a
--   new candidate_interview_processes row. PB-11 (add/remove/reorder) and
--   PB-12 (per-stage interviewer requirements) then edit that COPY, never the
--   template.
--
-- Copying is what makes the rest safe: editing a template later can never
-- mutate an interview process that's already underway, and two candidates for
-- the same vacancy can legitimately end up with different processes.

-- ---------------------------------------------------------------------------
-- Shared trigger function (defined in 001 / 002 / 004 / 005 / 009; redefined
-- here idempotently in case this migration is ever applied to a fresh DB on
-- its own).
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 1. interview_stages — the stage catalogue (TEMPLATE).
-- ---------------------------------------------------------------------------
create table if not exists public.interview_stages (
  id uuid primary key default gen_random_uuid(),
  stage_key text not null unique,
  stage_name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists interview_stages_set_updated_at on public.interview_stages;
create trigger interview_stages_set_updated_at
  before update on public.interview_stages
  for each row
  execute function public.set_updated_at();

insert into public.interview_stages (stage_key, stage_name) values
  ('hr_behavioural', 'HR/Behavioural'),
  ('basic_technical', 'Basic Technical'),
  ('technical', 'Technical'),
  ('technical_1', 'Technical 1'),
  ('technical_2', 'Technical 2'),
  ('system_design', 'System Design'),
  ('leadership', 'Leadership'),
  ('accounting_knowledge', 'Accounting Knowledge'),
  ('hiring_manager', 'Hiring Manager'),
  ('final', 'Final')
on conflict (stage_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. interview_stage_defaults — proposed stage list per (vacancy, level),
--    falling back to a (level)-only global default (TEMPLATE).
-- ---------------------------------------------------------------------------
create table if not exists public.interview_stage_defaults (
  id uuid primary key default gen_random_uuid(),
  -- null = global default for this level; a value overrides it for that vacancy.
  vacancy_id uuid references public.job_vacancies (id) on delete cascade,
  interview_level text not null,
  stage_id uuid not null references public.interview_stages (id),
  stage_order integer not null,
  duration_minutes integer not null default 60,
  department text,
  minimum_seniority text,
  required_interviewers integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint interview_stage_defaults_level_allowed
    check (interview_level in ('intern', 'junior', 'mid', 'senior')),
  constraint interview_stage_defaults_stage_order_positive
    check (stage_order >= 1),
  constraint interview_stage_defaults_duration_range
    check (duration_minutes between 15 and 480),
  constraint interview_stage_defaults_seniority_allowed
    check (minimum_seniority is null or minimum_seniority in ('intern', 'junior', 'mid', 'senior', 'lead')),
  constraint interview_stage_defaults_required_interviewers_range
    check (required_interviewers between 1 and 5),

  -- Per-vacancy uniqueness. Postgres treats NULL vacancy_id as distinct, so
  -- this alone does NOT keep the global (vacancy_id is null) rows unique —
  -- the partial index below does that.
  constraint interview_stage_defaults_vacancy_level_order_unique
    unique (vacancy_id, interview_level, stage_order)
);

drop trigger if exists interview_stage_defaults_set_updated_at on public.interview_stage_defaults;
create trigger interview_stage_defaults_set_updated_at
  before update on public.interview_stage_defaults
  for each row
  execute function public.set_updated_at();

-- Keeps the global (vacancy_id is null) defaults unique per (level, order),
-- since a plain UNIQUE constraint never conflicts across NULLs.
create unique index if not exists interview_stage_defaults_global_level_order_uidx
  on public.interview_stage_defaults (interview_level, stage_order)
  where vacancy_id is null;

-- No separate index for "load the proposed stages for (vacancy, level), in
-- order" (PB-10): the UNIQUE constraint above already creates a btree index
-- on exactly (vacancy_id, interview_level, stage_order), so a second one
-- would just be a duplicate.

-- Seed the four global default processes (vacancy_id = null) from the backlog.
insert into public.interview_stage_defaults
  (vacancy_id, interview_level, stage_id, stage_order, duration_minutes, required_interviewers)
select null, seed.level, s.id, seed.stage_order, 60, 1
from (values
  ('intern', 'hr_behavioural', 1),
  ('intern', 'basic_technical', 2),
  ('intern', 'final', 3),
  ('junior', 'hr_behavioural', 1),
  ('junior', 'technical', 2),
  ('junior', 'hiring_manager', 3),
  ('mid', 'hr_behavioural', 1),
  ('mid', 'technical_1', 2),
  ('mid', 'technical_2', 3),
  ('mid', 'hiring_manager', 4),
  ('senior', 'hr_behavioural', 1),
  ('senior', 'technical', 2),
  ('senior', 'system_design', 3),
  ('senior', 'leadership', 4),
  ('senior', 'final', 5)
) as seed(level, stage_key, stage_order)
join public.interview_stages s on s.stage_key = seed.stage_key
on conflict (interview_level, stage_order) where vacancy_id is null do nothing;

-- ---------------------------------------------------------------------------
-- 3. candidate_interview_processes — one process per candidate (INSTANCE).
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_interview_processes (
  id uuid primary key default gen_random_uuid(),
  -- UNIQUE is the idempotency guard: one process per candidate application.
  application_id uuid not null unique references public.applications (id) on delete cascade,
  vacancy_id uuid not null references public.job_vacancies (id),
  interview_level text not null,
  status text not null default 'draft',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint candidate_interview_processes_level_allowed
    check (interview_level in ('intern', 'junior', 'mid', 'senior')),
  constraint candidate_interview_processes_status_allowed
    check (status in ('draft', 'active', 'completed', 'cancelled'))
);

drop trigger if exists candidate_interview_processes_set_updated_at on public.candidate_interview_processes;
create trigger candidate_interview_processes_set_updated_at
  before update on public.candidate_interview_processes
  for each row
  execute function public.set_updated_at();

-- Serves "processes for a vacancy" and status dashboards.
create index if not exists candidate_interview_processes_vacancy_id_idx
  on public.candidate_interview_processes (vacancy_id);
create index if not exists candidate_interview_processes_status_idx
  on public.candidate_interview_processes (status);

-- ---------------------------------------------------------------------------
-- 4. candidate_interview_stages — the copied, per-candidate stage list
--    (INSTANCE). HR edits this via PB-11/PB-12; the template is never
--    mutated by those edits.
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_interview_stages (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.candidate_interview_processes (id) on delete cascade,
  -- null = a custom stage HR added that isn't in the catalogue.
  stage_id uuid references public.interview_stages (id) on delete set null,
  -- Always stored at copy time, independent of interview_stages.stage_name, so
  -- renaming or deactivating a catalogue stage can never rewrite history.
  stage_name text not null,
  stage_order integer not null,
  duration_minutes integer not null default 60,
  department text,
  minimum_seniority text,
  required_interviewers integer not null default 1,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint candidate_interview_stages_stage_name_not_blank
    check (length(btrim(stage_name)) > 0),
  constraint candidate_interview_stages_stage_order_positive
    check (stage_order >= 1),
  constraint candidate_interview_stages_duration_range
    check (duration_minutes between 15 and 480),
  constraint candidate_interview_stages_seniority_allowed
    check (minimum_seniority is null or minimum_seniority in ('intern', 'junior', 'mid', 'senior', 'lead')),
  constraint candidate_interview_stages_required_interviewers_range
    check (required_interviewers between 1 and 5),
  constraint candidate_interview_stages_status_allowed
    check (status in ('pending', 'scheduled', 'completed', 'skipped')),

  constraint candidate_interview_stages_process_order_unique
    unique (process_id, stage_order)
);

drop trigger if exists candidate_interview_stages_set_updated_at on public.candidate_interview_stages;
create trigger candidate_interview_stages_set_updated_at
  before update on public.candidate_interview_stages
  for each row
  execute function public.set_updated_at();

-- "This process's stages, in order" (every read of a candidate's process) is
-- already served by the UNIQUE(process_id, stage_order) constraint's backing
-- index above — no separate index needed for that. Status dashboards do need
-- one:
create index if not exists candidate_interview_stages_status_idx
  on public.candidate_interview_stages (status);

-- ---------------------------------------------------------------------------
-- RLS: enabled, no policies, on all four tables — like applications and
-- application_screenings, every access path is the backend using the
-- service-role key (which bypasses RLS). A leaked anon/authenticated key can
-- read or write none of this.
-- ---------------------------------------------------------------------------
alter table public.interview_stages enable row level security;
alter table public.interview_stage_defaults enable row level security;
alter table public.candidate_interview_processes enable row level security;
alter table public.candidate_interview_stages enable row level security;

comment on table public.interview_stages is
  'TEMPLATE: catalogue of interview stage types (PB-09..PB-12). Backend-only access (service role); no anon RLS policy.';
comment on table public.interview_stage_defaults is
  'TEMPLATE: proposed stage list per (vacancy, level), falling back to a (level)-only global default when vacancy_id is null. Read by PB-10, copied by PB-09 — never mutated by a candidate''s own process.';
comment on table public.candidate_interview_processes is
  'INSTANCE: one interview process per candidate application (PB-09). UNIQUE(application_id) is the idempotency guard.';
comment on table public.candidate_interview_stages is
  'INSTANCE: the per-candidate stage list, COPIED from interview_stage_defaults when the process is created. PB-11/PB-12 edit this copy; editing a template afterwards can never change it.';
comment on column public.interview_stage_defaults.vacancy_id is
  'Null = global default for this interview_level. A value overrides the global default for that vacancy + level.';
comment on column public.candidate_interview_stages.stage_name is
  'Copied from interview_stages.stage_name at process-creation time (or HR-entered for a custom stage). Never re-derived from the catalogue, so a later rename/deactivation cannot rewrite an in-flight process.';
comment on column public.candidate_interview_stages.stage_id is
  'References the catalogue stage this was copied from. Null for a custom, HR-added stage (PB-11). ON DELETE SET NULL: deleting a catalogue stage never deletes per-candidate history.';
