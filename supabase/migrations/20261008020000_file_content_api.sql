-- Content reads, batch actions, and export snapshots for the file organization API.
-- This migration preserves legacy upload metadata and cleanup RPC signatures.
begin;

-- Trash must protect file content and its display identity while still allowing
-- academic workspace writes to clear stale course/assignment references.
create or replace function public.guard_user_file_location()
returns trigger language plpgsql security definer set search_path = '' as $$
declare profile_key uuid;
begin
  if tg_op = 'DELETE' then
    profile_key := old.profile_id;
  else
    profile_key := new.profile_id;
    if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id then
      raise exception 'File ownership cannot change' using errcode = '23503';
    end if;
  end if;
  perform 1 from public.app_profiles where id = profile_key for update;
  if not found and tg_op <> 'DELETE' then
    raise exception 'Account profile not found' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.folder_id is not null and not exists(select 1 from public.file_folders folder_row
      where folder_row.profile_id = new.profile_id and folder_row.id = new.folder_id) then
    raise exception 'Unknown or foreign file folder' using errcode = '23503';
  end if;
  if new.folder_id is not null and not public.file_folder_location_is_active(new.profile_id, new.folder_id) then
    raise exception 'File destination is under a trashed folder' using errcode = '23514';
  end if;
  if new.trashed_at is not null and new.folder_id is not null then
    raise exception 'Trashed files cannot have an active folder location' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.trashed_at is not null and new.trashed_at is not null then
    if row(new.name, new.mime_type, new.kind, new.size_bytes, new.content_sha256,
        new.folder_id, new.content_backend, new.trashed_at, new.trash_operation_id,
        new.original_folder_id)
        is distinct from row(old.name, old.mime_type, old.kind, old.size_bytes, old.content_sha256,
        old.folder_id, old.content_backend, old.trashed_at, old.trash_operation_id,
        old.original_folder_id) then
      raise exception 'Restore a file before changing its content or name' using errcode = '23514';
    end if;
    if new.state is distinct from old.state and new.state <> 'deleting' then
      raise exception 'Restore a file before changing its state' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_user_file_location() from public, anon, authenticated;

-- A finalized native document tombstone retains its file metadata but releases
-- the body. The body may disappear only once the permanent tombstone is set.
create or replace function public.enforce_native_file_document_pair()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_file_id uuid; backend text; document_exists boolean; tombstoned boolean;
begin
  if tg_table_name = 'user_files' then
    if tg_op = 'DELETE' then v_owner := old.profile_id; v_file_id := old.id;
    else v_owner := new.profile_id; v_file_id := new.id; end if;
  else
    if tg_op = 'DELETE' then v_owner := old.profile_id; v_file_id := old.file_id;
    else v_owner := new.profile_id; v_file_id := new.file_id; end if;
  end if;
  select f.content_backend, f.deleted_at is not null into backend, tombstoned
    from public.user_files f where f.profile_id = v_owner and f.id = v_file_id;
  if not found then return null; end if;
  select exists(select 1 from public.native_file_documents d
      where d.profile_id = v_owner and d.file_id = v_file_id) into document_exists;
  if backend = 'native-text' then
    if tombstoned and document_exists then
      raise exception 'Permanently deleted native files cannot retain a body' using errcode = '23514';
    elsif not tombstoned and not document_exists then
      raise exception 'Native document and file backend do not match' using errcode = '23514';
    end if;
  elsif backend = 'object' and document_exists then
    raise exception 'Native document and file backend do not match' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function public.enforce_native_file_document_pair() from public, anon, authenticated;

-- A workspace cannot newly point at an already-trashed syllabus source. File
-- trash checks existing references; this closes the opposite write ordering.
create function public.guard_dashboard_syllabus_file_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.app_profiles where id = new.profile_id for update;
  if not found then raise exception 'Account profile not found' using errcode = '42501'; end if;
  if exists (
    select 1 from (
      select value->>'syllabusFileId' as id
        from jsonb_each(coalesce(new.payload->'d'->'courseDetails', '{}'::jsonb)) entry(key, value)
      union all
      select draft_items.document->>'sourceFileId'
        from jsonb_array_elements(coalesce(new.payload->'d'->'syllabusDrafts', '[]'::jsonb)) draft_items(document)
    ) refs
    where refs.id is not null and not exists(
      select 1 from public.user_files file_row
      where file_row.profile_id = new.profile_id and file_row.id::text = refs.id
        and file_row.kind = 'syllabus' and file_row.state = 'ready'
        and file_row.deleted_at is null and file_row.trashed_at is null
    )
  ) then
    raise exception 'Unknown syllabus file' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_dashboard_syllabus_file_state() from public, anon, authenticated;
create trigger dashboard_state_syllabus_file_guard
  before insert or update of payload on public.dashboard_state
  for each row execute function public.guard_dashboard_syllabus_file_state();

-- Retain the old signature for existing upload callers. Folder placement is
-- optional; older clients that omit folderId keep their current location.
create or replace function public.mutate_account_file(
  p_profile_id uuid, p_auth_user_id uuid, p_file_id uuid, p_operation text,
  p_expected_revision timestamptz default null, p_metadata jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.user_files;
  c text;
  a text;
  doc jsonb;
  folder_key uuid;
  operation_key uuid;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  if p_file_id is null or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid file operation' using errcode = '22023';
  end if;
  select * into f from public.user_files where profile_id = p_profile_id and id = p_file_id for update;
  if p_operation = 'reserve' then
    folder_key := nullif(p_metadata->>'folderId', '')::uuid;
    if folder_key is not null and not exists(select 1 from public.file_folders folder_row
        where folder_row.profile_id = p_profile_id and folder_row.id = folder_key) then
      raise exception 'Unknown or foreign file folder' using errcode = '23503';
    end if;
    if folder_key is not null and not public.file_folder_location_is_active(p_profile_id, folder_key) then
      raise exception 'File destination is under a trashed folder' using errcode = '23514';
    end if;
    if found then
      if f.deleted_at is not null or f.trashed_at is not null or f.state = 'deleting'
          or f.content_backend <> 'object'
          or f.content_sha256 is distinct from p_metadata->>'sha256'
          or f.size_bytes is distinct from (p_metadata->>'size')::bigint
          or (p_metadata ? 'folderId' and f.folder_id is distinct from folder_key) then
        raise exception 'Upload ID already used or deleted' using errcode = '40001';
      end if;
      return to_jsonb(f);
    end if;
    if (select count(*) from public.user_files where profile_id = p_profile_id and deleted_at is null) >= 1000 then
      raise exception 'Keep at most 1000 files' using errcode = '22023';
    end if;
    if coalesce(p_metadata->>'sha256', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid digest' using errcode = '22023';
    end if;
  elsif not found then
    raise exception 'File not found' using errcode = 'P0002';
  end if;

  if p_operation is null or p_operation not in ('reserve', 'edit', 'ready', 'deleting', 'removed') then
    raise exception 'Invalid file operation' using errcode = '22023';
  end if;
  select payload into doc from public.dashboard_state where profile_id = p_profile_id;
  if p_operation in ('deleting', 'edit') and exists (
    select 1 from (
      select v->>'syllabusFileId' as id
        from jsonb_each(coalesce(doc->'d'->'courseDetails', '{}'::jsonb)) e(k, v)
      union all
      select v->>'sourceFileId'
        from jsonb_array_elements(coalesce(doc->'d'->'syllabusDrafts', '[]'::jsonb)) v
    ) refs where refs.id = p_file_id::text
  ) and (p_operation = 'deleting' or p_metadata->>'kind' <> 'syllabus'
      or nullif(p_metadata->>'courseId', '') is distinct from f.course_id) then
    raise exception 'Detach the syllabus source in its class or review before deleting or reassigning this file'
      using errcode = '23503';
  end if;

  if p_operation in ('reserve', 'edit') then
    if p_operation = 'edit' and (f.trashed_at is not null or f.state <> 'ready' or f.deleted_at is not null) then
      raise exception 'File is unavailable for metadata editing' using errcode = '23514';
    end if;
    c := nullif(p_metadata->>'courseId', '');
    a := nullif(p_metadata->>'assignmentId', '');
    if c is not null and not exists(select 1 from public.courses where profile_id = p_profile_id and id = c) then
      raise exception 'Unknown class' using errcode = '23503';
    end if;
    select payload into doc from public.dashboard_state where profile_id = p_profile_id;
    if a is not null and not exists(select 1 from jsonb_array_elements(coalesce(doc->'d'->'assignments', '[]')) item
        where item->>'id' = a and item->>'courseId' = coalesce(c, '')) then
      raise exception 'Unknown assignment' using errcode = '23503';
    end if;
    if p_operation = 'reserve' then
      insert into public.user_files(profile_id, id, course_id, assignment_id, kind, name, mime_type,
          size_bytes, object_path, content_sha256, folder_id)
        values(p_profile_id, p_file_id, c, a, p_metadata->>'kind', p_metadata->>'name', p_metadata->>'mime',
          (p_metadata->>'size')::bigint, p_profile_id::text || '/' || p_file_id::text,
          p_metadata->>'sha256', folder_key) returning * into f;
    else
      if f.updated_at is distinct from p_expected_revision then
        raise exception 'File changed; reload before editing' using errcode = '40001';
      end if;
      if p_metadata ? 'folderId' then
        folder_key := nullif(p_metadata->>'folderId', '')::uuid;
        if folder_key is not null and not exists(select 1 from public.file_folders folder_row
            where folder_row.profile_id = p_profile_id and folder_row.id = folder_key) then
          raise exception 'Unknown or foreign file folder' using errcode = '23503';
        end if;
        if folder_key is not null and not public.file_folder_location_is_active(p_profile_id, folder_key) then
          raise exception 'File destination is under a trashed folder' using errcode = '23514';
        end if;
        update public.user_files set name = p_metadata->>'name', course_id = c, assignment_id = a,
            kind = p_metadata->>'kind', folder_id = folder_key
          where profile_id = p_profile_id and id = p_file_id returning * into f;
      else
        update public.user_files set name = p_metadata->>'name', course_id = c, assignment_id = a,
            kind = p_metadata->>'kind'
          where profile_id = p_profile_id and id = p_file_id returning * into f;
      end if;
    end if;
  elsif p_operation = 'ready' then
    if f.content_backend <> 'object' or f.state = 'deleting' or f.deleted_at is not null or f.trashed_at is not null then
      raise exception 'File was deleted or is not an uploaded object' using errcode = '40001';
    end if;
    if f.state = 'pending' then
      update public.user_files set state = 'ready' where profile_id = p_profile_id and id = p_file_id returning * into f;
    elsif f.state <> 'ready' then
      raise exception 'File is not ready for upload completion' using errcode = '40001';
    end if;
  elsif p_operation = 'deleting' then
    if f.deleted_at is not null or (f.trashed_at is not null and f.state in ('ready', 'deleting')) then
      -- Repeated ordinary DELETE never starts physical removal of a trashed file.
      return to_jsonb(f);
    elsif f.state = 'deleting' then
      -- Keep retrying a physical cleanup intent created before this migration.
      return to_jsonb(f);
    elsif f.state = 'pending' then
      if f.updated_at is distinct from p_expected_revision then
        raise exception 'File changed; reload before deleting' using errcode = '40001';
      end if;
      update public.user_files set state = 'deleting'
        where profile_id = p_profile_id and id = p_file_id returning * into f;
    elsif f.state = 'ready' then
      if f.updated_at is distinct from p_expected_revision then
        raise exception 'File changed; reload before deleting' using errcode = '40001';
      end if;
      operation_key := gen_random_uuid();
      update public.user_files set original_folder_id = folder_id, folder_id = null,
          trashed_at = clock_timestamp(), trash_operation_id = operation_key
        where profile_id = p_profile_id and id = p_file_id returning * into f;
    else
      raise exception 'File is unavailable for deletion' using errcode = '23514';
    end if;
  elsif p_operation = 'removed' then
    if f.state <> 'deleting' then raise exception 'Delete was not started' using errcode = '40001'; end if;
    if f.deleted_at is null then
      update public.user_files set deleted_at = clock_timestamp()
        where profile_id = p_profile_id and id = p_file_id returning * into f;
      if f.content_backend = 'native-text' then
        delete from public.native_file_documents where profile_id = p_profile_id and file_id = p_file_id;
      end if;
    end if;
  end if;
  return to_jsonb(f);
end;
$$;
revoke all on function public.mutate_account_file(uuid, uuid, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_account_file(uuid, uuid, uuid, text, timestamptz, jsonb) to service_role;

-- Read metadata and native text from one profile-locked database snapshot.
create function public.read_account_file_content(
  p_profile_id uuid, p_file_id uuid, p_expected_content_revision bigint default null,
  p_allow_trashed boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.user_files; d public.native_file_documents; document_json jsonb;
begin
  perform 1 from public.app_profiles where id = p_profile_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  if p_file_id is null then raise exception 'File ID is required' using errcode = '22023'; end if;
  select * into f from public.user_files where profile_id = p_profile_id and id = p_file_id for update;
  if not found then raise exception 'File not found' using errcode = 'P0002'; end if;
  if f.state <> 'ready' or f.deleted_at is not null then
    raise exception 'File content is unavailable' using errcode = '23514';
  end if;
  if f.trashed_at is not null and not coalesce(p_allow_trashed, false) then
    raise exception 'File is in Trash' using errcode = '23514';
  end if;
  if p_expected_content_revision is not null and f.content_revision <> p_expected_content_revision then
    raise exception 'File content changed; reload before reading' using errcode = '40001';
  end if;
  if f.content_backend = 'native-text' then
    select * into d from public.native_file_documents where profile_id = p_profile_id and file_id = p_file_id;
    if not found then raise exception 'Native document body is missing' using errcode = '23514'; end if;
    document_json := jsonb_build_object('file_id', d.file_id, 'body', d.body,
      'content_revision', f.content_revision);
  else
    document_json := null;
  end if;
  return jsonb_build_object('file', to_jsonb(f), 'document', document_json);
end;
$$;
revoke all on function public.read_account_file_content(uuid, uuid, bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.read_account_file_content(uuid, uuid, bigint, boolean) to service_role;

-- Execute validated file/folder actions as one account transaction. Folder Trash
-- remains empty-folder only; recursive operations belong to a later batch.
create function public.mutate_account_files_action(
  p_profile_id uuid, p_auth_user_id uuid, p_action text, p_items jsonb,
  p_destination_id uuid default null, p_destination_provided boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  item_type text;
  item_id uuid;
  item_revision bigint;
  f public.user_files;
  folder_row public.file_folders;
  dashboard jsonb;
  operation_result jsonb;
  item_json jsonb;
  file_rows jsonb := '[]'::jsonb;
  folder_rows jsonb := '[]'::jsonb;
  file_activity_rows jsonb := '[]'::jsonb;
  folder_activity_rows jsonb := '[]'::jsonb;
  activity_action boolean;
  source_is_referenced boolean;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('move', 'trash', 'restore', 'star', 'unstar', 'open', 'permanent-delete')
      or p_items is null or jsonb_typeof(p_items) <> 'array'
      or jsonb_array_length(p_items) > 1000 then
    raise exception 'Invalid file action or item list' using errcode = '22023';
  end if;
  if p_destination_id is not null and p_action not in ('move', 'restore') then
    raise exception 'A destination is only valid for move or restore' using errcode = '22023';
  end if;
  if coalesce(p_destination_provided, false) and p_action <> 'restore' then
    raise exception 'Destination presence is only valid for restore' using errcode = '22023';
  end if;
  if p_action = 'permanent-delete' and exists(
      select 1 from jsonb_array_elements(p_items) selected(item)
      where selected.item->>'type' is distinct from 'file') then
    raise exception 'Permanent delete supports files only' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) selected(item)
      where jsonb_typeof(selected.item) is distinct from 'object'
        or (selected.item->>'type' is distinct from 'file' and selected.item->>'type' is distinct from 'folder')
        or jsonb_typeof(selected.item->'id') is distinct from 'string'
        or coalesce(selected.item->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(selected.item->'revision') is distinct from 'number') then
    raise exception 'Each item needs a type, UUID id, and numeric revision' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) selected(item)
      where (selected.item->>'revision')::numeric < 1
        or (selected.item->>'revision')::numeric > 9223372036854775807
        or trunc((selected.item->>'revision')::numeric) <> (selected.item->>'revision')::numeric) then
    raise exception 'Item revisions must be positive integers' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
      (select count(distinct (selected.item->>'type', selected.item->>'id'))
        from jsonb_array_elements(p_items) selected(item)) then
    raise exception 'Duplicate item IDs are not allowed' using errcode = '22023';
  end if;
  if p_destination_id is not null and not exists(select 1 from public.file_folders destination
      where destination.profile_id = p_profile_id and destination.id = p_destination_id) then
    raise exception 'Unknown or foreign destination folder' using errcode = '23503';
  end if;
  if p_destination_id is not null and not public.file_folder_location_is_active(p_profile_id, p_destination_id) then
    raise exception 'Destination is under a trashed folder' using errcode = '23514';
  end if;
  select payload into dashboard from public.dashboard_state where profile_id = p_profile_id;

  -- Lock and validate every selected row before invoking any single-item mutator.
  for item in select selected.value from jsonb_array_elements(p_items) with ordinality selected(value, ordinal)
      order by selected.ordinal loop
    item_type := item->>'type';
    item_id := (item->>'id')::uuid;
    item_revision := (item->>'revision')::bigint;
    activity_action := p_action in ('star', 'unstar', 'open');
    if item_type = 'file' then
      select * into f from public.user_files where profile_id = p_profile_id and id = item_id for update;
      if not found then raise exception 'File not found' using errcode = 'P0002'; end if;
      if f.deleted_at is not null then
        if p_action <> 'permanent-delete' then
          raise exception 'Permanently deleted files cannot be changed' using errcode = '23514';
        end if;
        -- Finalized tombstones are accepted as no-op retry entries.
      elsif p_action = 'permanent-delete' then
        if f.trashed_at is null or f.state not in ('ready', 'deleting') then
          raise exception 'Only trashed ready files can be permanently deleted' using errcode = '23514';
        end if;
        if f.state = 'ready' and f.metadata_revision <> item_revision then
          raise exception 'File changed; reload before deleting permanently' using errcode = '40001';
        end if;
      elsif p_action = 'trash' and f.trashed_at is not null then
        if f.state not in ('ready', 'deleting') then raise exception 'File is unavailable' using errcode = '23514'; end if;
      else
        if f.metadata_revision <> item_revision then
          raise exception 'File changed; reload before editing' using errcode = '40001';
        end if;
        if p_action in ('move', 'trash', 'restore') then
          if f.state <> 'ready' then raise exception 'File is unavailable for location changes' using errcode = '23514'; end if;
          if p_action = 'move' and f.trashed_at is not null then raise exception 'Restore a file before moving it' using errcode = '23514'; end if;
          if p_action = 'trash' and f.trashed_at is null then
            select exists(select 1 from (
                select v->>'syllabusFileId' as id
                  from jsonb_each(coalesce(dashboard->'d'->'courseDetails', '{}'::jsonb)) e(k, v)
                union all
                select v->>'sourceFileId'
                  from jsonb_array_elements(coalesce(dashboard->'d'->'syllabusDrafts', '[]'::jsonb)) v
              ) refs where refs.id = item_id::text) into source_is_referenced;
            if source_is_referenced then
              raise exception 'Detach the syllabus source in its class or review before moving it to Trash' using errcode = '23503';
            end if;
          end if;
          if p_action = 'restore' and f.trashed_at is null then raise exception 'File is not in Trash' using errcode = '22023'; end if;
        elsif p_action = 'open' then
          if f.state <> 'ready' or f.trashed_at is not null then raise exception 'File is unavailable to open' using errcode = '23514'; end if;
        elsif activity_action and f.state = 'deleting' and f.trashed_at is null then
          raise exception 'File deletion is already in progress' using errcode = '23514';
        end if;
      end if;
      if f.deleted_at is null and p_action in ('trash', 'permanent-delete')
          and not (p_action = 'trash' and f.trashed_at is not null) then
        select exists(select 1 from (
            select v->>'syllabusFileId' as id
              from jsonb_each(coalesce(dashboard->'d'->'courseDetails', '{}'::jsonb)) e(k, v)
            union all
            select v->>'sourceFileId'
              from jsonb_array_elements(coalesce(dashboard->'d'->'syllabusDrafts', '[]'::jsonb)) v
          ) refs where refs.id = item_id::text) into source_is_referenced;
        if source_is_referenced then
          raise exception 'Detach the syllabus source in its class or review before deleting this file' using errcode = '23503';
        end if;
      end if;
      if p_action = 'move' and p_destination_id is not null then
        if not public.file_folder_location_is_active(p_profile_id, p_destination_id) then
          raise exception 'File destination is under a trashed folder' using errcode = '23514';
        end if;
      end if;
    else
      select * into folder_row from public.file_folders where profile_id = p_profile_id and id = item_id for update;
      if not found then raise exception 'Folder not found' using errcode = 'P0002'; end if;
      if folder_row.revision <> item_revision then
        raise exception 'Folder changed; reload before editing' using errcode = '40001';
      end if;
      if p_action = 'move' then
        if folder_row.trashed_at is not null then raise exception 'Restore a folder before moving it' using errcode = '23514'; end if;
        if folder_row.kind = 'course' and folder_row.course_id is not null then
          raise exception 'Managed course folders stay at the root' using errcode = '23514';
        end if;
        if p_destination_id is not null then
          with recursive descendants(id, parent_id, path) as (
            select selected_folder.id, selected_folder.parent_id, array[selected_folder.id]
              from public.file_folders selected_folder
              where selected_folder.profile_id = p_profile_id and selected_folder.id = item_id
            union all
            select child.id, child.parent_id, d.path || child.id
              from descendants d join public.file_folders child
                on child.profile_id = p_profile_id and child.parent_id = d.id
              where not child.id = any(d.path)
          )
          select exists(select 1 from descendants where id = p_destination_id) into source_is_referenced;
          if source_is_referenced then raise exception 'Folder move would create a cycle' using errcode = '23514'; end if;
        end if;
      elsif p_action = 'trash' then
        if folder_row.kind = 'course' and folder_row.course_id is not null then
          raise exception 'Managed course folders cannot be trashed' using errcode = '23514';
        end if;
        if folder_row.trashed_at is not null then raise exception 'Folder is already in Trash' using errcode = '22023'; end if;
        if exists(select 1 from public.file_folders child where child.profile_id = p_profile_id and child.parent_id = item_id)
            or exists(select 1 from public.user_files file where file.profile_id = p_profile_id and file.folder_id = item_id) then
          raise exception 'A folder must be empty before it can be trashed' using errcode = '23514';
        end if;
      elsif p_action = 'restore' then
        if folder_row.trashed_at is null then raise exception 'Folder is not in Trash' using errcode = '22023'; end if;
      elsif p_action = 'open' then
        if folder_row.trashed_at is not null then raise exception 'Trashed folders cannot be opened' using errcode = '23514'; end if;
      end if;
    end if;
  end loop;

  -- Execute after validation, preserving selection order. Any failure rolls back
  -- every earlier item because this RPC runs in the caller's SQL transaction.
  for item in select selected.value from jsonb_array_elements(p_items) with ordinality selected(value, ordinal)
      order by selected.ordinal loop
    item_type := item->>'type';
    item_id := (item->>'id')::uuid;
    item_revision := (item->>'revision')::bigint;
    activity_action := p_action in ('star', 'unstar', 'open');
    if item_type = 'file' then
      select * into f from public.user_files where profile_id = p_profile_id and id = item_id;
      if p_action = 'permanent-delete' then
        if f.deleted_at is not null then
          -- A finalized item in a retried batch is a no-op; omit it so callers
          -- do not repeat physical cleanup after its tombstone was committed.
          continue;
        end if;
        if f.state = 'ready' then
          update public.user_files set state = 'deleting'
            where profile_id = p_profile_id and id = item_id returning * into f;
        end if;
        item_json := to_jsonb(f);
      elsif p_action = 'trash' and f.trashed_at is not null then
        item_json := to_jsonb(f);
      else
        operation_result := public.mutate_account_file_location(
          p_profile_id, p_auth_user_id, item_id, p_action, item_revision,
          case when p_action = 'move' or (p_action = 'restore' and
              (p_destination_id is not null or coalesce(p_destination_provided, false)))
            then jsonb_build_object('folderId', p_destination_id::text) else
              '{}'::jsonb end);
        if activity_action then
          select to_jsonb(file_row) into item_json from public.user_files file_row
            where file_row.profile_id = p_profile_id and file_row.id = item_id;
          file_activity_rows := file_activity_rows || jsonb_build_array(operation_result);
        else
          item_json := operation_result;
        end if;
      end if;
      file_rows := file_rows || jsonb_build_array(item_json);
    else
      operation_result := public.mutate_account_folder(
        p_profile_id, p_auth_user_id, p_action, item_id, item_revision,
        case when p_action = 'move' or (p_action = 'restore' and
            (p_destination_id is not null or coalesce(p_destination_provided, false)))
          then jsonb_build_object('parentId', p_destination_id::text) else
            '{}'::jsonb end);
      if activity_action then
        select to_jsonb(folder) into item_json from public.file_folders folder
          where folder.profile_id = p_profile_id and folder.id = item_id;
        folder_activity_rows := folder_activity_rows || jsonb_build_array(operation_result);
      else
        item_json := operation_result;
      end if;
      folder_rows := folder_rows || jsonb_build_array(item_json);
    end if;
  end loop;

  return jsonb_build_object('files', file_rows, 'folders', folder_rows,
    'activities', jsonb_build_object('files', file_activity_rows, 'folders', folder_activity_rows));
end;
$$;
revoke all on function public.mutate_account_files_action(uuid, uuid, text, jsonb, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.mutate_account_files_action(uuid, uuid, text, jsonb, uuid, boolean) to service_role;

-- Keep account export's existing top-level contract and add organization state.
-- The profile lock serializes all file/document/folder writes while JSON is built.
create or replace function public.export_account(p_profile_id uuid, p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; assistant_data jsonb;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id and initialized for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.app_profiles p where p.id = p_profile_id),
    'courses', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
      from public.courses c where c.profile_id = p_profile_id),
    'workspace', (select jsonb_build_object('dashboard', payload, 'revision', updated_at)
      from public.dashboard_state where profile_id = p_profile_id),
    'files', (select coalesce(jsonb_agg(to_jsonb(f) order by f.id), '[]'::jsonb)
      from public.user_files f where f.profile_id = p_profile_id and f.deleted_at is null),
    'folders', (select coalesce(jsonb_agg(to_jsonb(folder_row) order by folder_row.id), '[]'::jsonb)
      from public.file_folders folder_row where folder_row.profile_id = p_profile_id),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('file_id', d.file_id, 'body', d.body,
          'content_revision', f.content_revision) order by d.file_id), '[]'::jsonb)
      from public.native_file_documents d join public.user_files f
        on f.profile_id = d.profile_id and f.id = d.file_id
      where d.profile_id = p_profile_id and f.deleted_at is null),
    'activity', jsonb_build_object(
      'files', (select coalesce(jsonb_agg(to_jsonb(activity) order by activity.file_id), '[]'::jsonb)
        from public.file_activity activity join public.user_files f
          on f.profile_id = activity.profile_id and f.id = activity.file_id
        where activity.profile_id = p_profile_id and f.deleted_at is null),
      'folders', (select coalesce(jsonb_agg(to_jsonb(activity) order by activity.folder_id), '[]'::jsonb)
        from public.folder_activity activity where activity.profile_id = p_profile_id)
    )) into result;

  if to_regclass('public.ai_access') is not null and to_regclass('public.ai_conversations') is not null
      and to_regclass('public.ai_messages') is not null and to_regclass('public.ai_proposals') is not null
      and to_regclass('public.ai_sources') is not null then
    execute $query$
      select jsonb_build_object(
        'access', (select to_jsonb(a) from public.ai_access a where a.profile_id = $1),
        'conversations', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
          from public.ai_conversations c where c.profile_id = $1),
        'messages', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
          from public.ai_messages m where m.profile_id = $1),
        'proposals', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb)
          from public.ai_proposals p where p.profile_id = $1),
        'sources', (select coalesce(jsonb_agg(to_jsonb(s) order by s.source_key), '[]'::jsonb)
          from public.ai_sources s where s.profile_id = $1)
      )
    $query$ into assistant_data using p_profile_id;
    result := result || jsonb_build_object('assistant', assistant_data);
  end if;
  return result;
end;
$$;
revoke all on function public.export_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.export_account(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
