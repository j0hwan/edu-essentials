-- Keep managed course folders in step with academic course lifecycle changes.
-- Course deletion retains the folder and any pasted syllabus as file content.
begin;

alter table public.file_folders
  add column course_code text;

-- course_code is display metadata just like the folder name. Include it in the
-- existing snapshot comparison so changing the secondary label advances the
-- folder revision without discarding any prior revision fields.
create or replace function public.advance_file_folder_revision()
returns trigger language plpgsql set search_path = '' as $$
declare changed boolean;
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := coalesce(new.created_at, clock_timestamp());
    new.updated_at := coalesce(new.updated_at, new.created_at);
    return new;
  end if;
  changed := row(new.parent_id, new.name, new.kind, new.course_id, new.course_code,
      new.archived_at, new.semester_label, new.course_name_snapshot,
      new.course_color_snapshot, new.trashed_at, new.trash_operation_id,
      new.original_parent_id)
    is distinct from row(old.parent_id, old.name, old.kind, old.course_id, old.course_code,
      old.archived_at, old.semester_label, old.course_name_snapshot,
      old.course_color_snapshot, old.trashed_at, old.trash_operation_id,
      old.original_parent_id);
  new.revision := case when changed then old.revision + 1 else old.revision end;
  new.updated_at := case when changed
    then greatest(clock_timestamp(), old.updated_at + interval '1 millisecond') else old.updated_at end;
  return new;
end;
$$;
revoke all on function public.advance_file_folder_revision() from public, anon, authenticated;

-- This internal helper is used only by course triggers. The partial unique
-- index makes repeated saves idempotent while preserving folder identity,
-- parent, archive metadata, Trash state, and all child locations.
create function public.ensure_managed_course_folder(
  p_profile_id uuid, p_course_id text, p_course_name text, p_course_code text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_folder_id uuid; v_folder_name text;
begin
  v_folder_name := left(coalesce(nullif(btrim(p_course_name), ''),
      nullif(btrim(p_course_code), ''), 'Course'), 255);
  insert into public.file_folders(profile_id, id, name, kind, course_id, course_code)
    values(p_profile_id, gen_random_uuid(), v_folder_name, 'course', p_course_id, p_course_code)
    on conflict (profile_id, course_id) where kind = 'course' and course_id is not null
    do update set name = excluded.name, course_code = excluded.course_code
    returning id into v_folder_id;
  return v_folder_id;
end;
$$;
revoke all on function public.ensure_managed_course_folder(uuid, text, text, text)
  from public, anon, authenticated, service_role;

-- A deterministic, valid UUID derived from the retained folder lifecycle. Use
-- a UUIDv3-shaped value so file-ID validators accept it; the folder UUID, rather
-- than the reusable academic course ID, is the stable input.
create function public.course_syllabus_document_id(p_folder_id uuid)
returns uuid language plpgsql immutable set search_path = '' as $$
declare v_hex text; v_variant text;
begin
  v_hex := md5('edu-essentials:preserved-course-syllabus:' || p_folder_id::text);
  v_variant := substr('89ab', (strpos('0123456789abcdef', substr(v_hex, 17, 1)) - 1) % 4 + 1, 1);
  v_hex := substr(v_hex, 1, 12) || '3' || substr(v_hex, 14, 3) || v_variant || substr(v_hex, 18);
  return (substr(v_hex, 1, 8) || '-' || substr(v_hex, 9, 4) || '-' ||
      substr(v_hex, 13, 4) || '-' || substr(v_hex, 17, 4) || '-' || substr(v_hex, 21, 12))::uuid;
end;
$$;
revoke all on function public.course_syllabus_document_id(uuid)
  from public, anon, authenticated, service_role;

-- AI source preference changes serialize with course deletion and transfer. Keep
-- the optional ai_sources dependency dynamic so this migration also applies when
-- the optional AI migrations are not installed.
create function public.mutate_account_ai_source(
  p_profile_id uuid, p_auth_user_id uuid, p_id uuid, p_action text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_source jsonb; v_result jsonb;
begin
  perform 1 from public.app_profiles as profile_row
    where profile_row.id = p_profile_id and profile_row.auth_user_id = p_auth_user_id
      and profile_row.initialized and profile_row.onboarding_completed_at is not null
    for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;

  if p_id is null or p_action is null or p_action not in ('retry', 'exclude', 'include') then
    raise exception 'Invalid AI source operation' using errcode = '22023';
  end if;
  if to_regclass('public.ai_sources') is null then
    raise exception 'AI source not found' using errcode = 'P0002';
  end if;

  execute 'select to_jsonb(source_row) from public.ai_sources as source_row where source_row.profile_id = $1 and source_row.id = $2 for update'
    into v_source using p_profile_id, p_id;
  if v_source is null then raise exception 'AI source not found' using errcode = 'P0002'; end if;

  if p_action = 'exclude' then
    execute 'update public.ai_sources as source_row set enabled = false, lease_id = null where source_row.profile_id = $1 and source_row.id = $2 returning to_jsonb(source_row)'
      into v_result using p_profile_id, p_id;
  else
    execute 'update public.ai_sources as source_row set enabled = true, state = ''queued'', attempts = 0, error = null, lease_id = null, available_at = clock_timestamp() where source_row.profile_id = $1 and source_row.id = $2 returning to_jsonb(source_row)'
      into v_result using p_profile_id, p_id;
  end if;
  return v_result;
end;
$$;
revoke all on function public.mutate_account_ai_source(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mutate_account_ai_source(uuid, uuid, uuid, text) to service_role;

-- Account/workspace RPCs lock app_profiles before mutating courses. Verify that
-- profile here and reject course identity/ownership edits. Raw service-role DML
-- is revoked below because a row trigger cannot acquire the profile lock before
-- the UPDATE/DELETE statement locks its course row.
-- During profile cascades the parent profile is already gone, so academic and
-- file rows are allowed to cascade without creating preserved content.
create function public.guard_course_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_profile_id uuid;
  v_dashboard jsonb;
  v_details jsonb;
  v_body text;
  v_folder_id uuid;
  v_file_id uuid;
  v_file_name text;
  v_digest text;
  v_existing_file public.user_files;
  v_existing_body text;
  v_ai_enabled boolean;
begin
  if tg_op = 'INSERT' then
    v_profile_id := new.profile_id;
  else
    v_profile_id := old.profile_id;
  end if;

  perform 1 from public.app_profiles as profile_row where profile_row.id = v_profile_id for update;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'Account profile not found' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.profile_id is distinct from old.profile_id or new.id is distinct from old.id then
      raise exception 'Course ownership and ID cannot change' using errcode = '23514';
    end if;
    return new;
  end if;

  -- This runs before save_account_workspace replaces dashboard_state.payload,
  -- so it sees the committed details belonging to the deleted course.
  select dashboard_row.payload into v_dashboard
    from public.dashboard_state as dashboard_row
    where dashboard_row.profile_id = old.profile_id;
  v_details := v_dashboard -> 'd' -> 'courseDetails' -> old.id;
  v_body := v_details ->> 'syllabusText';

  -- Repair a missing managed root before detaching it. The folder ID is then
  -- retained for both archive navigation and the stable document identity.
  v_folder_id := public.ensure_managed_course_folder(old.profile_id, old.id, old.name, old.code);

  if v_body is not null and v_body <> '' then
    if octet_length(convert_to(v_body, 'UTF8')) > 1048576 then
      raise exception 'PRESERVE_COURSE_SYLLABUS: pasted syllabus exceeds the 1 MiB native document limit'
        using errcode = 'P0001';
    end if;

    v_file_id := public.course_syllabus_document_id(v_folder_id);
    v_file_name := coalesce(nullif(btrim(v_details ->> 'syllabusName'), ''),
        nullif(btrim(old.name), '') || ' syllabus', 'Course syllabus');
    v_file_name := btrim(replace(replace(regexp_replace(v_file_name, '[[:cntrl:]]', ' ', 'g'), '/', ' '), chr(92), ' '));
    if v_file_name = '' then v_file_name := 'Course syllabus'; end if;
    if right(lower(v_file_name), 4) <> '.txt' then
      v_file_name := left(v_file_name, 251) || '.txt';
    else
      v_file_name := left(v_file_name, 255);
    end if;
    if btrim(v_file_name) = '' then v_file_name := 'Course syllabus.txt'; end if;
    v_digest := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');

    select file_row.* into v_existing_file
      from public.user_files as file_row
      where file_row.profile_id = old.profile_id and file_row.id = v_file_id;
    if found then
      select document_row.body into v_existing_body
        from public.native_file_documents as document_row
        where document_row.profile_id = old.profile_id and document_row.file_id = v_file_id;
      if not found or v_existing_file.content_backend <> 'native-text'
          or v_existing_file.kind <> 'syllabus' or v_existing_file.name <> v_file_name
          or v_existing_file.state <> 'ready' or v_existing_file.course_id is not null
          or v_existing_file.folder_id is distinct from v_folder_id
          or v_existing_file.deleted_at is not null or v_existing_file.trashed_at is not null
          or v_existing_file.size_bytes <> octet_length(convert_to(v_body, 'UTF8'))
          or v_existing_file.content_sha256 is distinct from v_digest
          or v_existing_body is distinct from v_body then
        raise exception 'Preserved course syllabus document ID is already in use' using errcode = '23505';
      end if;
    else
      if (select count(*) from public.user_files as file_row
          where file_row.profile_id = old.profile_id and file_row.deleted_at is null) >= 1000 then
        raise exception 'PRESERVE_COURSE_SYLLABUS: account file limit of 1000 reached'
          using errcode = 'P0001';
      end if;

      -- Preserve the synthetic syllabus source's opt-out before the file trigger
      -- creates its replacement `file:` AI source. Missing legacy sources default
      -- to enabled, matching the existing AI source default.
      v_ai_enabled := null;
      if to_regclass('public.ai_sources') is not null then
        execute 'select source_row.enabled from public.ai_sources as source_row where source_row.profile_id = $1 and source_row.source_key = $2 for update'
          into v_ai_enabled using old.profile_id, 'syllabus:' || old.id;
      end if;

      insert into public.user_files(profile_id, id, course_id, assignment_id, kind, name,
          mime_type, size_bytes, object_path, content_sha256, content_backend, state, folder_id)
        values(old.profile_id, v_file_id, null, null, 'syllabus', v_file_name,
          'text/plain', octet_length(convert_to(v_body, 'UTF8')),
          old.profile_id::text || '/' || v_file_id::text, v_digest, 'native-text', 'ready', v_folder_id);
      insert into public.native_file_documents(profile_id, file_id, body)
        values(old.profile_id, v_file_id, v_body);

      if to_regclass('public.ai_sources') is not null then
        execute 'update public.ai_sources as source_row set enabled = $1 where source_row.profile_id = $2 and source_row.source_key = $3'
          using coalesce(v_ai_enabled, true), old.profile_id, 'file:' || v_file_id::text;
      end if;
    end if;
  end if;

  update public.file_folders as folder_row
    set kind = 'custom', course_id = null, course_code = coalesce(folder_row.course_code, old.code),
        archived_at = coalesce(folder_row.archived_at, clock_timestamp()),
        semester_label = 'Deleted courses', course_name_snapshot = old.name,
        course_color_snapshot = old.color, trashed_at = null, trash_operation_id = null,
        original_parent_id = null
    where folder_row.profile_id = old.profile_id and folder_row.id = v_folder_id;
  return old;
end;
$$;
revoke all on function public.guard_course_lifecycle() from public, anon, authenticated, service_role;

create function public.sync_managed_course_folder()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.ensure_managed_course_folder(new.profile_id, new.id, new.name, new.code);
  return new;
end;
$$;
revoke all on function public.sync_managed_course_folder() from public, anon, authenticated, service_role;

create trigger courses_00_guard_lifecycle
  before insert or update or delete on public.courses
  for each row execute function public.guard_course_lifecycle();
create trigger courses_20_sync_managed_folder
  after insert or update of name, code on public.courses
  for each row execute function public.sync_managed_course_folder();

-- Course rows are changed only through profile-locking security-definer RPCs.
-- Raw service_role DML would lock a course row before the trigger can lock its
-- profile, reversing the account-wide lock order used by workspace/file saves.
revoke insert, update, delete, truncate on table public.courses from service_role;

-- Backfill every existing course without changing existing managed folder IDs
-- or other folders' placement/archive metadata.
select public.ensure_managed_course_folder(course_row.profile_id, course_row.id,
    course_row.name, course_row.code)
  from public.courses as course_row;

-- Initial placement only: associated files still at the Files root enter their
-- managed course folder. User-selected locations, Trash, and permanent tombstones
-- retain their existing location/history and content metadata.
update public.user_files as file_row
  set folder_id = folder_row.id
  from public.file_folders as folder_row
  where folder_row.profile_id = file_row.profile_id
    and folder_row.course_id = file_row.course_id
    and folder_row.kind = 'course'
    and file_row.folder_id is null
    and file_row.deleted_at is null
    and file_row.trashed_at is null;

notify pgrst, 'reload schema';
commit;
