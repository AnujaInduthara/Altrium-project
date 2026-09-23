-- PB-21: the Hiring Manager's final Hire/Reject decision. Run after
-- 014_create_interview_evaluations.sql.
-- (Renumbered from the plan's "013" — 013 and 014 were already taken by the
-- PB-17 notifications table and the Step 4.2 interview evaluations table by
-- the time this step was built.)

-- ---------------------------------------------------------------------------
-- 1. MIGRATION GOTCHA #1 (the one the plan calls out): migration 004's
--    applications_status_allowed check does NOT include 'hired'. Drop and
--    recreate it with the new value — every existing value is kept exactly
--    as-is, so no data migration is needed.
-- ---------------------------------------------------------------------------
alter table public.applications
  drop constraint if exists applications_status_allowed;
alter table public.applications
  add constraint applications_status_allowed
  check (status in ('submitted', 'under_review', 'shortlisted', 'rejected', 'selected', 'hired'));

-- ---------------------------------------------------------------------------
-- 2. MIGRATION GOTCHA #2 (not called out by name in the plan, but the same
--    species of bug): migration 006's applications_selected_audit is a
--    two-way biconditional — status = 'selected' IFF selected_at/selected_by
--    are set. That was harmless while 'selected' had no outgoing transitions
--    (nothing ever left the status, so the reverse direction never fired).
--    PB-21 adds the first ones (selected -> hired, selected -> rejected), and
--    the reverse direction would then demand selected_at/selected_by be
--    NULLED OUT the moment a candidate is hired or rejected — destroying the
--    "when were they selected" audit trail application.service.js's own
--    comments already assume never happens. Loosen it to the one-way
--    implication its surrounding code already assumed: being 'selected'
--    requires the audit fields, but leaving 'selected' later never clears
--    them.
-- ---------------------------------------------------------------------------
alter table public.applications
  drop constraint if exists applications_selected_audit;
alter table public.applications
  add constraint applications_selected_audit
  check (status <> 'selected' or (selected_at is not null and selected_by is not null))
  not valid;

-- ---------------------------------------------------------------------------
-- 3. hiring_decisions — one row per decided application (INSTANCE).
-- ---------------------------------------------------------------------------
create table if not exists public.hiring_decisions (
  id uuid primary key default gen_random_uuid(),
  -- UNIQUE is the idempotency guard: one decision per application, ever.
  application_id uuid not null unique references public.applications (id) on delete cascade,
  -- Denormalized from the application at decision time for cheap per-vacancy
  -- listings/audits — always the application's own vacancy_id.
  vacancy_id uuid not null references public.job_vacancies (id),
  hiring_manager_profile_id uuid not null references public.profiles (id),
  decision text not null,
  -- Required when decided with incomplete stages (acknowledge_incomplete);
  -- optional otherwise. hiringDecision.service.js enforces the "required
  -- when incomplete" half — the DB only enforces the length cap.
  reason text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hiring_decisions_decision_allowed check (decision in ('hired', 'rejected')),
  constraint hiring_decisions_reason_length check (reason is null or length(reason) <= 2000)
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists hiring_decisions_set_updated_at on public.hiring_decisions;
create trigger hiring_decisions_set_updated_at
  before update on public.hiring_decisions
  for each row
  execute function public.set_updated_at();

-- Serves "this vacancy's recent decisions" (a future reporting view).
create index if not exists hiring_decisions_vacancy_decided_at_idx
  on public.hiring_decisions (vacancy_id, decided_at desc);

alter table public.hiring_decisions enable row level security;

-- No policies for `anon` or `authenticated` — backend-only via the
-- service-role key, like every other table in this schema.

comment on table public.hiring_decisions is
  'PB-21: the Hiring Manager''s final Hire/Reject decision for one application. UNIQUE(application_id) is the idempotency guard — one decision per application, ever. Backend-only access (service role); no anon RLS policy.';
comment on column public.hiring_decisions.reason is
  'Required by the application layer when decided with incomplete interview stages (acknowledge_incomplete); optional otherwise. Never shown to the candidate (see the PB-22 notification templates).';
