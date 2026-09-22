-- PB-17: interview scheduling/cancellation notifications.
-- Run after 012_create_interviews.sql.
-- (Renumbered from the plan's "011" — 011 and 012 were already taken by the
-- Step 3.1 availability table and the Step 3.3 interviews schema by the time
-- this step was built.)
--
-- Candidates have no account, so they are addressed by email
-- (recipient_email) rather than a profile; recipient_profile_id is only ever
-- set for in-app recipients (employees/HR). Exactly one of the two columns
-- must be present per row.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid references public.profiles (id) on delete cascade,
  recipient_email text,
  type text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),

  constraint notifications_type_not_blank check (length(btrim(type)) > 0),
  constraint notifications_title_not_blank check (length(btrim(title)) > 0),
  constraint notifications_body_not_blank check (length(btrim(body)) > 0),
  constraint notifications_has_recipient
    check (recipient_profile_id is not null or recipient_email is not null)
);

-- Serves the in-app unread badge / dropdown (PB-17 frontend).
create index if not exists notifications_recipient_read_idx
  on public.notifications (recipient_profile_id, read_at);
-- General recency ordering (e.g. an admin/ops view later).
create index if not exists notifications_created_at_idx
  on public.notifications (created_at desc);

alter table public.notifications enable row level security;

-- No policies for `anon` or `authenticated` — backend-only via the
-- service-role key, like every other table in this schema.

comment on table public.notifications is
  'PB-17: in-app (employees/HR) + recorded-for-email (candidates) notifications. Backend-only access (service role); no anon RLS policy.';
comment on column public.notifications.recipient_profile_id is
  'Set for in-app recipients (employees/HR). Null for a candidate, who has no profile/account.';
comment on column public.notifications.recipient_email is
  'Set for candidates, who are addressed by email since they have no account. Actual mail delivery is a seam (notification.transport.js) — sending is not built in PB-17.';
