-- Additive foundation. Apply after the two existing migrations. Existing
-- profiles, courses, v1 layout payloads, and shared notes remain unchanged.
begin;

-- Every update advances the comparison token, including Google identity sync
-- and SQL operations outside the API. Existing tokens are preserved on install.
create or replace function public.advance_save_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 millisecond');
  return new;
end;
$$;
revoke all on function public.advance_save_revision() from public, anon, authenticated;
create trigger app_profiles_save_revision before update on public.app_profiles
  for each row execute function public.advance_save_revision();
create trigger dashboard_state_save_revision before update on public.dashboard_state
  for each row execute function public.advance_save_revision();
create trigger courses_save_revision before update on public.courses
  for each row execute function public.advance_save_revision();

-- Object bytes live in private Supabase Storage. Only the service API may read
-- metadata; future file endpoints must resolve the profile from verified Auth.
create table public.user_files (
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  course_id text,
  assignment_id text,
  kind text not null default 'resource' check (kind in ('resource', 'syllabus', 'class-image', 'attachment')),
  name text not null check (length(btrim(name)) between 1 and 255),
  mime_type text not null check (length(mime_type) between 1 and 160),
  size_bytes bigint not null check (size_bytes between 0 and 26214400),
  bucket_id text not null default 'eduessentials-private' check (bucket_id = 'eduessentials-private'),
  object_path text not null unique,
  state text not null default 'pending' check (state in ('pending', 'ready', 'deleting')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, id),
  foreign key (profile_id, course_id) references public.courses(profile_id, id)
    on delete set null (course_id),
  -- No caller-supplied path or another account's folder can be attached.
  constraint file_path_matches_owner check (object_path = profile_id::text || '/' || id::text),
  constraint file_assignment_needs_course check (assignment_id is null or course_id is not null)
);
create index user_files_profile_created_idx on public.user_files(profile_id, created_at);
alter table public.user_files enable row level security;
revoke all on public.user_files from public, anon, authenticated;
grant all on public.user_files to service_role;
create trigger user_files_save_revision before update on public.user_files
  for each row execute function public.advance_save_revision();
create or replace function public.detach_file_assignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.course_id is null then new.assignment_id := null; end if;
  return new;
end;
$$;
revoke all on function public.detach_file_assignment() from public, anon, authenticated;
create trigger user_files_detach_assignment before update of course_id on public.user_files
  for each row execute function public.detach_file_assignment();

-- Never silently repurpose a bucket that already exists with other settings.
insert into storage.buckets(id, name, public, file_size_limit)
values ('eduessentials-private', 'eduessentials-private', false, 26214400)
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'eduessentials-private'
      and public = false and file_size_limit = 26214400) then
    raise exception 'eduessentials-private must be private with a 25 MiB file limit';
  end if;
end;
$$;

-- Explicitly deny browser roles for this bucket even if the project already
-- contains broad permissive storage policies for other applications.
create policy eduessentials_private_server_only on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'eduessentials-private')
  with check (bucket_id <> 'eduessentials-private');

-- Step 5 will switch course create/import/delete to this transaction. A full
-- validated course snapshot and dashboard document commit together. The API
-- must supply both identity IDs from requireProfile(), never from request JSON.
create or replace function public.save_account_workspace(
  p_profile_id uuid, p_auth_user_id uuid, p_expected_revision timestamptz,
  p_courses jsonb, p_dashboard jsonb
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare current_revision timestamptz; saved_revision timestamptz;
begin
  perform 1 from public.app_profiles where id = p_profile_id
    and auth_user_id = p_auth_user_id and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account profile not ready' using errcode = '42501'; end if;
  select updated_at into current_revision from public.dashboard_state where profile_id = p_profile_id for update;
  if not found or p_expected_revision is null or current_revision <> p_expected_revision then
    raise exception 'Workspace changed in another session' using errcode = '40001';
  end if;
  if p_courses is null or jsonb_typeof(p_courses) <> 'array' then
    raise exception 'Invalid courses' using errcode = '22023';
  end if;
  if jsonb_array_length(p_courses) > 100 or p_dashboard is null
      or jsonb_typeof(p_dashboard) <> 'object' or octet_length(p_dashboard::text) > 1048576 then
    raise exception 'Invalid workspace' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_courses) c
      where jsonb_typeof(c) <> 'object' or coalesce(c->>'id', '') = '')
      or (select count(*) from jsonb_array_elements(p_courses)) <>
         (select count(distinct c->>'id') from jsonb_array_elements(p_courses) c) then
    raise exception 'Invalid or duplicate course IDs' using errcode = '22023';
  end if;
  -- Personal items use an empty courseId. Every nonempty reference must belong
  -- to the same account snapshot; another user's course cannot satisfy this.
  if exists (select 1 from (
      select jsonb_array_elements(coalesce(p_dashboard->'d'->'assignments', '[]')) as item
      union all
      select jsonb_array_elements(coalesce(p_dashboard->'d'->'manualEvents', '[]')) as item
    ) items where coalesce(item->>'courseId', '') <> ''
      and not exists (select 1 from jsonb_array_elements(p_courses) c where c->>'id' = item->>'courseId')) then
    raise exception 'Unknown course reference' using errcode = '23503';
  end if;
  insert into public.courses(profile_id, id, code, name, credits, instructor, room, color, soft_color, initials)
    select p_profile_id, c.id, c.code, c.name, c.credits, c.instructor, c.room, c.color, c.soft_color, c.initials
    from jsonb_to_recordset(p_courses) as c(id text, code text, name text, credits smallint, instructor text, room text, color text, soft_color text, initials text)
    on conflict (profile_id, id) do update set code = excluded.code, name = excluded.name,
      credits = excluded.credits, instructor = excluded.instructor, room = excluded.room,
      color = excluded.color, soft_color = excluded.soft_color, initials = excluded.initials;
  -- Keep files accessible as personal resources when their class/item is removed.
  update public.user_files f set assignment_id = null
    where f.profile_id = p_profile_id and f.assignment_id is not null
    and not exists (select 1 from jsonb_array_elements(coalesce(p_dashboard->'d'->'assignments', '[]')) a
      where a->>'id' = f.assignment_id and a->>'courseId' = f.course_id);
  delete from public.courses existing where profile_id = p_profile_id
    and not exists (select 1 from jsonb_array_elements(p_courses) c where c->>'id' = existing.id);
  update public.dashboard_state set payload = p_dashboard where profile_id = p_profile_id
    returning updated_at into saved_revision;
  return saved_revision;
end;
$$;
revoke all on function public.save_account_workspace(uuid, uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_account_workspace(uuid, uuid, timestamptz, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
