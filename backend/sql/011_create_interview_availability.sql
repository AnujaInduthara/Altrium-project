-- PB-13: an employee publishes their own interview availability.
-- Run in the Supabase SQL editor after 010_create_interview_process.sql.
-- (Renumbered from the plan's "009" — 009 and 010 were already taken by the
-- Step 2.1 employee directory and the Step 2.2 interview process schema by
-- the time this step was built.)
--
-- Interviewers are ordinary employees using their existing account — there is
-- no separate "interviewer" role or table. Any active profile whose role can
-- conduct interviews (employee/hr/hiring_manager — see
-- backend/src/config/roles.js) manages their own calendar here.

create extension if not exists btree_gist;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.interview_availability (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint interview_availability_end_after_start check (end_time > start_time)
);

drop trigger if exists interview_availability_set_updated_at on public.interview_availability;
create trigger interview_availability_set_updated_at
  before update on public.interview_availability
  for each row
  execute function public.set_updated_at();

-- THE real guarantee against overlapping slots for one employee on one day.
-- backend/src/services/availability.service.js also checks this in the
-- application layer, but only to turn the resulting error into a friendly
-- 409 SLOT_OVERLAP — that check can never be fully trusted on its own (a
-- client could bypass the API, or two requests could race each other). A
-- GiST exclusion constraint is checked by Postgres itself as part of the same
-- INSERT/UPDATE transaction, so it holds even then: two rows for the same
-- profile_id + slot_date whose [start_time, end_time) ranges overlap can
-- never both exist, full stop.
alter table public.interview_availability
  add constraint interview_availability_no_overlap
  exclude using gist (
    profile_id with =,
    slot_date with =,
    tsrange(('2000-01-01'::date + start_time), ('2000-01-01'::date + end_time)) with &&
  );

-- "This employee's own slots" (their calendar) and "every slot on this date"
-- (Step 3.2's HR-side interviewer-availability lookup).
create index if not exists interview_availability_profile_date_idx
  on public.interview_availability (profile_id, slot_date);
create index if not exists interview_availability_slot_date_idx
  on public.interview_availability (slot_date);

alter table public.interview_availability enable row level security;

-- No policies for `anon` or `authenticated`. Every access path is the backend
-- using the service-role key, which scopes every query/mutation to
-- req.profile.id — there is no endpoint that takes another profile's id.

comment on table public.interview_availability is
  'PB-13: an employee''s self-published interview availability. Backend-only access (service role); no anon RLS policy.';
comment on column public.interview_availability.profile_id is
  'The employee who published this slot. Every query/mutation is scoped to the caller''s own profile id.';
comment on constraint interview_availability_no_overlap on public.interview_availability is
  'The real guarantee against overlapping slots for one employee on one day — see the file header comment.';
