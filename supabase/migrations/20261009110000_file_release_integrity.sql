-- Keep file-folder browsing complete and account-coherent beyond PostgREST's
-- default row cap, and let the syllabus preservation trigger retain edits to
-- archived managed courses through its private legacy document path.
begin;

create function public.read_account_file_browser(p_profile_id uuid, p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform 1 from public.app_profiles as profile_row
    where profile_row.id = p_profile_id and profile_row.auth_user_id = p_auth_user_id
      and profile_row.initialized and profile_row.onboarding_completed_at is not null
    for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;

  select jsonb_build_object(
    'folders', (select coalesce(jsonb_agg(to_jsonb(folder_row) order by folder_row.id), '[]'::jsonb)
      from public.file_folders as folder_row
      where folder_row.profile_id = p_profile_id
        and folder_row.deleted_at is null),
    'activities', (select coalesce(jsonb_agg(to_jsonb(activity_row) order by activity_row.folder_id), '[]'::jsonb)
      from public.folder_activity as activity_row
      join public.file_folders as folder_row
        on folder_row.profile_id = activity_row.profile_id and folder_row.id = activity_row.folder_id
      where activity_row.profile_id = p_profile_id
        and folder_row.deleted_at is null)
  ) into result;
  return result;
end;
$$;
revoke all on function public.read_account_file_browser(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_account_file_browser(uuid, uuid) to service_role;

-- Internal syllabus preservation must retain its established profile lock,
-- file-limit, AI preference, Trash, and managed-folder checks. Archived roots
-- are read-only through the public document RPC, so only this trigger's copy
-- uses the revoked legacy implementation to bypass that user-write guard.
create or replace function public.preserve_replaced_course_syllabi()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  entry record;
  course_name text;
  course_code text;
  old_body text;
  new_body text;
  folder_id uuid;
  file_id uuid;
  file_name text;
  ai_enabled boolean;
  auth_user_id uuid;
begin
  -- Workspace RPCs acquire this lock before the dashboard row. Raw service-role
  -- DML is revoked below so it cannot reverse that lock order.
  select profile_row.auth_user_id into auth_user_id
    from public.app_profiles as profile_row
    where profile_row.id = old.profile_id and profile_row.initialized
      and profile_row.onboarding_completed_at is not null
    for update;
  if not found then
    raise exception 'Account profile not ready' using errcode = '42501';
  end if;

  for entry in
    select detail.key, detail.value
      from jsonb_each(case
        when jsonb_typeof(old.payload -> 'd' -> 'courseDetails') = 'object'
          then old.payload -> 'd' -> 'courseDetails'
        else '{}'::jsonb
      end) as detail
  loop
    if jsonb_typeof(entry.value -> 'syllabusText') is distinct from 'string' then continue; end if;
    old_body := entry.value ->> 'syllabusText';
    if old_body = '' then continue; end if;
    new_body := (new.payload -> 'd' -> 'courseDetails' -> entry.key) ->> 'syllabusText';
    if old_body is not distinct from new_body then continue; end if;

    -- Deletions are already retained by guard_course_lifecycle(). Skip their
    -- rows here so a removed class does not get a second copy of the same text.
    select course_row.name, course_row.code into course_name, course_code
      from public.courses as course_row
      where course_row.profile_id = old.profile_id and course_row.id = entry.key;
    if not found then continue; end if;

    if octet_length(convert_to(old_body, 'UTF8')) > 1048576 then
      raise exception 'PRESERVE_SYLLABUS_REPLACEMENT: previous syllabus exceeds the 1 MiB native document limit'
        using errcode = 'P0001';
    end if;

    folder_id := public.ensure_managed_course_folder(old.profile_id, entry.key, course_name, course_code);
    if not public.file_folder_location_is_active(old.profile_id, folder_id) then
      raise exception 'PRESERVE_SYLLABUS_REPLACEMENT: course folder is in Trash'
        using errcode = 'P0001';
    end if;
    if (select count(*) from public.user_files as file_row
        where file_row.profile_id = old.profile_id and file_row.deleted_at is null) >= 1000 then
      raise exception 'PRESERVE_SYLLABUS_REPLACEMENT: account file limit of 1000 reached'
        using errcode = 'P0001';
    end if;

    file_name := coalesce(nullif(btrim(entry.value ->> 'syllabusName'), ''),
        nullif(btrim(course_name), '') || ' syllabus', 'Course syllabus');
    file_name := btrim(replace(replace(regexp_replace(file_name, '[[:cntrl:]]', ' ', 'g'), '/', ' '), chr(92), ' '));
    if file_name = '' then file_name := 'Course syllabus'; end if;
    if right(lower(file_name), 4) <> '.txt' then
      file_name := left(file_name, 251) || '.txt';
    else
      file_name := left(file_name, 255);
    end if;
    if btrim(file_name) = '' then file_name := 'Course syllabus.txt'; end if;

    -- Read the synthetic source preference with the profile lock held, matching
    -- mutate_account_ai_source's profile-then-source lock order. The private
    -- legacy RPC atomically creates metadata and the native body in this folder.
    ai_enabled := null;
    if to_regclass('public.ai_sources') is not null then
      execute 'select source_row.enabled from public.ai_sources as source_row where source_row.profile_id = $1 and source_row.source_key = $2 for update'
        into ai_enabled using old.profile_id, 'syllabus:' || entry.key;
    end if;

    file_id := gen_random_uuid();
    perform public.mutate_account_document_legacy(
      old.profile_id, auth_user_id, file_id, 'create', null,
      jsonb_build_object('name', file_name, 'kind', 'syllabus', 'folderId', folder_id,
        'body', old_body)
    );

    if ai_enabled is not null and to_regclass('public.ai_sources') is not null then
      execute 'update public.ai_sources as source_row set enabled = $1 where source_row.profile_id = $2 and source_row.source_key = $3'
        using ai_enabled, old.profile_id, 'file:' || file_id::text;
    end if;
  end loop;

  return new;
end;
$$;
revoke all on function public.preserve_replaced_course_syllabi() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
