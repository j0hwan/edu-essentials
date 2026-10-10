-- Archive roots preserve their contents while keeping organization immutable.
begin;

-- This predicate is intentionally separate from file_folder_location_is_active:
-- Trash restore keeps its established behavior when the original folder is an
-- archived descendant, while new organization writes must stay outside archives.
create function public.file_folder_location_is_outside_archive(p_profile_id uuid, p_folder_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare outside_archive boolean;
begin
  if p_folder_id is null then return true; end if;
  with recursive ancestors(id, parent_id, archived_at, path, cycle) as (
    select folder.id, folder.parent_id, folder.archived_at, array[folder.id], false
      from public.file_folders folder
      where folder.profile_id = p_profile_id and folder.id = p_folder_id
    union all
    select parent.id, parent.parent_id, parent.archived_at, ancestors.path || parent.id,
      parent.id = any(ancestors.path)
      from ancestors join public.file_folders parent
        on parent.profile_id = p_profile_id and parent.id = ancestors.parent_id
      where ancestors.parent_id is not null and not ancestors.cycle
  )
  select coalesce(bool_and(archived_at is null and not cycle), false)
    into outside_archive from ancestors;
  return outside_archive;
end;
$$;
revoke all on function public.file_folder_location_is_outside_archive(uuid, uuid)
  from public, anon, authenticated, service_role;

-- File uploads and metadata edits are routed through this account-locked RPC.
alter function public.mutate_account_file(uuid, uuid, uuid, text, timestamptz, jsonb)
  rename to mutate_account_file_legacy;
revoke all on function public.mutate_account_file_legacy(uuid, uuid, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
create function public.mutate_account_file(
  p_profile_id uuid, p_auth_user_id uuid, p_file_id uuid, p_operation text,
  p_expected_revision timestamptz default null, p_metadata jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare file_row public.user_files; folder_key uuid;
begin
  if p_operation in ('reserve', 'edit') then
    perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
      and initialized and onboarding_completed_at is not null for update;
    if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
    select * into file_row from public.user_files
      where profile_id = p_profile_id and id = p_file_id for update;

    if p_operation = 'reserve' and not found then
      folder_key := nullif(coalesce(p_metadata, '{}'::jsonb)->>'folderId', '')::uuid;
      if folder_key is not null then
        if not exists(select 1 from public.file_folders folder
            where folder.profile_id = p_profile_id and folder.id = folder_key) then
          raise exception 'Unknown or foreign file folder' using errcode = '23503';
        end if;
        if not public.file_folder_location_is_outside_archive(p_profile_id, folder_key) then
          raise exception 'Archived folders cannot receive new files' using errcode = '23514';
        end if;
      end if;
    elsif p_operation = 'edit' and found then
      if file_row.folder_id is not null
          and not public.file_folder_location_is_outside_archive(p_profile_id, file_row.folder_id) then
        raise exception 'Files in an archive cannot be reorganized' using errcode = '23514';
      end if;
      if coalesce(p_metadata, '{}'::jsonb) ? 'folderId' then
        folder_key := nullif(p_metadata->>'folderId', '')::uuid;
        if folder_key is not null then
          if not exists(select 1 from public.file_folders folder
              where folder.profile_id = p_profile_id and folder.id = folder_key) then
            raise exception 'Unknown or foreign file folder' using errcode = '23503';
          end if;
          if not public.file_folder_location_is_outside_archive(p_profile_id, folder_key) then
            raise exception 'Archived folders cannot receive moved files' using errcode = '23514';
          end if;
        end if;
      end if;
    end if;
  end if;
  return public.mutate_account_file_legacy(
    p_profile_id, p_auth_user_id, p_file_id, p_operation, p_expected_revision, p_metadata);
end;
$$;
revoke all on function public.mutate_account_file(uuid, uuid, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_account_file(uuid, uuid, uuid, text, timestamptz, jsonb) to service_role;

-- Native document creation and edits share the same service RPC. Reads remain
-- available inside archives, while creating or changing content is rejected.
alter function public.mutate_account_document(uuid, uuid, uuid, text, bigint, jsonb)
  rename to mutate_account_document_legacy;
revoke all on function public.mutate_account_document_legacy(uuid, uuid, uuid, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
create function public.mutate_account_document(
  p_profile_id uuid, p_auth_user_id uuid, p_file_id uuid, p_operation text,
  p_expected_content_revision bigint default null, p_document jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare file_row public.user_files; folder_key uuid;
begin
  if p_operation in ('create', 'update_content') then
    perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
      and initialized and onboarding_completed_at is not null for update;
    if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
    select * into file_row from public.user_files
      where profile_id = p_profile_id and id = p_file_id for update;
    if p_operation = 'create' and not found then
      folder_key := nullif(coalesce(p_document, '{}'::jsonb)->>'folderId', '')::uuid;
      if folder_key is not null then
        if not exists(select 1 from public.file_folders folder
            where folder.profile_id = p_profile_id and folder.id = folder_key) then
          raise exception 'Unknown or foreign document folder' using errcode = '23503';
        end if;
        if not public.file_folder_location_is_outside_archive(p_profile_id, folder_key) then
          raise exception 'Archived folders cannot receive new documents' using errcode = '23514';
        end if;
      end if;
    elsif p_operation = 'update_content' and found and file_row.folder_id is not null
        and not public.file_folder_location_is_outside_archive(p_profile_id, file_row.folder_id) then
      raise exception 'Documents in an archive are read-only' using errcode = '23514';
    end if;
  end if;
  return public.mutate_account_document_legacy(
    p_profile_id, p_auth_user_id, p_file_id, p_operation, p_expected_content_revision, p_document);
end;
$$;
revoke all on function public.mutate_account_document(uuid, uuid, uuid, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_account_document(uuid, uuid, uuid, text, bigint, jsonb) to service_role;

-- Folder transitions validate the row revision before both activity writes and
-- state changes. Trash and restore continue through the recursive Trash RPC.
create or replace function public.mutate_account_folder(
  p_profile_id uuid, p_auth_user_id uuid, p_operation text, p_folder_id uuid default null,
  p_expected_revision bigint default null, p_metadata jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; metadata_value jsonb := coalesce(p_metadata, '{}'::jsonb);
  folder_row public.file_folders; parent_key uuid;
begin
  if p_operation in ('trash', 'restore') then
    result := public.mutate_account_file_tree_action(
      p_profile_id, p_auth_user_id, p_operation,
      jsonb_build_array(jsonb_build_object('type', 'folder', 'id', p_folder_id,
        'revision', p_expected_revision)),
      nullif(metadata_value->>'parentId', '')::uuid, metadata_value ? 'parentId');
    return result->'folders'->0;
  end if;

  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  if jsonb_typeof(metadata_value) <> 'object' then
    raise exception 'Invalid folder operation' using errcode = '22023';
  end if;

  if p_operation = 'create' then
    parent_key := nullif(metadata_value->>'parentId', '')::uuid;
    if parent_key is not null and exists(select 1 from public.file_folders parent
        where parent.profile_id = p_profile_id and parent.id = parent_key)
        and not public.file_folder_location_is_outside_archive(p_profile_id, parent_key) then
      raise exception 'Archived folders cannot receive new folders' using errcode = '23514';
    end if;
    return public.mutate_account_folder_legacy(
      p_profile_id, p_auth_user_id, p_operation, p_folder_id, p_expected_revision, metadata_value);
  end if;

  if p_folder_id is null then raise exception 'Folder ID is required' using errcode = '22023'; end if;
  select * into folder_row from public.file_folders
    where profile_id = p_profile_id and id = p_folder_id for update;
  if not found then
    return public.mutate_account_folder_legacy(
      p_profile_id, p_auth_user_id, p_operation, p_folder_id, p_expected_revision, metadata_value);
  end if;
  if folder_row.deleted_at is not null or folder_row.purge_pending_at is not null then
    raise exception 'Folder is being permanently removed' using errcode = '23514';
  end if;
  if p_expected_revision is null or folder_row.revision <> p_expected_revision then
    raise exception 'Folder changed; reload before editing' using errcode = '40001';
  end if;

  if p_operation in ('rename', 'move') then
    if not public.file_folder_location_is_outside_archive(p_profile_id, p_folder_id) then
      raise exception 'Archived folders cannot be renamed or moved' using errcode = '23514';
    end if;
    if p_operation = 'move' then
      parent_key := nullif(metadata_value->>'parentId', '')::uuid;
      if parent_key is not null and exists(select 1 from public.file_folders parent
          where parent.profile_id = p_profile_id and parent.id = parent_key)
          and not public.file_folder_location_is_outside_archive(p_profile_id, parent_key) then
        raise exception 'Archived folders cannot receive moved folders' using errcode = '23514';
      end if;
    end if;
  elsif p_operation = 'archive' then
    if folder_row.parent_id is not null or folder_row.kind not in ('custom', 'course')
        or (folder_row.kind = 'course' and folder_row.course_id is null)
        or folder_row.archived_at is not null or folder_row.trashed_at is not null then
      raise exception 'Only active root custom or course folders can be archived' using errcode = '23514';
    end if;
    -- Managed course display snapshots are read from courses by the legacy
    -- mutator. Client supplied values are not trusted; custom roots have none.
    metadata_value := metadata_value - 'courseNameSnapshot' - 'courseColorSnapshot';
  elsif p_operation = 'unarchive' then
    if folder_row.parent_id is not null or folder_row.kind not in ('custom', 'course')
        or (folder_row.kind = 'course' and folder_row.course_id is null)
        or folder_row.archived_at is null or folder_row.trashed_at is not null then
      raise exception 'Only archived root custom or course folders can be unarchived' using errcode = '23514';
    end if;
    metadata_value := metadata_value - 'courseNameSnapshot' - 'courseColorSnapshot';
  end if;

  return public.mutate_account_folder_legacy(
    p_profile_id, p_auth_user_id, p_operation, p_folder_id, p_expected_revision, metadata_value);
end;
$$;
revoke all on function public.mutate_account_folder(uuid, uuid, text, uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_account_folder(uuid, uuid, text, uuid, bigint, jsonb) to service_role;

-- Direct single-file moves must enforce the same source/target archive boundary
-- as batch moves. Trash and restore stay on the existing recursive path.
create or replace function public.mutate_account_file_location(
  p_profile_id uuid, p_auth_user_id uuid, p_file_id uuid, p_operation text,
  p_expected_metadata_revision bigint default null, p_metadata jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; metadata_value jsonb := coalesce(p_metadata, '{}'::jsonb);
  file_row public.user_files; folder_key uuid;
begin
  if p_operation in ('trash', 'restore') then
    result := public.mutate_account_file_tree_action(
      p_profile_id, p_auth_user_id, p_operation,
      jsonb_build_array(jsonb_build_object('type', 'file', 'id', p_file_id,
        'revision', p_expected_metadata_revision)),
      nullif(metadata_value->>'folderId', '')::uuid, metadata_value ? 'folderId');
    return result->'files'->0;
  end if;
  if p_operation = 'move' then
    perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
      and initialized and onboarding_completed_at is not null for update;
    if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
    select * into file_row from public.user_files
      where profile_id = p_profile_id and id = p_file_id for update;
    if found and file_row.folder_id is not null
        and not public.file_folder_location_is_outside_archive(p_profile_id, file_row.folder_id) then
      raise exception 'Files in an archive cannot be moved' using errcode = '23514';
    end if;
    folder_key := nullif(metadata_value->>'folderId', '')::uuid;
    if folder_key is not null and exists(select 1 from public.file_folders folder
        where folder.profile_id = p_profile_id and folder.id = folder_key)
        and not public.file_folder_location_is_outside_archive(p_profile_id, folder_key) then
      raise exception 'Archived folders cannot receive moved files' using errcode = '23514';
    end if;
  end if;
  return public.mutate_account_file_location_legacy(
    p_profile_id, p_auth_user_id, p_file_id, p_operation, p_expected_metadata_revision, metadata_value);
end;
$$;
revoke all on function public.mutate_account_file_location(uuid, uuid, uuid, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_account_file_location(uuid, uuid, uuid, text, bigint, jsonb) to service_role;

-- Batch moves validate archive ancestry before the legacy atomic mutator runs.
-- Other actions keep their established paths, especially Trash/restore/purge.
create or replace function public.mutate_account_files_action(
  p_profile_id uuid, p_auth_user_id uuid, p_action text, p_items jsonb,
  p_destination_id uuid default null, p_destination_provided boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare item jsonb; item_id uuid; folder_key uuid; folder_row public.file_folders;
  file_row public.user_files;
begin
  if p_action in ('trash', 'restore') then
    return public.mutate_account_file_tree_action(
      p_profile_id, p_auth_user_id, p_action, p_items, p_destination_id, p_destination_provided);
  end if;
  if p_action = 'permanent-delete' then
    raise exception 'Use the request-scoped purge API for permanent deletion' using errcode = '22023';
  end if;
  if p_action = 'move' and jsonb_typeof(p_items) = 'array' then
    perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
      and initialized and onboarding_completed_at is not null for update;
    if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
    if p_destination_id is not null and exists(select 1 from public.file_folders destination
        where destination.profile_id = p_profile_id and destination.id = p_destination_id)
        and not public.file_folder_location_is_outside_archive(p_profile_id, p_destination_id) then
      raise exception 'Archived folders cannot receive moved items' using errcode = '23514';
    end if;
    for item in select selected.value from jsonb_array_elements(p_items) selected(value) loop
      if jsonb_typeof(item) = 'object'
          and coalesce(item->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        item_id := (item->>'id')::uuid;
        if item->>'type' = 'folder' then
          select * into folder_row from public.file_folders
            where profile_id = p_profile_id and id = item_id for update;
          if found and not public.file_folder_location_is_outside_archive(p_profile_id, item_id) then
            raise exception 'Archived folders cannot be moved' using errcode = '23514';
          end if;
        elsif item->>'type' = 'file' then
          select * into file_row from public.user_files
            where profile_id = p_profile_id and id = item_id for update;
          if found and file_row.folder_id is not null
              and not public.file_folder_location_is_outside_archive(p_profile_id, file_row.folder_id) then
            raise exception 'Files in an archive cannot be moved' using errcode = '23514';
          end if;
        end if;
      end if;
    end loop;
  end if;
  return public.mutate_account_files_action_legacy(
    p_profile_id, p_auth_user_id, p_action, p_items, p_destination_id, p_destination_provided);
end;
$$;
revoke all on function public.mutate_account_files_action(uuid, uuid, text, jsonb, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.mutate_account_files_action(uuid, uuid, text, jsonb, uuid, boolean) to service_role;

-- File rename is a location-independent metadata RPC, so explicitly guard its
-- source folder chain as well.
alter function public.rename_account_file(uuid, uuid, uuid, bigint, text)
  rename to rename_account_file_legacy;
revoke all on function public.rename_account_file_legacy(uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;
create function public.rename_account_file(
  p_profile_id uuid, p_auth_user_id uuid, p_file_id uuid,
  p_expected_metadata_revision bigint, p_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare file_row public.user_files;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  select * into file_row from public.user_files
    where profile_id = p_profile_id and id = p_file_id for update;
  if found and file_row.folder_id is not null
      and not public.file_folder_location_is_outside_archive(p_profile_id, file_row.folder_id) then
    raise exception 'Files in an archive cannot be renamed' using errcode = '23514';
  end if;
  return public.rename_account_file_legacy(
    p_profile_id, p_auth_user_id, p_file_id, p_expected_metadata_revision, p_name);
end;
$$;
revoke all on function public.rename_account_file(uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.rename_account_file(uuid, uuid, uuid, bigint, text) to service_role;

notify pgrst, 'reload schema';
commit;
