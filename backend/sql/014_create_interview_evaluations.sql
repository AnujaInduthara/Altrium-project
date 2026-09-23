-- PB-19: an interviewer's structured evaluation of a candidate they
-- interviewed. Run after 012_create_interviews.sql.
-- (Renumbered from the plan's "012" — 012 and 013 were already taken by the
-- Step 3.3 interviews schema and the PB-17 notifications table by the time
-- this step was built.)
--
-- overall_rating is ALWAYS computed by the backend (the mean of the four
-- dimension ratings, rounded to 2dp — see evaluationValidation.js) and never
-- accepted verbatim from a client, the same principle PB-05 already applies
-- to the AI screening score.
--
-- UNIQUE (interview_id, interviewer_profile_id) is the real guarantee behind
-- "one evaluation per interviewer per interview" (evaluation.service.js's
-- pre-check exists only to produce a friendly 409 before the round trip).

create table if not exists public.interview_evaluations (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  interviewer_profile_id uuid not null references public.profiles (id),
  technical_rating integer not null,
  problem_solving_rating integer not null,
  communication_rating integer not null,
  role_knowledge_rating integer not null,
  overall_rating numeric(3,2) not null,
  comments text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint interview_evaluations_technical_rating_range
    check (technical_rating between 1 and 5),
  constraint interview_evaluations_problem_solving_rating_range
    check (problem_solving_rating between 1 and 5),
  constraint interview_evaluations_communication_rating_range
    check (communication_rating between 1 and 5),
  constraint interview_evaluations_role_knowledge_rating_range
    check (role_knowledge_rating between 1 and 5),
  constraint interview_evaluations_overall_rating_range
    check (overall_rating >= 1 and overall_rating <= 5),
  constraint interview_evaluations_comments_length
    check (comments is null or length(comments) <= 4000),

  constraint interview_evaluations_unique_per_interviewer
    unique (interview_id, interviewer_profile_id)
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists interview_evaluations_set_updated_at on public.interview_evaluations;
create trigger interview_evaluations_set_updated_at
  before update on public.interview_evaluations
  for each row
  execute function public.set_updated_at();

-- Serves "every evaluation for this interview" (the completion-count check in
-- evaluation.service.js, and a future Hiring Manager detail view in Phase 5).
create index if not exists interview_evaluations_interview_id_idx
  on public.interview_evaluations (interview_id);

alter table public.interview_evaluations enable row level security;

-- No policies for `anon` or `authenticated` — backend-only via the
-- service-role key, like every other table in this schema.

comment on table public.interview_evaluations is
  'PB-19: one interviewer''s structured evaluation of one interview. UNIQUE(interview_id, interviewer_profile_id) is the idempotency guard. Backend-only access (service role); no anon RLS policy.';
comment on column public.interview_evaluations.overall_rating is
  'Computed server-side as the mean of the four dimension ratings, rounded to 2dp (evaluationValidation.js computeOverallRating). Never accepted verbatim from a client.';
