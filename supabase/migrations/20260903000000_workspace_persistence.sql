-- Pre-auth profiles isolate each browser's data today. auth_user_id is ready
-- to be populated when Supabase Auth is introduced later.
create table if not exists public.app_profiles (
  id uuid primary key,
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  initialized boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  id text not null,
  code text not null,
  name text not null,
  credits smallint not null default 0 check (credits between 0 and 30),
  instructor text not null,
  room text not null,
  color text not null,
  soft_color text not null,
  initials text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, id)
);

-- One compact, versioned JSONB value per profile avoids a row per widget and
-- stores widgets as [type_code, size_code] tuples without UI-only instance IDs.
create table if not exists public.dashboard_state (
  profile_id uuid primary key references public.app_profiles(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint dashboard_payload_is_object check (jsonb_typeof(payload) = 'object')
);

alter table public.app_profiles enable row level security;
alter table public.courses enable row level security;
alter table public.dashboard_state enable row level security;

-- Browser clients have no direct table access. The server-side secret key uses
-- the service role, bypasses RLS, and scopes every query to the session profile.
revoke all on table public.app_profiles from anon, authenticated;
revoke all on table public.courses from anon, authenticated;
revoke all on table public.dashboard_state from anon, authenticated;
grant all on table public.app_profiles to service_role;
grant all on table public.courses to service_role;
grant all on table public.dashboard_state to service_role;

create index if not exists courses_profile_created_idx
  on public.courses (profile_id, created_at);

comment on table public.dashboard_state is
  'Compact versioned dashboard layout. v1 widgets are stored as [type_code, size_code] tuples.';
