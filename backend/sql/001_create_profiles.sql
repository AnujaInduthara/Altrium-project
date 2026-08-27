-- Step 0: HR authorization.
-- Run this once in the Supabase SQL editor for your project.
-- Links Supabase Auth users to an application-level role so the backend can
-- tell an authenticated user apart from an authorized HR user.

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'hr',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user may read their own profile. There is no insert/update/delete policy
-- for authenticated users: profile rows (and the HR role) are provisioned by
-- a trusted process using the service-role key, never by the end user. This
-- is what stops a browser from self-assigning the "hr" role.
create policy "Users can view their own profile"
  on public.profiles
  for select
  using (auth.uid() = auth_user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- To provision your first HR user:
--   1. Create the user in Authentication > Users (or have them sign up).
--   2. Copy their auth.users.id, then run:
--
-- insert into public.profiles (auth_user_id, email, role)
-- values ('<auth-user-uuid>', 'hr@example.com', 'hr');
