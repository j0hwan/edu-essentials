-- Recursive Trash, restore recovery locations, and retryable permanent purge.
begin;

alter table public.user_files add column original_location_path text;
alter table public.file_folders
  add column deleted_at timestamptz,
  add column purge_pending_at timestamptz,
  add column original_location_path text,
  add constraint file_folder_purge_state_check check (deleted_at is null or purge_pending_at is null);

create table public.account_file_recovery_folders (
  profile_id uuid primary key references public.app_profiles(id) on delete cascade,
  folder_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (profile_id, folder_id) references public.file_folders(profile_id, id) on delete set null (folder_id)
);
alter table public.account_file_recovery_folders enable row level security;
revoke all on public.account_file_recovery_folders from public, anon, authenticated, service_role;

create table public.account_file_purge_manifests (
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  request_id uuid not null,
  request_descriptor jsonb not null,
  file_ids uuid[] not null default array[]::uuid[],
  folder_ids uuid[] not null default array[]::uuid[],
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (profile_id, request_id)
);
alter table public.account_file_purge_manifests enable row level security;
revoke all on public.account_file_purge_manifests from public, anon, authenticated, service_role;

create or replace function public.file_folder_location_is_active(p_profile_id uuid, p_folder_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare active boolean;
begin
  if p_folder_id is null then return true; end if;
  with recursive ancestors(id, parent_id, trashed_at, deleted_at, purge_pending_at, path, cycle) as (
    select f.id, f.parent_id, f.trashed_at, f.deleted_at, f.purge_pending_at, array[f.id], false
      from public.file_folders f where f.profile_id = p_profile_id and f.id = p_folder_id
    union all
    select parent.id, parent.parent_id, parent.trashed_at, parent.deleted_at, parent.purge_pending_at,
      a.path || parent.id, parent.id = any(a.path)
      from ancestors a join public.file_folders parent
        on parent.profile_id = p_profile_id and parent.id = a.parent_id
      where a.parent_id is not null and not a.cycle
  )
  select coalesce(bool_and(trashed_at is null and deleted_at is null and purge_pending_at is null and not cycle), false)
    into active from ancestors;
  return active;
end;
$$;

-- Keep the original location guards and add a separate fence for purge tombstones.
create function public.guard_file_folder_purge_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  if coalesce(current_setting('app.account_file_purge_write', true), '') = '1' then return new; end if;
  if (tg_op = 'UPDATE' and (old.deleted_at is not null or old.purge_pending_at is not null))
      or new.deleted_at is not null or new.purge_pending_at is not null then
    raise exception 'Folder purge state can only be changed by the purge service' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_file_folder_purge_write() from public, anon, authenticated;
create trigger file_folders_05_purge_guard before insert or update or delete on public.file_folders
  for each row execute function public.guard_file_folder_purge_write();

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
  changed := row(new.parent_id, new.name, new.kind, new.course_id, new.archived_at,
      new.semester_label, new.course_name_snapshot, new.course_color_snapshot,
      new.trashed_at, new.trash_operation_id, new.original_parent_id,
      new.deleted_at, new.purge_pending_at, new.original_location_path)
    is distinct from row(old.parent_id, old.name, old.kind, old.course_id, old.archived_at,
      old.semester_label, old.course_name_snapshot, old.course_color_snapshot,
      old.trashed_at, old.trash_operation_id, old.original_parent_id,
      old.deleted_at, old.purge_pending_at, old.original_location_path);
  new.revision := case when changed then old.revision + 1 else old.revision end;
  new.updated_at := case when changed
    then greatest(clock_timestamp(), old.updated_at + interval '1 millisecond') else old.updated_at end;
  return new;
end;
$$;

create or replace function public.advance_file_revisions()
returns trigger language plpgsql set search_path = '' as $$
declare metadata_changed boolean; content_changed boolean;
begin
  if tg_op = 'INSERT' then
    new.metadata_revision := 1;
    new.content_revision := 1;
    new.created_at := coalesce(new.created_at, clock_timestamp());
    new.updated_at := coalesce(new.updated_at, new.created_at);
    return new;
  end if;
  metadata_changed := row(new.name, new.mime_type, new.course_id, new.assignment_id, new.kind,
      new.bucket_id, new.object_path, new.folder_id, new.content_backend, new.state, new.deleted_at,
      new.trashed_at, new.trash_operation_id, new.original_folder_id, new.original_location_path)
    is distinct from row(old.name, old.mime_type, old.course_id, old.assignment_id, old.kind,
      old.bucket_id, old.object_path, old.folder_id, old.content_backend, old.state, old.deleted_at,
      old.trashed_at, old.trash_operation_id, old.original_folder_id, old.original_location_path);
  content_changed := row(new.size_bytes, new.content_sha256)
    is distinct from row(old.size_bytes, old.content_sha256);
  new.metadata_revision := old.metadata_revision + case when metadata_changed then 1 else 0 end;
  new.content_revision := old.content_revision + case when content_changed then 1 else 0 end;
  new.updated_at := case when metadata_changed or content_changed
    then greatest(clock_timestamp(), old.updated_at + interval '1 millisecond') else old.updated_at end;
  return new;
end;
$$;

create function public.file_folder_display_path(p_profile_id uuid, p_folder_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  with recursive ancestors(id, parent_id, name, depth, display_path, path) as (
    select folder.id, folder.parent_id, folder.name, 0, folder.name, array[folder.id]
      from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = p_folder_id
    union all
    select parent.id, parent.parent_id, parent.name, ancestors.depth + 1,
      parent.name || '/' || ancestors.display_path, ancestors.path || parent.id
      from ancestors join public.file_folders parent
        on parent.profile_id = p_profile_id and parent.id = ancestors.parent_id
      where ancestors.parent_id is not null and not parent.id = any(ancestors.path)
  )
  select display_path from ancestors order by depth desc limit 1;
$$;
revoke all on function public.file_folder_display_path(uuid, uuid) from public, anon, authenticated, service_role;

create function public.capture_file_trash_path()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_path text;
begin
  if old.trashed_at is null and new.trashed_at is not null then
    parent_path := public.file_folder_display_path(old.profile_id, old.folder_id);
    new.original_location_path := case when parent_path is null or parent_path = ''
      then old.name else parent_path || '/' || old.name end;
  end if;
  return new;
end;
$$;
revoke all on function public.capture_file_trash_path() from public, anon, authenticated;
create trigger user_files_05_trash_path_capture before update of trashed_at on public.user_files
  for each row execute function public.capture_file_trash_path();

create function public.capture_folder_trash_path()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.trashed_at is null and new.trashed_at is not null then
    new.original_location_path := public.file_folder_display_path(old.profile_id, old.id);
  end if;
  return new;
end;
$$;
revoke all on function public.capture_folder_trash_path() from public, anon, authenticated;
create trigger file_folders_01_trash_path_capture before update of trashed_at on public.file_folders
  for each row execute function public.capture_folder_trash_path();

create function public.ensure_account_file_recovery_folder(p_profile_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare mapped_id uuid; new_id uuid;
begin
  perform 1 from public.app_profiles where id = p_profile_id for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  select folder.folder_id into mapped_id
    from public.account_file_recovery_folders folder where folder.profile_id = p_profile_id for update;
  if mapped_id is not null and exists(
      select 1 from public.file_folders folder
      where folder.profile_id = p_profile_id and folder.id = mapped_id
        and folder.kind = 'custom' and folder.name = 'Restored files' and folder.parent_id is null
        and folder.archived_at is null and folder.trashed_at is null
        and folder.deleted_at is null and folder.purge_pending_at is null) then
    return mapped_id;
  end if;
  new_id := gen_random_uuid();
  insert into public.file_folders(profile_id, id, parent_id, name, kind)
    values(p_profile_id, new_id, null, 'Restored files', 'custom');
  insert into public.account_file_recovery_folders(profile_id, folder_id, updated_at)
    values(p_profile_id, new_id, clock_timestamp())
    on conflict(profile_id) do update set folder_id = excluded.folder_id, updated_at = excluded.updated_at;
  return new_id;
end;
$$;
revoke all on function public.ensure_account_file_recovery_folder(uuid) from public, anon, authenticated, service_role;

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
      where folder_row.profile_id = new.profile_id and folder_row.id = new.folder_id
        and folder_row.deleted_at is null and folder_row.purge_pending_at is null) then
    raise exception 'Unknown or foreign file folder' using errcode = '23503';
  end if;
  if new.folder_id is not null and not public.file_folder_location_is_active(new.profile_id, new.folder_id) then
    raise exception 'File destination is under a trashed or deleted folder' using errcode = '23514';
  end if;
  if new.trashed_at is not null and new.folder_id is not null then
    raise exception 'Trashed files cannot have an active folder location' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.trashed_at is not null and new.trashed_at is not null
      and row(new.name, new.mime_type, new.kind, new.size_bytes, new.content_sha256,
        new.folder_id, new.content_backend, new.state, new.original_location_path)
        is distinct from row(old.name, old.mime_type, old.kind, old.size_bytes, old.content_sha256,
        old.folder_id, old.content_backend, old.state, old.original_location_path)
      and not (coalesce(current_setting('app.account_file_purge_write', true), '') = '1'
        and old.state = 'ready' and new.state = 'deleting'
        and row(new.name, new.mime_type, new.kind, new.size_bytes, new.content_sha256,
          new.folder_id, new.content_backend, new.original_location_path)
          is not distinct from row(old.name, old.mime_type, old.kind, old.size_bytes, old.content_sha256,
          old.folder_id, old.content_backend, old.original_location_path)) then
    raise exception 'Restore a file before changing it' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.mutate_account_file_tree_action(
  p_profile_id uuid, p_auth_user_id uuid, p_action text, p_items jsonb,
  p_destination_id uuid default null, p_destination_provided boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  selected_item jsonb;
  root_entry jsonb;
  item_type text;
  item_id uuid;
  item_revision bigint;
  root_type text;
  root_id uuid;
  operation_id uuid;
  target_folder_id uuid;
  file_row public.user_files;
  folder_row public.file_folders;
  member_file record;
  member_folder record;
  lock_row record;
  dashboard jsonb;
  folder_snapshot jsonb;
  snapshot_path text;
  parent_path text;
  root_parent_id uuid;
  recovery_id uuid;
  recovery_json jsonb;
  blocker_id uuid;
  blocker_name text;
  source_is_referenced boolean;
  is_covered boolean;
  root_map jsonb := '[]'::jsonb;
  file_rows jsonb := '[]'::jsonb;
  folder_rows jsonb := '[]'::jsonb;
  file_activity_rows jsonb := '[]'::jsonb;
  folder_activity_rows jsonb := '[]'::jsonb;
  operation_time timestamptz;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('trash', 'restore') or p_items is null
      or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Invalid recursive file action or item list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 1000 then
    raise exception 'Invalid recursive file action or item list' using errcode = '22023';
  end if;
  if p_destination_id is not null and p_action <> 'restore' then
    raise exception 'A destination is only valid for restore' using errcode = '22023';
  end if;
  if coalesce(p_destination_provided, false) and p_action <> 'restore' then
    raise exception 'Destination presence is only valid for restore' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) selected(value)
      where jsonb_typeof(selected.value) is distinct from 'object'
        or (selected.value->>'type' is distinct from 'file' and selected.value->>'type' is distinct from 'folder')
        or jsonb_typeof(selected.value->'id') is distinct from 'string'
        or coalesce(selected.value->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(selected.value->'revision') is distinct from 'number') then
    raise exception 'Each item needs a type, UUID id, and numeric revision' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) selected(value)
      where (selected.value->>'revision')::numeric < 1
        or (selected.value->>'revision')::numeric > 9223372036854775807
        or trunc((selected.value->>'revision')::numeric) <> (selected.value->>'revision')::numeric) then
    raise exception 'Item revisions must be positive integers' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
      (select count(distinct (selected.value->>'type', selected.value->>'id'))
        from jsonb_array_elements(p_items) selected(value)) then
    raise exception 'Duplicate item IDs are not allowed' using errcode = '22023';
  end if;
  if p_destination_id is not null and not exists(select 1 from public.file_folders destination
      where destination.profile_id = p_profile_id and destination.id = p_destination_id
        and destination.deleted_at is null and destination.purge_pending_at is null) then
    raise exception 'Unknown or foreign destination folder' using errcode = '23503';
  end if;
  if p_destination_id is not null and not public.file_folder_location_is_active(p_profile_id, p_destination_id) then
    raise exception 'Destination is under a trashed or deleted folder' using errcode = '23514';
  end if;
  select payload into dashboard from public.dashboard_state where profile_id = p_profile_id;

  -- Validate and lock every submitted item before expanding or changing the tree.
  for item in select selected.value from jsonb_array_elements(p_items) with ordinality selected(value, ordinal)
      order by selected.ordinal loop
    item_type := item->>'type';
    item_id := (item->>'id')::uuid;
    item_revision := (item->>'revision')::bigint;
    if item_type = 'file' then
      select * into file_row from public.user_files where profile_id = p_profile_id and id = item_id for update;
      if not found then raise exception 'File not found' using errcode = 'P0002'; end if;
      if file_row.metadata_revision <> item_revision then
        raise exception 'File changed; reload before editing' using errcode = '40001';
      end if;
      if file_row.deleted_at is not null then
        raise exception 'Permanently deleted files cannot be changed' using errcode = '23514';
      end if;
      if file_row.state <> 'ready' then raise exception 'File is unavailable for location changes' using errcode = '23514'; end if;
      if p_action = 'trash' then
        if file_row.trashed_at is null then
          null;
        elsif file_row.state <> 'ready' then
          raise exception 'File is unavailable' using errcode = '23514';
        end if;
      elsif file_row.trashed_at is null then
        raise exception 'File is not in Trash' using errcode = '22023';
      end if;
    else
      select * into folder_row from public.file_folders where profile_id = p_profile_id and id = item_id for update;
      if not found then raise exception 'Folder not found' using errcode = 'P0002'; end if;
      if folder_row.revision <> item_revision then
        raise exception 'Folder changed; reload before editing' using errcode = '40001';
      end if;
      if folder_row.deleted_at is not null or folder_row.purge_pending_at is not null then
        raise exception 'Folder is being permanently removed' using errcode = '23514';
      end if;
      if p_action = 'trash' then
        if folder_row.trashed_at is not null then raise exception 'Folder is already in Trash' using errcode = '22023'; end if;
        if folder_row.kind = 'course' and folder_row.course_id is not null then
          raise exception 'Managed course folders cannot be trashed' using errcode = '23514';
        end if;
      elsif folder_row.trashed_at is null then
        raise exception 'Folder is not in Trash' using errcode = '22023';
      end if;
    end if;
  end loop;

  -- A selected descendant is covered by its selected folder ancestor. Its own
  -- revision was still checked above before the selected roots are collapsed.
  for item in select selected.value from jsonb_array_elements(p_items) with ordinality selected(value, ordinal)
      order by selected.ordinal loop
    item_type := item->>'type';
    item_id := (item->>'id')::uuid;
    is_covered := false;
    if p_action = 'trash' then
      if item_type = 'folder' then
        with recursive ancestors(id, parent_id, path) as (
          select parent.id, parent.parent_id, array[parent.id]
            from public.file_folders current_folder join public.file_folders parent
              on parent.profile_id = current_folder.profile_id and parent.id = current_folder.parent_id
            where current_folder.profile_id = p_profile_id and current_folder.id = item_id
          union all
          select parent.id, parent.parent_id, ancestors.path || parent.id
            from ancestors join public.file_folders parent
              on parent.profile_id = p_profile_id and parent.id = ancestors.parent_id
            where ancestors.parent_id is not null and not parent.id = any(ancestors.path)
        )
        select exists(select 1 from ancestors
          where exists(select 1 from jsonb_array_elements(p_items) chosen(value)
            where chosen.value->>'type' = 'folder' and (chosen.value->>'id')::uuid = ancestors.id))
          into is_covered;
      else
        with recursive ancestors(id, parent_id, path) as (
          select folder.id, folder.parent_id, array[folder.id]
            from public.user_files current_file join public.file_folders folder
              on folder.profile_id = current_file.profile_id and folder.id = current_file.folder_id
            where current_file.profile_id = p_profile_id and current_file.id = item_id
          union all
          select parent.id, parent.parent_id, ancestors.path || parent.id
            from ancestors join public.file_folders parent
              on parent.profile_id = p_profile_id and parent.id = ancestors.parent_id
            where ancestors.parent_id is not null and not parent.id = any(ancestors.path)
        )
        select exists(select 1 from ancestors
          where exists(select 1 from jsonb_array_elements(p_items) chosen(value)
            where chosen.value->>'type' = 'folder' and (chosen.value->>'id')::uuid = ancestors.id))
          into is_covered;
      end if;
    else
      if item_type = 'folder' then
        select selected_folder.trash_operation_id into operation_id
          from public.file_folders selected_folder where selected_folder.profile_id = p_profile_id and selected_folder.id = item_id;
        with recursive ancestors(id, original_parent_id, trash_operation_id, path) as (
          select parent.id, parent.original_parent_id, parent.trash_operation_id, array[parent.id]
            from public.file_folders current_folder join public.file_folders parent
              on parent.profile_id = current_folder.profile_id and parent.id = current_folder.original_parent_id
            where current_folder.profile_id = p_profile_id and current_folder.id = item_id
              and parent.trash_operation_id = operation_id and parent.trashed_at is not null
          union all
          select parent.id, parent.original_parent_id, parent.trash_operation_id, ancestors.path || parent.id
            from ancestors join public.file_folders parent
              on parent.profile_id = p_profile_id and parent.id = ancestors.original_parent_id
            where parent.trash_operation_id = operation_id and parent.trashed_at is not null
              and not parent.id = any(ancestors.path)
        )
        select exists(select 1 from ancestors
          where exists(select 1 from jsonb_array_elements(p_items) chosen(value)
            where chosen.value->>'type' = 'folder' and (chosen.value->>'id')::uuid = ancestors.id))
          into is_covered;
      else
        select selected_file.trash_operation_id into operation_id
          from public.user_files selected_file where selected_file.profile_id = p_profile_id and selected_file.id = item_id;
        with recursive ancestors(id, original_parent_id, trash_operation_id, path) as (
          select folder.id, folder.original_parent_id, folder.trash_operation_id, array[folder.id]
            from public.user_files current_file join public.file_folders folder
              on folder.profile_id = current_file.profile_id and folder.id = current_file.original_folder_id
            where current_file.profile_id = p_profile_id and current_file.id = item_id
              and folder.trash_operation_id = operation_id and folder.trashed_at is not null
          union all
          select parent.id, parent.original_parent_id, parent.trash_operation_id, ancestors.path || parent.id
            from ancestors join public.file_folders parent
              on parent.profile_id = p_profile_id and parent.id = ancestors.original_parent_id
            where parent.trash_operation_id = operation_id and parent.trashed_at is not null
              and not parent.id = any(ancestors.path)
        )
        select exists(select 1 from ancestors
          where exists(select 1 from jsonb_array_elements(p_items) chosen(value)
            where chosen.value->>'type' = 'folder' and (chosen.value->>'id')::uuid = ancestors.id))
          into is_covered;
      end if;
    end if;
    if not is_covered then
      if p_action = 'trash' and item_type = 'file' then
        select * into file_row from public.user_files where profile_id = p_profile_id and id = item_id;
        operation_id := case when file_row.trashed_at is null then gen_random_uuid() else null end;
      elsif p_action = 'trash' then
        operation_id := gen_random_uuid();
      else
        operation_id := case when item_type = 'file'
          then (select selected_file.trash_operation_id from public.user_files selected_file where selected_file.profile_id=p_profile_id and selected_file.id=item_id)
          else (select selected_folder.trash_operation_id from public.file_folders selected_folder where selected_folder.profile_id=p_profile_id and selected_folder.id=item_id) end;
      end if;
      root_map := root_map || jsonb_build_array(jsonb_build_object(
        'type', item_type, 'id', item_id, 'operationId', operation_id));
    end if;
  end loop;

  -- Lock and preflight every descendant before the first write.
  for root_entry in select value from jsonb_array_elements(root_map) root(value) loop
    root_type := root_entry->>'type';
    root_id := (root_entry->>'id')::uuid;
    operation_id := nullif(root_entry->>'operationId', '')::uuid;
    if p_action = 'trash' and root_type = 'folder' then
      for lock_row in
        with recursive descendants(id, parent_id, depth, path) as (
          select folder.id, folder.parent_id, 0, array[folder.id]
            from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = root_id
              and folder.trashed_at is null and folder.deleted_at is null and folder.purge_pending_at is null
          union all
          select child.id, child.parent_id, parent.depth + 1, parent.path || child.id
            from descendants parent join public.file_folders child
              on child.profile_id = p_profile_id and child.parent_id = parent.id
            where child.trashed_at is null and child.deleted_at is null and child.purge_pending_at is null
              and not child.id = any(parent.path)
        ) select id from descendants order by depth desc, id
      loop
        perform 1 from public.file_folders where profile_id = p_profile_id and id = lock_row.id for update;
      end loop;
      for lock_row in
        with recursive descendants(id, parent_id, depth, path) as (
          select folder.id, folder.parent_id, 0, array[folder.id]
            from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = root_id
              and folder.trashed_at is null and folder.deleted_at is null and folder.purge_pending_at is null
          union all
          select child.id, child.parent_id, parent.depth + 1, parent.path || child.id
            from descendants parent join public.file_folders child
              on child.profile_id = p_profile_id and child.parent_id = parent.id
            where child.trashed_at is null and child.deleted_at is null and child.purge_pending_at is null
              and not child.id = any(parent.path)
        )
        select file.id from descendants join public.user_files file
          on file.profile_id = p_profile_id and file.folder_id = descendants.id
          where file.trashed_at is null and file.deleted_at is null order by file.id
      loop
        perform 1 from public.user_files where profile_id = p_profile_id and id = lock_row.id for update;
      end loop;
      if exists(
        with recursive descendants(id, parent_id, depth, path) as (
          select folder.id, folder.parent_id, 0, array[folder.id]
            from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = root_id
          union all
          select child.id, child.parent_id, parent.depth + 1, parent.path || child.id
            from descendants parent join public.file_folders child
              on child.profile_id = p_profile_id and child.parent_id = parent.id
            where child.trashed_at is null and child.deleted_at is null and child.purge_pending_at is null
              and not child.id = any(parent.path)
        ) select 1 from descendants join public.file_folders folder
            on folder.profile_id = p_profile_id and folder.id = descendants.id
          where folder.kind = 'course' and folder.course_id is not null
      ) then raise exception 'Managed course folders cannot be trashed' using errcode = '23514'; end if;
      if exists(
        with recursive descendants(id, parent_id, depth, path) as (
          select folder.id, folder.parent_id, 0, array[folder.id]
            from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = root_id
          union all
          select child.id, child.parent_id, parent.depth + 1, parent.path || child.id
            from descendants parent join public.file_folders child
              on child.profile_id = p_profile_id and child.parent_id = parent.id
            where child.trashed_at is null and child.deleted_at is null and child.purge_pending_at is null
              and not child.id = any(parent.path)
        ) select 1 from descendants join public.user_files file
            on file.profile_id = p_profile_id and file.folder_id = descendants.id
          where file.trashed_at is null and file.deleted_at is null and file.state <> 'ready'
      ) then raise exception 'A file in this folder is pending or being deleted. Finish that operation before moving the folder to Trash.' using errcode = '23514'; end if;
    elsif p_action = 'restore' and root_type = 'folder' then
      for lock_row in
        with recursive descendants(id, original_parent_id, depth, path) as (
          select folder.id, folder.original_parent_id, 0, array[folder.id]
            from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = root_id
          union all
          select child.id, child.original_parent_id, parent.depth + 1, parent.path || child.id
            from descendants parent join public.file_folders child
              on child.profile_id = p_profile_id and child.original_parent_id = parent.id
              and child.trash_operation_id = operation_id and child.trashed_at is not null
              and child.deleted_at is null and child.purge_pending_at is null
            where not child.id = any(parent.path)
        ) select id from descendants order by depth, id
      loop
        perform 1 from public.file_folders where profile_id = p_profile_id and id = lock_row.id for update;
      end loop;
      for lock_row in
        with recursive descendants(id, original_parent_id, depth, path) as (
          select folder.id, folder.original_parent_id, 0, array[folder.id]
            from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = root_id
          union all
          select child.id, child.original_parent_id, parent.depth + 1, parent.path || child.id
            from descendants parent join public.file_folders child
              on child.profile_id = p_profile_id and child.original_parent_id = parent.id
              and child.trash_operation_id = operation_id and child.trashed_at is not null
              and child.deleted_at is null and child.purge_pending_at is null
            where not child.id = any(parent.path)
        )
        select file.id from descendants join public.user_files file
          on file.profile_id = p_profile_id and file.original_folder_id = descendants.id
          and file.trash_operation_id = operation_id and file.trashed_at is not null
          and file.deleted_at is null order by file.id
      loop
        perform 1 from public.user_files where profile_id = p_profile_id and id = lock_row.id for update;
      end loop;
      if exists(
        with recursive descendants(id, original_parent_id, depth, path) as (
          select folder.id, folder.original_parent_id, 0, array[folder.id]
            from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = root_id
          union all
          select child.id, child.original_parent_id, parent.depth + 1, parent.path || child.id
            from descendants parent join public.file_folders child
              on child.profile_id = p_profile_id and child.original_parent_id = parent.id
              and child.trash_operation_id = operation_id and child.trashed_at is not null
              and child.deleted_at is null and child.purge_pending_at is null
            where not child.id = any(parent.path)
        ) select 1 from descendants join public.user_files file
          on file.profile_id = p_profile_id and file.original_folder_id = descendants.id
          and file.trash_operation_id = operation_id and file.trashed_at is not null
          and file.deleted_at is null where file.state <> 'ready'
      ) then raise exception 'A file in this folder is pending or being deleted and cannot be restored.' using errcode = '23514'; end if;
    end if;
  end loop;

  -- Refuse a subtree that would break a saved class or syllabus draft. Include
  -- the exact file name and ID so the caller can explain which source to detach.
  if p_action = 'trash' then
    for root_entry in select value from jsonb_array_elements(root_map) root(value) loop
      root_type := root_entry->>'type';
      root_id := (root_entry->>'id')::uuid;
      if root_type = 'file' then
        select file.id, file.name into blocker_id, blocker_name from public.user_files file
          where file.profile_id = p_profile_id and file.id = root_id and file.trashed_at is null
            and exists(select 1 from (
              select value->>'syllabusFileId' as id
                from jsonb_each(coalesce(dashboard->'d'->'courseDetails', '{}'::jsonb)) entry(key, value)
              union all
              select value->>'sourceFileId'
                from jsonb_array_elements(coalesce(dashboard->'d'->'syllabusDrafts', '[]'::jsonb)) value
            ) refs where refs.id = file.id::text);
      else
        with recursive descendants(id, parent_id, path) as (
          select folder.id, folder.parent_id, array[folder.id]
            from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = root_id
          union all
          select child.id, child.parent_id, parent.path || child.id
            from descendants parent join public.file_folders child
              on child.profile_id = p_profile_id and child.parent_id = parent.id
            where child.trashed_at is null and child.deleted_at is null and child.purge_pending_at is null
              and not child.id = any(parent.path)
        )
        select file.id, file.name into blocker_id, blocker_name from descendants join public.user_files file
          on file.profile_id = p_profile_id and file.folder_id = descendants.id
          where file.trashed_at is null and file.deleted_at is null and exists(select 1 from (
            select value->>'syllabusFileId' as id
              from jsonb_each(coalesce(dashboard->'d'->'courseDetails', '{}'::jsonb)) entry(key, value)
            union all
            select value->>'sourceFileId'
              from jsonb_array_elements(coalesce(dashboard->'d'->'syllabusDrafts', '[]'::jsonb)) value
          ) refs where refs.id = file.id::text) order by file.name limit 1;
      end if;
      if blocker_id is not null then
        raise exception 'SYLLABUS_BLOCKER: Detach the syllabus source "%" (ID %) from its class or review, save the workspace, then retry this file operation.', blocker_name, blocker_id
          using errcode = '23503';
      end if;
    end loop;
  end if;

  if p_action = 'trash' then
    for root_entry in select value from jsonb_array_elements(root_map) root(value) loop
      root_type := root_entry->>'type';
      root_id := (root_entry->>'id')::uuid;
      operation_id := nullif(root_entry->>'operationId', '')::uuid;
      if root_type = 'file' then
        select * into file_row from public.user_files where profile_id = p_profile_id and id = root_id;
        if operation_id is null then
          file_rows := file_rows || jsonb_build_array(to_jsonb(file_row));
        else
          parent_path := public.file_folder_display_path(p_profile_id, file_row.folder_id);
          snapshot_path := case when parent_path is null or parent_path = '' then file_row.name else parent_path || '/' || file_row.name end;
          update public.user_files set original_folder_id = user_files.folder_id, folder_id = null,
              trashed_at = clock_timestamp(), trash_operation_id = operation_id,
              original_location_path = snapshot_path
            where profile_id = p_profile_id and id = root_id returning * into file_row;
          file_rows := file_rows || jsonb_build_array(to_jsonb(file_row));
        end if;
      else
        with recursive descendants(id, parent_id, name, depth, display_path, path) as (
          select folder.id, folder.parent_id, folder.name, 0, folder.name, array[folder.id]
            from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = root_id
          union all
          select child.id, child.parent_id, child.name, parent.depth + 1,
            parent.display_path || '/' || child.name, parent.path || child.id
            from descendants parent join public.file_folders child
              on child.profile_id = p_profile_id and child.parent_id = parent.id
            where child.trashed_at is null and child.deleted_at is null and child.purge_pending_at is null
              and not child.id = any(parent.path)
        )
        select coalesce(jsonb_agg(jsonb_build_object('id', id, 'depth', depth,
            'path', public.file_folder_display_path(p_profile_id, id))
            order by depth desc, id), '[]'::jsonb) into folder_snapshot from descendants;
        operation_time := clock_timestamp();
        for member_file in
          with folder_paths as (select value->>'id' as id, value->>'path' as path
              from jsonb_array_elements(folder_snapshot) value)
          select file.id, file.folder_id, file.name, folder_paths.path
            from folder_paths join public.user_files file
              on file.profile_id = p_profile_id and file.folder_id::text = folder_paths.id
            where file.trashed_at is null and file.deleted_at is null
            order by file.folder_id, file.id
        loop
          update public.user_files set original_folder_id = user_files.folder_id, folder_id = null,
              trashed_at = operation_time, trash_operation_id = operation_id,
              original_location_path = member_file.path || '/' || member_file.name
            where profile_id = p_profile_id and id = member_file.id returning * into file_row;
          file_rows := file_rows || jsonb_build_array(to_jsonb(file_row));
        end loop;
        for member_folder in
          select (value->>'id')::uuid as id, value->>'path' as path
            from jsonb_array_elements(folder_snapshot) value
            order by (value->>'depth')::integer desc, (value->>'id')::uuid
        loop
          update public.file_folders set original_parent_id = parent_id, parent_id = null,
              trashed_at = operation_time, trash_operation_id = operation_id,
              original_location_path = member_folder.path
            where profile_id = p_profile_id and id = member_folder.id returning * into folder_row;
          folder_rows := folder_rows || jsonb_build_array(to_jsonb(folder_row));
        end loop;
      end if;
    end loop;
  else
    for root_entry in select value from jsonb_array_elements(root_map) root(value) loop
      root_type := root_entry->>'type';
      root_id := (root_entry->>'id')::uuid;
      operation_id := nullif(root_entry->>'operationId', '')::uuid;
      if root_type = 'folder' then
        select * into folder_row from public.file_folders where profile_id = p_profile_id and id = root_id;
        if coalesce(p_destination_provided, false) then
          root_parent_id := p_destination_id;
        elsif folder_row.original_parent_id is not null
            and public.file_folder_location_is_active(p_profile_id, folder_row.original_parent_id) then
          root_parent_id := folder_row.original_parent_id;
        elsif folder_row.original_parent_id is not null
            or position('/' in coalesce(folder_row.original_location_path, '')) > 0 then
          recovery_id := public.ensure_account_file_recovery_folder(p_profile_id);
          root_parent_id := recovery_id;
        else
          root_parent_id := null;
        end if;
        with recursive descendants(id, original_parent_id, depth, path) as (
          select folder.id, folder.original_parent_id, 0, array[folder.id]
            from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = root_id
          union all
          select child.id, child.original_parent_id, parent.depth + 1, parent.path || child.id
            from descendants parent join public.file_folders child
              on child.profile_id = p_profile_id and child.original_parent_id = parent.id
              and child.trash_operation_id = operation_id and child.trashed_at is not null
              and child.deleted_at is null and child.purge_pending_at is null
            where not child.id = any(parent.path)
        )
        select coalesce(jsonb_agg(jsonb_build_object('id', id, 'depth', depth)
            order by depth, id), '[]'::jsonb) into folder_snapshot from descendants;
        for member_folder in
          select (value->>'id')::uuid as id, (value->>'depth')::integer as depth
            from jsonb_array_elements(folder_snapshot) value order by (value->>'depth')::integer, (value->>'id')::uuid
        loop
          if member_folder.id = root_id then target_folder_id := root_parent_id;
          else select child.original_parent_id into target_folder_id from public.file_folders child
            where child.profile_id = p_profile_id and child.id = member_folder.id; end if;
          update public.file_folders set parent_id = target_folder_id, original_parent_id = null,
              trashed_at = null, trash_operation_id = null, original_location_path = null
            where profile_id = p_profile_id and id = member_folder.id returning * into folder_row;
          folder_rows := folder_rows || jsonb_build_array(to_jsonb(folder_row));
        end loop;
        for member_file in
          with restored_folders as (select (value->>'id')::uuid as id
              from jsonb_array_elements(folder_snapshot) value)
          select file.id, file.original_folder_id from restored_folders join public.user_files file
            on file.profile_id = p_profile_id and file.original_folder_id = restored_folders.id
              and file.trash_operation_id = operation_id and file.trashed_at is not null and file.deleted_at is null
            order by file.original_folder_id, file.id
        loop
          update public.user_files set folder_id = member_file.original_folder_id, original_folder_id = null,
              trashed_at = null, trash_operation_id = null, original_location_path = null
            where profile_id = p_profile_id and id = member_file.id returning * into file_row;
          file_rows := file_rows || jsonb_build_array(to_jsonb(file_row));
        end loop;
      else
        select * into file_row from public.user_files where profile_id = p_profile_id and id = root_id;
        if coalesce(p_destination_provided, false) then
          target_folder_id := p_destination_id;
        elsif file_row.original_folder_id is not null
            and public.file_folder_location_is_active(p_profile_id, file_row.original_folder_id) then
          target_folder_id := file_row.original_folder_id;
        elsif file_row.original_folder_id is not null
            or position('/' in coalesce(file_row.original_location_path, '')) > 0 then
          recovery_id := public.ensure_account_file_recovery_folder(p_profile_id);
          target_folder_id := recovery_id;
        else
          target_folder_id := null;
        end if;
        update public.user_files set folder_id = target_folder_id, original_folder_id = null,
            trashed_at = null, trash_operation_id = null, original_location_path = null
          where profile_id = p_profile_id and id = root_id returning * into file_row;
        file_rows := file_rows || jsonb_build_array(to_jsonb(file_row));
      end if;
    end loop;
  end if;

  if recovery_id is not null then
    select to_jsonb(folder) into recovery_json from public.file_folders folder
      where folder.profile_id = p_profile_id and folder.id = recovery_id;
  end if;
  return jsonb_build_object('files', file_rows, 'folders', folder_rows,
    'activities', jsonb_build_object('files', file_activity_rows, 'folders', folder_activity_rows),
    'recoveryFolder', recovery_json);
end;
$$;
revoke all on function public.mutate_account_file_tree_action(uuid, uuid, text, jsonb, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.mutate_account_file_tree_action(uuid, uuid, text, jsonb, uuid, boolean) to service_role;

create function public.begin_account_file_purge(
  p_profile_id uuid, p_auth_user_id uuid, p_request_id uuid,
  p_items jsonb, p_empty boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  item_type text;
  item_id uuid;
  item_revision bigint;
  root_folder_ids uuid[] := array[]::uuid[];
  file_ids uuid[] := array[]::uuid[];
  folder_ids uuid[] := array[]::uuid[];
  file_rows jsonb := '[]'::jsonb;
  dashboard jsonb;
  descriptor jsonb;
  manifest public.account_file_purge_manifests;
  file_row public.user_files;
  folder_row public.file_folders;
  lock_row record;
  blocker_id uuid;
  blocker_name text;
  previous_guard text;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  if p_request_id is null or p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Invalid purge request or item list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 1000 then
    raise exception 'Invalid purge request or item list' using errcode = '22023';
  end if;
  if coalesce(p_empty, false) and jsonb_array_length(p_items) <> 0 then
    raise exception 'Empty Trash does not accept a selected item list' using errcode = '22023';
  end if;
  if not coalesce(p_empty, false) and jsonb_array_length(p_items) < 1 then
    raise exception 'Choose at least one item to permanently delete' using errcode = '22023';
  end if;
  descriptor := jsonb_build_object('empty', coalesce(p_empty, false), 'items', p_items);
  select * into manifest from public.account_file_purge_manifests
    where profile_id = p_profile_id and request_id = p_request_id for update;
  if found then
    if manifest.request_descriptor is distinct from descriptor then
      raise exception 'Purge request ID was already used for a different selection' using errcode = '23505';
    end if;
    previous_guard := current_setting('app.account_file_purge_write', true);
    perform set_config('app.account_file_purge_write', '1', true);
    update public.user_files set state = 'deleting'
      where profile_id = p_profile_id and id = any(manifest.file_ids)
        and deleted_at is null and state = 'ready';
    perform set_config('app.account_file_purge_write', coalesce(previous_guard, ''), true);
    select coalesce(jsonb_agg(to_jsonb(file) order by file.id), '[]'::jsonb) into file_rows
      from public.user_files file where file.profile_id = p_profile_id
        and file.id = any(manifest.file_ids) and file.deleted_at is null;
    return jsonb_build_object('requestId', p_request_id, 'files', file_rows,
      'removed', jsonb_build_object('files', to_jsonb(manifest.file_ids), 'folders', to_jsonb(manifest.folder_ids)),
      'completed', manifest.completed_at is not null);
  end if;

  if exists(select 1 from jsonb_array_elements(p_items) selected(value)
      where jsonb_typeof(selected.value) is distinct from 'object'
        or (selected.value->>'type' is distinct from 'file' and selected.value->>'type' is distinct from 'folder')
        or jsonb_typeof(selected.value->'id') is distinct from 'string'
        or coalesce(selected.value->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(selected.value->'revision') is distinct from 'number') then
    raise exception 'Each item needs a type, UUID id, and numeric revision' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) selected(value)
      where (selected.value->>'revision')::numeric < 1
        or (selected.value->>'revision')::numeric > 9223372036854775807
        or trunc((selected.value->>'revision')::numeric) <> (selected.value->>'revision')::numeric) then
    raise exception 'Item revisions must be positive integers' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
      (select count(distinct (selected.value->>'type', selected.value->>'id'))
        from jsonb_array_elements(p_items) selected(value)) then
    raise exception 'Duplicate item IDs are not allowed' using errcode = '22023';
  end if;
  select payload into dashboard from public.dashboard_state where profile_id = p_profile_id;

  -- Validate and lock every raw selection before freezing the expanded set.
  for item in select selected.value from jsonb_array_elements(p_items) with ordinality selected(value, ordinal)
      order by selected.ordinal loop
    item_type := item->>'type';
    item_id := (item->>'id')::uuid;
    item_revision := (item->>'revision')::bigint;
    if item_type = 'file' then
      select * into file_row from public.user_files where profile_id = p_profile_id and id = item_id for update;
      if not found then raise exception 'File not found' using errcode = 'P0002'; end if;
      if file_row.deleted_at is null then
        if file_row.trashed_at is null or file_row.state not in ('ready', 'deleting') then
          raise exception 'Only trashed ready files can be permanently deleted' using errcode = '23514';
        end if;
        if file_row.metadata_revision <> item_revision then
          raise exception 'File changed; reload before deleting permanently' using errcode = '40001';
        end if;
      end if;
    else
      select * into folder_row from public.file_folders where profile_id = p_profile_id and id = item_id for update;
      if not found then raise exception 'Folder not found' using errcode = 'P0002'; end if;
      if folder_row.deleted_at is null then
        if folder_row.trashed_at is null then raise exception 'Only trashed folders can be permanently deleted' using errcode = '23514'; end if;
        if folder_row.revision <> item_revision then
          raise exception 'Folder changed; reload before deleting permanently' using errcode = '40001';
        end if;
      end if;
    end if;
  end loop;

  if coalesce(p_empty, false) then
    select coalesce(array_agg(file.id order by file.id), array[]::uuid[]) into file_ids
      from public.user_files file where file.profile_id = p_profile_id
        and file.trashed_at is not null and file.deleted_at is null;
    select coalesce(array_agg(folder.id order by folder.id), array[]::uuid[]) into folder_ids
      from public.file_folders folder where folder.profile_id = p_profile_id
        and folder.trashed_at is not null and folder.deleted_at is null;
  else
    select coalesce(array_agg(distinct selected.id order by selected.id), array[]::uuid[]) into root_folder_ids
      from jsonb_array_elements(p_items) chosen(value)
      join public.file_folders selected on selected.profile_id = p_profile_id
        and selected.id = (chosen.value->>'id')::uuid and chosen.value->>'type' = 'folder'
        and (selected.trashed_at is not null or selected.deleted_at is not null);
    with recursive folder_tree(id, original_parent_id, path) as (
      select folder.id, folder.original_parent_id, array[folder.id]
        from public.file_folders folder where folder.profile_id = p_profile_id and folder.id = any(root_folder_ids)
      union all
      select child.id, child.original_parent_id, parent.path || child.id
        from folder_tree parent join public.file_folders child
          on child.profile_id = p_profile_id and child.original_parent_id = parent.id and child.trashed_at is not null
        where not child.id = any(parent.path)
    )
    select coalesce(array_agg(distinct id order by id), array[]::uuid[]) into folder_ids from folder_tree;
    -- The selected files and every trashed descendant are frozen together.
    select coalesce(array_agg(distinct id order by id), array[]::uuid[]) into file_ids from (
      select file.id from jsonb_array_elements(p_items) chosen(value)
        join public.user_files file on file.profile_id = p_profile_id
          and file.id = (chosen.value->>'id')::uuid and chosen.value->>'type' = 'file'
          and (file.trashed_at is not null or file.deleted_at is not null)
      union all
      select file.id from public.user_files file where file.profile_id = p_profile_id
        and file.original_folder_id = any(folder_ids) and file.trashed_at is not null
    ) selected_files(id);
  end if;

  -- An empty trash may join rows already pending in another frozen manifest.
  for lock_row in select file.id from public.user_files file
      where file.profile_id = p_profile_id and file.id = any(file_ids) order by file.id loop
    perform 1 from public.user_files where profile_id = p_profile_id and id = lock_row.id for update;
  end loop;
  for lock_row in select folder.id from public.file_folders folder
      where folder.profile_id = p_profile_id and folder.id = any(folder_ids) order by folder.id loop
    perform 1 from public.file_folders where profile_id = p_profile_id and id = lock_row.id for update;
  end loop;
  if exists(select 1 from public.user_files file where file.profile_id = p_profile_id
      and file.id = any(file_ids) and file.deleted_at is null
      and (file.trashed_at is null or file.state not in ('ready', 'deleting'))) then
    raise exception 'A selected file is no longer eligible for permanent deletion' using errcode = '23514';
  end if;
  if exists(select 1 from public.file_folders folder where folder.profile_id = p_profile_id
      and folder.id = any(folder_ids) and folder.deleted_at is null and folder.trashed_at is null) then
    raise exception 'A selected folder is no longer in Trash' using errcode = '23514';
  end if;
  if exists(select 1 from public.user_files file where file.profile_id = p_profile_id
      and file.id = any(file_ids) and file.deleted_at is null and exists(select 1 from (
        select value->>'syllabusFileId' as id
          from jsonb_each(coalesce(dashboard->'d'->'courseDetails', '{}'::jsonb)) entry(key, value)
        union all
        select value->>'sourceFileId'
          from jsonb_array_elements(coalesce(dashboard->'d'->'syllabusDrafts', '[]'::jsonb)) value
      ) refs where refs.id = file.id::text)) then
    select file.id, file.name into blocker_id, blocker_name from public.user_files file
      where file.profile_id = p_profile_id and file.id = any(file_ids) and file.deleted_at is null
        and exists(select 1 from (
          select value->>'syllabusFileId' as id
            from jsonb_each(coalesce(dashboard->'d'->'courseDetails', '{}'::jsonb)) entry(key, value)
          union all
          select value->>'sourceFileId'
            from jsonb_array_elements(coalesce(dashboard->'d'->'syllabusDrafts', '[]'::jsonb)) value
        ) refs where refs.id = file.id::text) order by file.name limit 1;
    raise exception 'SYLLABUS_BLOCKER: Detach the syllabus source "%" (ID %) from its class or review, save the workspace, then retry permanent deletion.', blocker_name, blocker_id
      using errcode = '23503';
  end if;

  insert into public.account_file_purge_manifests(profile_id, request_id, request_descriptor, file_ids, folder_ids)
    values(p_profile_id, p_request_id, descriptor, file_ids, folder_ids);
  previous_guard := current_setting('app.account_file_purge_write', true);
  perform set_config('app.account_file_purge_write', '1', true);
  update public.file_folders set purge_pending_at = coalesce(purge_pending_at, clock_timestamp())
    where profile_id = p_profile_id and id = any(folder_ids) and deleted_at is null;
  update public.user_files set state = 'deleting'
    where profile_id = p_profile_id and id = any(file_ids) and deleted_at is null and state = 'ready';
  perform set_config('app.account_file_purge_write', coalesce(previous_guard, ''), true);
  select coalesce(jsonb_agg(to_jsonb(file) order by file.id), '[]'::jsonb) into file_rows
    from public.user_files file where file.profile_id = p_profile_id
      and file.id = any(file_ids) and file.deleted_at is null;
  return jsonb_build_object('requestId', p_request_id, 'files', file_rows,
    'removed', jsonb_build_object('files', to_jsonb(file_ids), 'folders', to_jsonb(folder_ids)),
    'completed', false);
end;
$$;
revoke all on function public.begin_account_file_purge(uuid, uuid, uuid, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.begin_account_file_purge(uuid, uuid, uuid, jsonb, boolean) to service_role;

create function public.finalize_account_file_purge(
  p_profile_id uuid, p_auth_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  manifest public.account_file_purge_manifests;
  folder_row public.file_folders;
  folder_rows jsonb := '[]'::jsonb;
  previous_guard text;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  select * into manifest from public.account_file_purge_manifests
    where profile_id = p_profile_id and request_id = p_request_id for update;
  if not found then raise exception 'Purge request not found' using errcode = 'P0002'; end if;
  if exists(select 1 from unnest(manifest.file_ids) file_id
      left join public.user_files file on file.profile_id = p_profile_id and file.id = file_id
      where file.id is null or file.deleted_at is null) then
    raise exception 'File cleanup is still pending for this purge request' using errcode = '40001';
  end if;
  previous_guard := current_setting('app.account_file_purge_write', true);
  perform set_config('app.account_file_purge_write', '1', true);
  for folder_row in
    update public.file_folders set deleted_at = clock_timestamp(), purge_pending_at = null
      where profile_id = p_profile_id and id = any(manifest.folder_ids) and deleted_at is null
      returning *
  loop
    folder_rows := folder_rows || jsonb_build_array(to_jsonb(folder_row));
  end loop;
  update public.account_file_purge_manifests set completed_at = coalesce(completed_at, clock_timestamp())
    where profile_id = p_profile_id and request_id = p_request_id and completed_at is null;
  perform set_config('app.account_file_purge_write', coalesce(previous_guard, ''), true);
  return jsonb_build_object('folders', folder_rows,
    'removed', jsonb_build_object('files', to_jsonb(manifest.file_ids), 'folders', to_jsonb(manifest.folder_ids)));
end;
$$;
revoke all on function public.finalize_account_file_purge(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_account_file_purge(uuid, uuid, uuid) to service_role;

-- Preserve the established move/activity action RPC and route location changes
-- through the recursive operation so service calls cannot bypass its guards.
alter function public.mutate_account_files_action(uuid, uuid, text, jsonb, uuid, boolean)
  rename to mutate_account_files_action_legacy;
revoke all on function public.mutate_account_files_action_legacy(uuid, uuid, text, jsonb, uuid, boolean)
  from public, anon, authenticated, service_role;
create function public.mutate_account_files_action(
  p_profile_id uuid, p_auth_user_id uuid, p_action text, p_items jsonb,
  p_destination_id uuid default null, p_destination_provided boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_action in ('trash', 'restore') then
    return public.mutate_account_file_tree_action(
      p_profile_id, p_auth_user_id, p_action, p_items, p_destination_id, p_destination_provided);
  end if;
  if p_action = 'permanent-delete' then
    raise exception 'Use the request-scoped purge API for permanent deletion' using errcode = '22023';
  end if;
  return public.mutate_account_files_action_legacy(
    p_profile_id, p_auth_user_id, p_action, p_items, p_destination_id, p_destination_provided);
end;
$$;
revoke all on function public.mutate_account_files_action(uuid, uuid, text, jsonb, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.mutate_account_files_action(uuid, uuid, text, jsonb, uuid, boolean) to service_role;

alter function public.mutate_account_file_location(uuid, uuid, uuid, text, bigint, jsonb)
  rename to mutate_account_file_location_legacy;
revoke all on function public.mutate_account_file_location_legacy(uuid, uuid, uuid, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
create function public.mutate_account_file_location(
  p_profile_id uuid, p_auth_user_id uuid, p_file_id uuid, p_operation text,
  p_expected_metadata_revision bigint default null, p_metadata jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; metadata_value jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_operation in ('trash', 'restore') then
    result := public.mutate_account_file_tree_action(
      p_profile_id, p_auth_user_id, p_operation,
      jsonb_build_array(jsonb_build_object('type', 'file', 'id', p_file_id,
        'revision', p_expected_metadata_revision)),
      nullif(metadata_value->>'folderId', '')::uuid, metadata_value ? 'folderId');
    return result->'files'->0;
  end if;
  return public.mutate_account_file_location_legacy(
    p_profile_id, p_auth_user_id, p_file_id, p_operation, p_expected_metadata_revision, metadata_value);
end;
$$;
revoke all on function public.mutate_account_file_location(uuid, uuid, uuid, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_account_file_location(uuid, uuid, uuid, text, bigint, jsonb) to service_role;

alter function public.mutate_account_folder(uuid, uuid, text, uuid, bigint, jsonb)
  rename to mutate_account_folder_legacy;
revoke all on function public.mutate_account_folder_legacy(uuid, uuid, text, uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;
create function public.mutate_account_folder(
  p_profile_id uuid, p_auth_user_id uuid, p_operation text, p_folder_id uuid default null,
  p_expected_revision bigint default null, p_metadata jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; metadata_value jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_operation in ('trash', 'restore') then
    result := public.mutate_account_file_tree_action(
      p_profile_id, p_auth_user_id, p_operation,
      jsonb_build_array(jsonb_build_object('type', 'folder', 'id', p_folder_id,
        'revision', p_expected_revision)),
      nullif(metadata_value->>'parentId', '')::uuid, metadata_value ? 'parentId');
    return result->'folders'->0;
  end if;
  if p_operation <> 'create' and exists(select 1 from public.file_folders folder
      where folder.profile_id = p_profile_id and folder.id = p_folder_id
        and (folder.deleted_at is not null or folder.purge_pending_at is not null)) then
    raise exception 'Folder is being permanently removed' using errcode = '23514';
  end if;
  return public.mutate_account_folder_legacy(
    p_profile_id, p_auth_user_id, p_operation, p_folder_id, p_expected_revision, metadata_value);
end;
$$;
revoke all on function public.mutate_account_folder(uuid, uuid, text, uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.mutate_account_folder(uuid, uuid, text, uuid, bigint, jsonb) to service_role;

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
      from public.file_folders folder_row where folder_row.profile_id = p_profile_id and folder_row.deleted_at is null),
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
        from public.folder_activity activity join public.file_folders folder_row
          on folder_row.profile_id = activity.profile_id and folder_row.id = activity.folder_id
        where activity.profile_id = p_profile_id and folder_row.deleted_at is null)
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
