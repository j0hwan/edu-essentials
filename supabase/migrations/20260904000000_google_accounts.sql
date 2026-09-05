-- Account identity is verified by Supabase Auth; no passwords are stored here.
alter table public.app_profiles
  add column if not exists email text not null default '',
  add column if not exists display_name text not null default '',
  add column if not exists last_name text not null default '',
  add column if not exists avatar_url text,
  add column if not exists university text not null default '',
  add column if not exists major text not null default '',
  add column if not exists academic_year text not null default '',
  add column if not exists age smallint check (age between 1 and 120),
  add column if not exists study_goal text not null default '',
  add column if not exists academic_structure text not null default '',
  add column if not exists gpa_system text not null default '',
  add column if not exists current_term text not null default '',
  add column if not exists week_starts_on text not null default '',
  add column if not exists timezone text not null default '',
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- Keep direct browser access closed. Server queries use verified auth_user_id.
revoke all on table public.app_profiles, public.courses, public.dashboard_state from anon, authenticated;

-- Profile creation follows verified Google signup, even before the app callback.
create or replace function public.create_google_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_app_meta_data ->> 'provider' = 'google' then
    insert into public.app_profiles (id, auth_user_id, email, display_name, avatar_url)
    values (gen_random_uuid(), new.id, coalesce(new.email, ''),
      left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 160),
      new.raw_user_meta_data ->> 'avatar_url')
    on conflict (auth_user_id) do update set email = excluded.email, avatar_url = excluded.avatar_url;
  end if;
  return new;
end;
$$;
revoke all on function public.create_google_profile() from public, anon, authenticated;
create trigger on_google_user_created after insert on auth.users
  for each row execute function public.create_google_profile();
create trigger on_google_user_updated after update of email, raw_user_meta_data on auth.users
  for each row execute function public.create_google_profile();

comment on column public.app_profiles.auth_user_id is 'Only a server-verified Supabase Google identity may own this profile. Legacy anonymous profiles are never automatically claimed.';

-- Serialize first-load setup across tabs/devices. A later initialize request
-- must never overwrite a layout that has already been saved.
create or replace function public.initialize_account_workspace(p_profile_id uuid, p_courses jsonb, p_dashboard jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare ready boolean;
begin
  select initialized into ready from public.app_profiles
    where id = p_profile_id and auth_user_id is not null and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account profile not ready'; end if;
  if ready then return; end if;
  insert into public.courses (profile_id, id, code, name, credits, instructor, room, color, soft_color, initials)
    select p_profile_id, c.id, c.code, c.name, c.credits, c.instructor, c.room, c.color, c.soft_color, c.initials
    from jsonb_to_recordset(p_courses) as c(id text, code text, name text, credits smallint, instructor text, room text, color text, soft_color text, initials text)
    on conflict (profile_id, id) do nothing;
  insert into public.dashboard_state (profile_id, payload) values (p_profile_id, p_dashboard)
    on conflict (profile_id) do nothing;
  update public.app_profiles set initialized = true, updated_at = now() where id = p_profile_id;
end;
$$;
revoke all on function public.initialize_account_workspace(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.initialize_account_workspace(uuid, jsonb, jsonb) to service_role;
