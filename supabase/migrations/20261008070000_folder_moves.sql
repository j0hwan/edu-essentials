-- Batch move normalization and standalone file rename persistence.
begin;

create or replace function public.mutate_account_files_action(
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
  move_skipped text[] := array[]::text[];
  parent_key uuid;
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

  -- Capture covered selections from the validated, account-locked hierarchy
  -- before any move changes parent or folder locations.
  if p_action = 'move' then
    for item in select selected.value from jsonb_array_elements(p_items) with ordinality selected(value, ordinal)
        order by selected.ordinal loop
      item_type := item->>'type';
      item_id := (item->>'id')::uuid;
      if item_type = 'file' then
        select file_row.folder_id into parent_key
          from public.user_files file_row where file_row.profile_id = p_profile_id and file_row.id = item_id;
      else
        select selected_folder.parent_id into parent_key
          from public.file_folders selected_folder where selected_folder.profile_id = p_profile_id and selected_folder.id = item_id;
      end if;
      if parent_key is not null then
        with recursive ancestors(id, parent_id, path) as (
          select parent.id, parent.parent_id, array[parent.id]
            from public.file_folders parent
            where parent.profile_id = p_profile_id and parent.id = parent_key
          union all
          select parent.id, parent.parent_id, ancestors.path || parent.id
            from ancestors join public.file_folders parent
              on parent.profile_id = p_profile_id and parent.id = ancestors.parent_id
            where not parent.id = any(ancestors.path)
        )
        select exists(
          select 1 from ancestors
          where exists(
            select 1 from jsonb_array_elements(p_items) selected(item)
            where selected.item->>'type' = 'folder'
              and (selected.item->>'id')::uuid = ancestors.id
          )
        ) into source_is_referenced;
        if source_is_referenced then
          move_skipped := array_append(move_skipped, item_type || ':' || item_id::text);
        end if;
      end if;
    end loop;
  end if;
  -- Execute after validation, preserving selection order. Any failure rolls back
  -- every earlier item because this RPC runs in the caller's SQL transaction.
  for item in select selected.value from jsonb_array_elements(p_items) with ordinality selected(value, ordinal)
      order by selected.ordinal loop
    item_type := item->>'type';
    item_id := (item->>'id')::uuid;
    if p_action = 'move' and (item_type || ':' || item_id::text) = any(move_skipped) then
      continue;
    end if;
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
-- Rename changes only display metadata and is serialized with all file writes.
create function public.rename_account_file(
  p_profile_id uuid, p_auth_user_id uuid, p_file_id uuid,
  p_expected_metadata_revision bigint, p_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.user_files;
  item_name text;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  if p_file_id is null or p_expected_metadata_revision is null or p_expected_metadata_revision < 1 then
    raise exception 'A file ID and positive metadata revision are required' using errcode = '22023';
  end if;
  item_name := btrim(p_name);
  if p_name is null or length(p_name) < 1 or length(p_name) > 255 or item_name = ''
      or p_name ~ '[[:cntrl:]]' or position('/' in p_name) > 0 or position(chr(92) in p_name) > 0 then
    raise exception 'Use a file name of 1–255 characters without path separators' using errcode = '22023';
  end if;
  select * into f from public.user_files where profile_id = p_profile_id and id = p_file_id for update;
  if not found then raise exception 'File not found' using errcode = 'P0002'; end if;
  if f.state <> 'ready' or f.deleted_at is not null or f.trashed_at is not null then
    raise exception 'File is not active and ready to rename' using errcode = '23514';
  end if;
  if f.metadata_revision <> p_expected_metadata_revision then
    raise exception 'File metadata changed; reload before renaming' using errcode = '40001';
  end if;
  update public.user_files set name = item_name
    where profile_id = p_profile_id and id = p_file_id returning * into f;
  return to_jsonb(f);
end;
$$;
revoke all on function public.rename_account_file(uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.rename_account_file(uuid, uuid, uuid, bigint, text) to service_role;
notify pgrst, 'reload schema';
commit;
