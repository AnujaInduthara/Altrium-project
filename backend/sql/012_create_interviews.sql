-- PB-15/PB-16: assign interviewer(s) and schedule an interview for a
-- candidate_interview_stage. Run after 011_create_interview_availability.sql.
-- (Renumbered from the plan's "010" — 010 and 011 were already taken by the
-- Step 2.2 interview process schema and the Step 3.1 availability table by
-- the time this step was built.)
--
-- The database, not the application, is the final guard against double
-- booking (DEVELOPMENT_PLAN.md Phase 3's rule #2). Application-level checks
-- in interview.service.js exist only to produce a friendly error message
-- before the round trip — the real guarantee is the exclusion constraint on
-- interview_interviewers below.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 1. interviews — one row per booked interview.
-- ---------------------------------------------------------------------------
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  -- UNIQUE: one interview per stage. This is the idempotency guard PB-15/16
  -- relies on — a duplicate schedule request for the same stage becomes a
  -- typed 409, not a second booking.
  candidate_stage_id uuid not null unique references public.candidate_interview_stages (id) on delete cascade,
  -- Denormalized from the stage's process for cheap ownership/list queries —
  -- always kept in sync with candidate_interview_processes at insert time.
  application_id uuid not null references public.applications (id),
  vacancy_id uuid not null references public.job_vacancies (id),
  scheduled_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'scheduled',
  scheduled_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint interviews_end_after_start check (end_time > start_time),
  constraint interviews_status_allowed
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show'))
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists interviews_set_updated_at on public.interviews;
create trigger interviews_set_updated_at
  before update on public.interviews
  for each row
  execute function public.set_updated_at();

-- Serves HR's interview list, filtered/ordered by vacancy and date.
create index if not exists interviews_vacancy_scheduled_date_idx
  on public.interviews (vacancy_id, scheduled_date);

alter table public.interviews enable row level security;

-- ---------------------------------------------------------------------------
-- 2. interview_interviewers — join table from day one. The brief ships
--    single-interviewer scheduling first, but required_interviewers on
--    candidate_interview_stages drives how many rows land here — nothing in
--    this schema assumes exactly one, so supporting a panel later needs no
--    migration.
-- ---------------------------------------------------------------------------
create table if not exists public.interview_interviewers (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  -- Denormalised from interviews at insert time. A GiST exclusion constraint
  -- cannot reach into another table to check interviews.scheduled_date /
  -- start_time / end_time directly, so copying them onto this row is the
  -- only way Postgres can enforce "one interviewer, one place at a time"
  -- atomically, in one constraint, with no possible race.
  scheduled_date date not null,
  start_time time not null,
  end_time time not null,
  -- Non-null once this booking is cancelled. The exclusion constraint below
  -- is partial (where cancelled_at is null) so cancelling frees the
  -- interviewer's time immediately without deleting the audit row.
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint interview_interviewers_end_after_start check (end_time > start_time),
  constraint interview_interviewers_unique_per_interview unique (interview_id, profile_id)
);

drop trigger if exists interview_interviewers_set_updated_at on public.interview_interviewers;
create trigger interview_interviewers_set_updated_at
  before update on public.interview_interviewers
  for each row
  execute function public.set_updated_at();

-- THE real guarantee against double-booking an interviewer (see the file
-- header comment): two NON-CANCELLED rows for the same profile_id +
-- scheduled_date whose [start_time, end_time) ranges overlap can never both
-- exist — checked by Postgres itself, atomically, as part of the same INSERT
-- that would otherwise create the conflict, so two concurrent schedule
-- requests for the same interviewer/time can never both win.
alter table public.interview_interviewers
  add constraint interview_interviewers_no_overlap
  exclude using gist (
    profile_id with =,
    scheduled_date with =,
    tsrange(('2000-01-01'::date + start_time), ('2000-01-01'::date + end_time)) with &&
  ) where (cancelled_at is null);

-- Serves the interviewer's own upcoming-interviews view (Phase 4) and the
-- application-layer "is this employee free right now" pre-check.
create index if not exists interview_interviewers_profile_date_idx
  on public.interview_interviewers (profile_id, scheduled_date);

alter table public.interview_interviewers enable row level security;

-- No policies for `anon` or `authenticated` on either table — backend-only
-- via the service-role key, like every other table in this schema.

comment on table public.interviews is
  'PB-15/PB-16: one booked interview per candidate_interview_stage (UNIQUE candidate_stage_id). Backend-only access (service role); no anon RLS policy.';
comment on table public.interview_interviewers is
  'PB-15/PB-16: join table between interviews and profiles — supports multiple interviewers per interview from day one. scheduled_date/start_time/end_time are denormalised from interviews so the GiST exclusion constraint below can enforce no-double-booking without reaching into another table.';
comment on constraint interview_interviewers_no_overlap on public.interview_interviewers is
  'The real guarantee against double-booking an interviewer — see the file header comment. Partial (cancelled_at is null) so a cancelled booking frees the slot immediately.';
comment on column public.interview_interviewers.cancelled_at is
  'Null while the booking is active. Set instead of deleting the row, so the exclusion constraint''s partial index can exclude it from overlap checks while keeping the audit trail.';
