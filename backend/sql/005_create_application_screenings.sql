-- PB-05: System filters CVs using AI (AI-assisted CV screening).
-- Run in the Supabase SQL editor after 004_create_applications.sql.
--
-- After PB-03 stores a submitted application + its CV, the backend runs an
-- AI-assisted screening pass: it retrieves the private CV, extracts the text,
-- loads the associated vacancy's requirements, asks a server-side AI provider
-- to compare the two, validates the structured result, and stores it here.
--
-- IMPORTANT — the AI is an assistant, never the decision maker:
--   * The application's own `status` is untouched by this pipeline. It stays
--     'submitted'. Screening has its own lifecycle in `status` below.
--   * There is no 'hired' / 'rejected' / 'selected' value here. This table
--     cannot, by design, express a hiring decision. PB-06/PB-07 (a separate,
--     authenticated HR action) own that.
--
-- Access model: identical to `applications` — RLS is enabled with NO policies.
-- All reads/writes go through the backend using the service-role key. A leaked
-- anon/authenticated key cannot read screening scores, matched/missing skills
-- or any other internal HR signal.

create table if not exists public.application_screenings (
  id uuid primary key default gen_random_uuid(),

  -- One screening row per application. The UNIQUE constraint is the idempotency
  -- guard: duplicate submit triggers, queue retries, server restarts and manual
  -- retries all converge on the same row instead of creating parallel results.
  application_id uuid not null unique references public.applications (id) on delete cascade,

  -- Denormalized from the application for "screenings for a vacancy" queries and
  -- the score-ordered ranking index. Always the application's own vacancy_id.
  vacancy_id uuid not null references public.job_vacancies (id),

  -- Screening lifecycle, independent of the application status.
  --   pending    - row created, not yet processed
  --   processing - a worker has claimed it (see the conditional UPDATE in the
  --                service: pending/failed -> processing is the claim)
  --   completed  - a validated AI result is stored
  --   failed     - extraction or the AI step failed; the application and CV are
  --                untouched and remain available for manual HR review
  status text not null default 'pending',

  -- Normalized 0-100 job-relevance match strength. NOT a probability of hiring.
  -- Recomputed server-side from `score_breakdown` using documented weights
  -- (see screeningOptions.js) — it is not whatever number the model emitted.
  score integer,

  -- Advisory recommendation. Deliberately NOT hire/reject language.
  recommendation text,

  -- Extracted for display only. Never contributes to the score (see the prompt
  -- and validation layer).
  candidate_name text,

  -- Structured evidence for an explainable PB-06 view. JSONB arrays of short
  -- strings / objects.
  skills jsonb not null default '[]'::jsonb,
  matched_skills jsonb not null default '[]'::jsonb,
  missing_skills jsonb not null default '[]'::jsonb,

  experience_match text,
  education_match text,

  summary text,

  -- Per-dimension sub-scores + the weights used, so PB-06 can explain the score.
  score_breakdown jsonb not null default '{}'::jsonb,
  -- Optional supporting quotes/notes keyed by conclusion.
  evidence jsonb not null default '{}'::jsonb,

  -- AI metadata for auditability / reproducibility / future model upgrades.
  model_provider text,
  model_name text,
  screening_version text,

  -- Safe error category (never a raw provider message). One of the values in
  -- screeningOptions.ERROR_CODES.
  error_code text,
  -- Short internal diagnostic detail, scrubbed of secrets. Not shown to HR.
  error_detail text,

  attempts integer not null default 0,
  processing_started_at timestamptz,
  processing_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint application_screenings_status_allowed
    check (status in ('pending', 'processing', 'completed', 'failed')),

  -- Database-level protection of score integrity (defence in depth — the
  -- service validates this too, and rejects a model score of 120 or "ninety").
  constraint application_screenings_score_range
    check (score is null or (score >= 0 and score <= 100)),

  constraint application_screenings_recommendation_allowed
    check (recommendation is null or recommendation in (
      'STRONG_MATCH', 'GOOD_MATCH', 'PARTIAL_MATCH', 'WEAK_MATCH', 'INSUFFICIENT_INFORMATION'
    )),

  constraint application_screenings_experience_match_allowed
    check (experience_match is null or experience_match in (
      'STRONG', 'MODERATE', 'WEAK', 'NOT_DEMONSTRATED', 'INSUFFICIENT_INFORMATION'
    )),

  constraint application_screenings_education_match_allowed
    check (education_match is null or education_match in (
      'STRONG', 'MODERATE', 'WEAK', 'NOT_APPLICABLE', 'NOT_DEMONSTRATED', 'INSUFFICIENT_INFORMATION'
    )),

  constraint application_screenings_skill_arrays
    check (
      jsonb_typeof(skills) = 'array'
      and jsonb_typeof(matched_skills) = 'array'
      and jsonb_typeof(missing_skills) = 'array'
    ),

  constraint application_screenings_attempts_non_negative
    check (attempts >= 0),

  -- A completed screening must carry a score and a recommendation.
  constraint application_screenings_completed_is_scored
    check (
      status <> 'completed'
      or (score is not null and recommendation is not null)
    )
);

-- Query patterns: "screening for this application" (unique index already),
-- "screenings for a vacancy", status dashboards, and score-ordered ranking.
create index if not exists application_screenings_vacancy_id_idx
  on public.application_screenings (vacancy_id);
create index if not exists application_screenings_status_idx
  on public.application_screenings (status);
create index if not exists application_screenings_vacancy_score_idx
  on public.application_screenings (vacancy_id, score desc);

-- Reuse the shared updated_at trigger function (defined in 001 / 002 / 004).
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists application_screenings_set_updated_at on public.application_screenings;
create trigger application_screenings_set_updated_at
  before update on public.application_screenings
  for each row
  execute function public.set_updated_at();

alter table public.application_screenings enable row level security;

-- No policies for `anon` or `authenticated`. Like `applications`, every access
-- path is the backend using the service-role key (which bypasses RLS). Applicants
-- can never query screening scores, rankings or internal signals.

comment on table public.application_screenings is
  'PB-05 AI-assisted CV screening results. Backend-only access (service role); no anon RLS policy. Advisory only — never a hiring decision.';
comment on column public.application_screenings.score is
  'Normalized 0-100 job-relevance match strength, recomputed server-side from score_breakdown. NOT a probability of hiring.';
comment on column public.application_screenings.status is
  'Screening lifecycle (pending/processing/completed/failed), independent of applications.status which stays "submitted".';
