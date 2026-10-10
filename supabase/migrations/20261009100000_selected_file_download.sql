-- Capture selected file trees and native document bodies while holding the
-- same account lock used by file organization and content mutations.
begin;

create function public.snapshot_account_file_selection(
  p_profile_id uuid,
  p_auth_user_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  raw_type text;
  raw_id uuid;
  item_revision numeric;
  file_revision bigint;
  file_state text;
  file_deleted_at timestamptz;
  file_trashed_at timestamptz;
  file_folder_id uuid;
  folder_revision bigint;
  folder_trashed_at timestamptz;
  folder_deleted_at timestamptz;
  folder_purge_pending_at timestamptz;
  selection_count integer;
  invalid_tree boolean;
  result jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'A file selection is required' using errcode = '22023';
  end if;
  selection_count := jsonb_array_length(p_items);
  if selection_count < 1 or selection_count > 1000 then
    raise exception 'A file selection must contain between 1 and 1000 items' using errcode = '22023';
  end if;

  -- This row lock serializes the metadata and native-body snapshot against all
  -- account file, folder, and document mutations.
  perform 1 from public.app_profiles
    where id = p_profile_id and auth_user_id = p_auth_user_id and initialized
    for update;
  if not found then
    raise exception 'Account is not available for file operations' using errcode = '42501';
  end if;

  -- Validate every submitted row, including repeated rows and descendants that
  -- a selected folder will cover. Deduplication happens only after these checks.
  for item in
    select value, ordinality
      from jsonb_array_elements(p_items) with ordinality as submitted(value, ordinality)
  loop
    if jsonb_typeof(item.value) <> 'object'
        or (select count(*) from jsonb_object_keys(item.value)) <> 3
        or exists (
          select 1 from jsonb_object_keys(item.value) as keys(key)
            where keys.key not in ('type', 'id', 'revision')
        ) then
      raise exception 'Each selected item must contain only type, id, and revision' using errcode = '22023';
    end if;
    raw_type := item.value->>'type';
    if jsonb_typeof(item.value->'type') is distinct from 'string'
        or raw_type not in ('file', 'folder') then
      raise exception 'Invalid selected item type' using errcode = '22023';
    end if;
    if jsonb_typeof(item.value->'id') is distinct from 'string'
        or item.value->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'Invalid selected item ID' using errcode = '22023';
    end if;
    if jsonb_typeof(item.value->'revision') is distinct from 'number'
        or (item.value->'revision')::text !~ '^[1-9][0-9]{0,15}$' then
      raise exception 'Invalid selected item revision' using errcode = '22023';
    end if;
    item_revision := (item.value->>'revision')::numeric;
    if item_revision > 9007199254740991 then
      raise exception 'Invalid selected item revision' using errcode = '22023';
    end if;
    raw_id := (item.value->>'id')::uuid;

    if raw_type = 'file' then
      select f.metadata_revision, f.state, f.deleted_at, f.trashed_at, f.folder_id
        into file_revision, file_state, file_deleted_at, file_trashed_at, file_folder_id
        from public.user_files f
        where f.profile_id = p_profile_id and f.id = raw_id;
      if not found or file_deleted_at is not null or file_trashed_at is not null then
        raise exception 'Selected file is unavailable' using errcode = 'P0002';
      end if;
      if file_revision <> item_revision then
        raise exception 'Selected file metadata changed' using errcode = '40001';
      end if;
      if file_state <> 'ready' then
        raise exception 'Selected file is not ready' using errcode = '40001';
      end if;
      if file_folder_id is not null and not public.file_folder_location_is_active(p_profile_id, file_folder_id) then
        raise exception 'Selected file has an unavailable folder location' using errcode = 'P0002';
      end if;
    else
      select f.revision, f.trashed_at, f.deleted_at, f.purge_pending_at
        into folder_revision, folder_trashed_at, folder_deleted_at, folder_purge_pending_at
        from public.file_folders f
        where f.profile_id = p_profile_id and f.id = raw_id;
      if not found or folder_trashed_at is not null or folder_deleted_at is not null
          or folder_purge_pending_at is not null then
        raise exception 'Selected folder is unavailable' using errcode = 'P0002';
      end if;
      if folder_revision <> item_revision then
        raise exception 'Selected folder metadata changed' using errcode = '40001';
      end if;
      if not public.file_folder_location_is_active(p_profile_id, raw_id) then
        raise exception 'Selected folder has an unavailable parent' using errcode = 'P0002';
      end if;
    end if;
  end loop;

  with recursive
  submitted as (
    select value->>'type' as item_type, (value->>'id')::uuid as item_id, ordinality::bigint as item_ordinal
      from jsonb_array_elements(p_items) with ordinality as raw(value, ordinality)
  ),
  roots as (
    select item_type, item_id, min(item_ordinal) as item_ordinal
      from submitted group by item_type, item_id
  ),
  root_ancestors(root_type, root_id, ancestor_id, path, cycle) as (
    select root.item_type, root.item_id,
        case when root.item_type = 'folder' then folder.parent_id else file.folder_id end,
        case when root.item_type = 'folder' then array[root.item_id] else array[]::uuid[] end,
        false
      from roots root
      left join public.file_folders folder
        on root.item_type = 'folder' and folder.profile_id = p_profile_id and folder.id = root.item_id
      left join public.user_files file
        on root.item_type = 'file' and file.profile_id = p_profile_id and file.id = root.item_id
      where (root.item_type = 'folder' and folder.parent_id is not null)
          or (root.item_type = 'file' and file.folder_id is not null)
    union all
    select ancestors.root_type, ancestors.root_id, parent.parent_id,
        ancestors.path || parent.id, parent.parent_id = any(ancestors.path)
      from root_ancestors ancestors
      join public.file_folders parent
        on parent.profile_id = p_profile_id and parent.id = ancestors.ancestor_id
      where ancestors.ancestor_id is not null and not ancestors.cycle
          and parent.parent_id is not null
  ),
  effective_roots as (
    select root.* from roots root
      where not exists (
        select 1 from root_ancestors ancestors
        join roots selected_folder
          on selected_folder.item_type = 'folder' and selected_folder.item_id = ancestors.ancestor_id
        where ancestors.root_type = root.item_type and ancestors.root_id = root.item_id
      )
  ),
  folder_walk(root_ordinal, root_id, folder_id, path, depth, cycle) as (
    select root.item_ordinal, root.item_id, folder.id, array[folder.id], 0, false
      from effective_roots root
      join public.file_folders folder
        on folder.profile_id = p_profile_id and folder.id = root.item_id
      where root.item_type = 'folder'
    union all
    select walk.root_ordinal, walk.root_id, child.id, walk.path || child.id,
        walk.depth + 1, child.id = any(walk.path)
      from folder_walk walk
      join public.file_folders child
        on child.profile_id = p_profile_id and child.parent_id = walk.folder_id
          and child.trashed_at is null and child.deleted_at is null and child.purge_pending_at is null
      where not walk.cycle
  ),
  folder_ranked as (
    select walk.folder_id, walk.root_id, walk.root_ordinal, walk.depth,
        row_number() over (partition by walk.folder_id order by walk.root_ordinal, walk.depth, walk.root_id) as rank
      from folder_walk walk
  ),
  unique_folders as (
    select folder_id, root_id, root_ordinal, depth from folder_ranked where rank = 1
  ),
  file_candidates as (
    select root.item_ordinal as root_ordinal, 'file'::text as root_type,
        root.item_id as root_id, root.item_id as file_id
      from effective_roots root where root.item_type = 'file'
    union all
    select walk.root_ordinal, 'folder'::text, walk.root_id, file.id
      from folder_walk walk
      join public.user_files file
        on file.profile_id = p_profile_id and file.folder_id = walk.folder_id
          and file.trashed_at is null and file.deleted_at is null
  ),
  file_ranked as (
    select candidate.file_id, candidate.root_type, candidate.root_id, candidate.root_ordinal,
        row_number() over (partition by candidate.file_id order by candidate.root_ordinal, candidate.root_type, candidate.root_id) as rank
      from file_candidates candidate
  ),
  unique_files as (
    select file_id, root_type, root_id, root_ordinal from file_ranked where rank = 1
  ),
  invalid_state as (
    select
      exists (
        select 1 from folder_walk walk
        join public.file_folders folder on folder.profile_id = p_profile_id and folder.id = walk.folder_id
        where walk.cycle or folder.trashed_at is not null or folder.deleted_at is not null
          or folder.purge_pending_at is not null
      )
      or exists (
        select 1 from unique_files selected
        join public.user_files file on file.profile_id = p_profile_id and file.id = selected.file_id
        where file.state <> 'ready' or file.deleted_at is not null or file.trashed_at is not null
      )
      or exists (
        select 1 from unique_files selected
        join public.user_files file on file.profile_id = p_profile_id and file.id = selected.file_id
        left join public.native_file_documents document
          on document.profile_id = p_profile_id and document.file_id = file.id
        where file.content_backend = 'native-text' and document.file_id is null
      ) as invalid
  ),
  folder_rows as (
    select folder.*, selected.root_id as download_root_id,
        selected.root_ordinal as download_root_ordinal, selected.depth
      from unique_folders selected
      join public.file_folders folder on folder.profile_id = p_profile_id and folder.id = selected.folder_id
  ),
  file_rows as (
    select file.*, selected.root_type as download_root_type,
        selected.root_id as download_root_id, selected.root_ordinal as download_root_ordinal
      from unique_files selected
      join public.user_files file on file.profile_id = p_profile_id and file.id = selected.file_id
  )
  select invalid_state.invalid,
      jsonb_build_object(
        'folders', (
          select coalesce(jsonb_agg(
            to_jsonb(folder) || jsonb_build_object(
              'download_root_type', 'folder',
              'download_root_id', folder.download_root_id,
              'download_root_ordinal', folder.download_root_ordinal
            ) order by folder.download_root_ordinal, folder.depth, lower(folder.name), folder.id
          ), '[]'::jsonb)
            from folder_rows folder
        ),
        'files', (
          select coalesce(jsonb_agg(
            to_jsonb(file) || jsonb_build_object(
              'download_root_type', file.download_root_type,
              'download_root_id', file.download_root_id,
              'download_root_ordinal', file.download_root_ordinal
            ) order by file.download_root_ordinal, lower(file.name), file.id
          ), '[]'::jsonb)
            from file_rows file
        ),
        'documents', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'file_id', file.id, 'body', document.body, 'content_revision', file.content_revision
          ) order by file.download_root_ordinal, lower(file.name), file.id), '[]'::jsonb)
            from file_rows file
            join public.native_file_documents document
              on document.profile_id = p_profile_id and document.file_id = file.id
            where file.content_backend = 'native-text'
        )
      )
    into invalid_tree, result
    from invalid_state;

  if coalesce(invalid_tree, true) then
    raise exception 'The selected folder tree changed or contains a file that is not ready' using errcode = '40001';
  end if;
  return result;
end;
$$;

revoke all on function public.snapshot_account_file_selection(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.snapshot_account_file_selection(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
