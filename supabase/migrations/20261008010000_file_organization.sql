-- Additive persistence for file folders, native text documents, and recoverable state.
-- Existing file identities, object paths, associations, and permanent tombstones remain intact.
begin;

create table public.file_folders (
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  parent_id uuid,
  name text not null check (length(btrim(name)) between 1 and 255),
  kind text not null default 'custom' check (kind in ('custom', 'course')),
  course_id text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  semester_label text,
  course_name_snapshot text,
  course_color_snapshot text,
  trashed_at timestamptz,
  trash_operation_id uuid,
  original_parent_id uuid,
  primary key (profile_id, id),
  foreign key (profile_id, parent_id) references public.file_folders(profile_id, id)
    on delete set null (parent_id),
  foreign key (profile_id, original_parent_id) references public.file_folders(profile_id, id)
    on delete set null (original_parent_id),
  foreign key (profile_id, course_id) references public.courses(profile_id, id)
    on delete set null (course_id),
  constraint file_folder_course_kind check (kind <> 'custom' or course_id is null),
  constraint file_folder_archive_metadata check (
    (archived_at is null and semester_label is null and course_name_snapshot is null and course_color_snapshot is null)
    or (archived_at is not null and semester_label is not null and length(btrim(semester_label)) between 1 and 120)
  ),
  constraint file_folder_trash_metadata check (
    (trashed_at is null and trash_operation_id is null and original_parent_id is null)
    or (trashed_at is not null and trash_operation_id is not null and parent_id is null)
  )
);
create index file_folders_profile_parent_idx on public.file_folders(profile_id, parent_id, name);
create unique index file_folders_managed_course_idx on public.file_folders(profile_id, course_id)
  where kind = 'course' and course_id is not null;

alter table public.user_files
  add column folder_id uuid,
  add column content_backend text not null default 'object' check (content_backend in ('object', 'native-text')),
  add column metadata_revision bigint not null default 1 check (metadata_revision > 0),
  add column content_revision bigint not null default 1 check (content_revision > 0),
  add column trashed_at timestamptz,
  add column trash_operation_id uuid,
  add column original_folder_id uuid,
  add constraint user_files_folder_fk foreign key (profile_id, folder_id)
    references public.file_folders(profile_id, id) on delete set null (folder_id),
  add constraint user_files_original_folder_fk foreign key (profile_id, original_folder_id)
    references public.file_folders(profile_id, id) on delete set null (original_folder_id),
  add constraint user_files_trash_metadata check (
    (trashed_at is null and trash_operation_id is null and original_folder_id is null)
    or (trashed_at is not null and trash_operation_id is not null and folder_id is null)
  );
create index user_files_profile_folder_idx on public.user_files(profile_id, folder_id, created_at);

create table public.native_file_documents (
  profile_id uuid not null,
  file_id uuid not null,
  body text not null check (octet_length(convert_to(body, 'UTF8')) <= 1048576),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, file_id),
  foreign key (profile_id, file_id) references public.user_files(profile_id, id) on delete cascade
);

create table public.file_activity (
  profile_id uuid not null,
  file_id uuid not null,
  starred_at timestamptz,
  last_opened_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, file_id),
  foreign key (profile_id, file_id) references public.user_files(profile_id, id) on delete cascade
);
create index file_activity_recent_idx on public.file_activity(profile_id, last_opened_at desc)
  where last_opened_at is not null;
create index file_activity_starred_idx on public.file_activity(profile_id, starred_at desc)
  where starred_at is not null;

create table public.folder_activity (
  profile_id uuid not null,
  folder_id uuid not null,
  starred_at timestamptz,
  last_opened_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, folder_id),
  foreign key (profile_id, folder_id) references public.file_folders(profile_id, id) on delete cascade
);
create index folder_activity_recent_idx on public.folder_activity(profile_id, last_opened_at desc)
  where last_opened_at is not null;
create index folder_activity_starred_idx on public.folder_activity(profile_id, starred_at desc)
  where starred_at is not null;

-- A folder is a valid destination only while it and every ancestor remain active.
create function public.file_folder_location_is_active(p_profile_id uuid, p_folder_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare active boolean;
begin
  if p_folder_id is null then return true; end if;
  with recursive ancestors(id, parent_id, trashed_at, path, cycle) as (
    select f.id, f.parent_id, f.trashed_at, array[f.id], false
    from public.file_folders f where f.profile_id = p_profile_id and f.id = p_folder_id
    union all
    select parent.id, parent.parent_id, parent.trashed_at, a.path || parent.id,
      parent.id = any(a.path)
    from ancestors a
    join public.file_folders parent on parent.profile_id = p_profile_id and parent.id = a.parent_id
    where a.parent_id is not null and not a.cycle
  )
  select coalesce(bool_and(trashed_at is null and not cycle), false) into active from ancestors;
  return active;
end;
$$;
revoke all on function public.file_folder_location_is_active(uuid, uuid) from public, anon, authenticated, service_role;

-- SQL writes are guarded as well as the service RPCs. The service role receives read
-- access for existing APIs, but all mutations go through functions that lock profiles first.
create function public.guard_file_folder_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare profile_key uuid; cycle_found boolean;
begin
  if tg_op = 'DELETE' then
    profile_key := old.profile_id;
  else
    profile_key := new.profile_id;
    if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id then
      raise exception 'Folder ownership cannot change' using errcode = '23503';
    end if;
  end if;
  perform 1 from public.app_profiles where id = profile_key for update;
  if not found and tg_op <> 'DELETE' then
    raise exception 'Account profile not found' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if new.kind = 'custom' and new.course_id is not null then
    raise exception 'Custom folders cannot own a course reference' using errcode = '23514';
  end if;
  if new.kind = 'course' and new.course_id is not null and new.parent_id is not null then
    raise exception 'Managed course folders must stay at the root' using errcode = '23514';
  end if;
  if new.trashed_at is not null and new.parent_id is not null then
    raise exception 'Trashed folders cannot have an active parent' using errcode = '23514';
  end if;
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A folder cannot contain itself' using errcode = '23514'; end if;
    if not exists(select 1 from public.file_folders folder_row
        where folder_row.profile_id = new.profile_id and folder_row.id = new.parent_id) then
      raise exception 'Unknown or foreign folder parent' using errcode = '23503';
    end if;
    if not public.file_folder_location_is_active(new.profile_id, new.parent_id) then
      raise exception 'Folder destination is under a trashed folder' using errcode = '23514';
    end if;
    with recursive ancestors(id, parent_id, path) as (
      select f.id, f.parent_id, array[f.id]
      from public.file_folders f where f.profile_id = new.profile_id and f.id = new.parent_id
      union all
      select parent.id, parent.parent_id, a.path || parent.id
      from ancestors a
      join public.file_folders parent on parent.profile_id = new.profile_id and parent.id = a.parent_id
      where a.parent_id is not null and not parent.id = any(a.path)
    )
    select exists(select 1 from ancestors where id = new.id) into cycle_found;
    if cycle_found then raise exception 'Folder move would create a cycle' using errcode = '23514'; end if;
  end if;
  if new.trashed_at is not null and (tg_op = 'INSERT' or old.trashed_at is null) and (
      exists(select 1 from public.file_folders child where child.profile_id = new.profile_id
        and child.parent_id = new.id)
      or exists(select 1 from public.user_files f where f.profile_id = new.profile_id and f.folder_id = new.id)
    ) then
    raise exception 'A folder must be empty before it can be trashed' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_file_folder_write() from public, anon, authenticated;
create trigger file_folders_00_guard before insert or update or delete on public.file_folders
  for each row execute function public.guard_file_folder_write();

create function public.advance_file_folder_revision()
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
      new.trashed_at, new.trash_operation_id, new.original_parent_id)
    is distinct from row(old.parent_id, old.name, old.kind, old.course_id, old.archived_at,
      old.semester_label, old.course_name_snapshot, old.course_color_snapshot,
      old.trashed_at, old.trash_operation_id, old.original_parent_id);
  new.revision := case when changed then old.revision + 1 else old.revision end;
  new.updated_at := case when changed
    then greatest(clock_timestamp(), old.updated_at + interval '1 millisecond') else old.updated_at end;
  return new;
end;
$$;
revoke all on function public.advance_file_folder_revision() from public, anon, authenticated;
create trigger file_folders_10_revision before insert or update on public.file_folders
  for each row execute function public.advance_file_folder_revision();

create function public.guard_user_file_location()
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
  if tg_op = 'UPDATE' and old.trashed_at is not null and new.trashed_at is not null
      and row(new.name, new.mime_type, new.kind, new.size_bytes,
        new.content_sha256, new.folder_id, new.content_backend, new.state)
        is distinct from row(old.name, old.mime_type, old.kind,
        old.size_bytes, old.content_sha256, old.folder_id, old.content_backend, old.state) then
    raise exception 'Restore a file before changing it' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_user_file_location() from public, anon, authenticated;
create trigger user_files_00_organization_guard before insert or update or delete on public.user_files
  for each row execute function public.guard_user_file_location();

drop trigger if exists user_files_save_revision on public.user_files;
create function public.advance_file_revisions()
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
      new.trashed_at, new.trash_operation_id, new.original_folder_id)
    is distinct from row(old.name, old.mime_type, old.course_id, old.assignment_id, old.kind,
      old.bucket_id, old.object_path, old.folder_id, old.content_backend, old.state, old.deleted_at,
      old.trashed_at, old.trash_operation_id, old.original_folder_id);
  content_changed := row(new.size_bytes, new.content_sha256)
    is distinct from row(old.size_bytes, old.content_sha256);
  new.metadata_revision := case when metadata_changed then old.metadata_revision + 1 else old.metadata_revision end;
  new.content_revision := case when content_changed then old.content_revision + 1 else old.content_revision end;
  new.updated_at := case when metadata_changed or content_changed
    then greatest(clock_timestamp(), old.updated_at + interval '1 millisecond') else old.updated_at end;
  return new;
end;
$$;
revoke all on function public.advance_file_revisions() from public, anon, authenticated;
create trigger user_files_10_revisions before insert or update on public.user_files
  for each row execute function public.advance_file_revisions();

create function public.guard_native_file_document_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare profile_key uuid; file_backend text; file_state text; file_deleted_at timestamptz; file_trashed_at timestamptz;
begin
  if tg_op = 'DELETE' then
    profile_key := old.profile_id;
  else
    profile_key := new.profile_id;
    if tg_op = 'UPDATE' and row(new.profile_id, new.file_id) is distinct from row(old.profile_id, old.file_id) then
      raise exception 'Document identity cannot change' using errcode = '23503';
    end if;
  end if;
  perform 1 from public.app_profiles where id = profile_key for update;
  if not found and tg_op <> 'DELETE' then
    raise exception 'Account profile not found' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select f.content_backend, f.state, f.deleted_at, f.trashed_at
    into file_backend, file_state, file_deleted_at, file_trashed_at
    from public.user_files f where f.profile_id = new.profile_id and f.id = new.file_id;
  if not found then raise exception 'File not found' using errcode = '23503'; end if;
  if file_backend <> 'native-text' or file_state <> 'ready' or file_deleted_at is not null or file_trashed_at is not null then
    raise exception 'Native document must be attached to an active text file' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := case when new.body is distinct from old.body
      then greatest(clock_timestamp(), old.updated_at + interval '1 millisecond') else old.updated_at end;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_native_file_document_write() from public, anon, authenticated;
create trigger native_file_documents_00_guard before insert or update or delete on public.native_file_documents
  for each row execute function public.guard_native_file_document_write();

create function public.sync_native_file_metadata_from_document()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_content text; v_owner uuid; v_file_id uuid; v_digest text;
begin
  if tg_op = 'DELETE' then return old; end if;
  v_content := new.body;
  v_owner := new.profile_id;
  v_file_id := new.file_id;
  v_digest := encode(sha256(convert_to(v_content, 'UTF8')), 'hex');
  update public.user_files file_row set size_bytes = octet_length(convert_to(v_content, 'UTF8')),
      content_sha256 = v_digest
    where file_row.profile_id = v_owner and file_row.id = v_file_id and file_row.content_backend = 'native-text'
      and (file_row.size_bytes is distinct from octet_length(convert_to(v_content, 'UTF8'))
        or file_row.content_sha256 is distinct from v_digest);
  return new;
end;
$$;
revoke all on function public.sync_native_file_metadata_from_document() from public, anon, authenticated;
create trigger native_file_documents_10_sync_metadata after insert or update of body on public.native_file_documents
  for each row execute function public.sync_native_file_metadata_from_document();

create function public.enforce_native_file_document_pair()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_file_id uuid; backend text; document_exists boolean;
begin
  if tg_table_name = 'user_files' then
    if tg_op = 'DELETE' then v_owner := old.profile_id; v_file_id := old.id;
    else v_owner := new.profile_id; v_file_id := new.id; end if;
    select f.content_backend into backend from public.user_files f where f.profile_id = v_owner and f.id = v_file_id;
    if not found then return null; end if;
  else
    if tg_op = 'DELETE' then v_owner := old.profile_id; v_file_id := old.file_id;
    else v_owner := new.profile_id; v_file_id := new.file_id; end if;
    select f.content_backend into backend from public.user_files f where f.profile_id = v_owner and f.id = v_file_id;
    if not found then return null; end if;
  end if;
  select exists(select 1 from public.native_file_documents d where d.profile_id = v_owner and d.file_id = v_file_id)
    into document_exists;
  if (backend = 'native-text' and not document_exists) or (backend = 'object' and document_exists) then
    raise exception 'Native document and file backend do not match' using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function public.enforce_native_file_document_pair() from public, anon, authenticated;
create constraint trigger user_files_native_document_pair
  after insert or update or delete on public.user_files deferrable initially deferred
  for each row execute function public.enforce_native_file_document_pair();
create constraint trigger native_file_documents_pair
  after insert or update or delete on public.native_file_documents deferrable initially deferred
  for each row execute function public.enforce_native_file_document_pair();

-- Native text is indexed by the later content reader/AI batch. The current object
-- ingestion trigger must not publish a placeholder source for native metadata rows.
do $$
begin
  if to_regprocedure('public.ai_sync_file()') is not null then
    execute 'drop trigger if exists ai_file_jobs on public.user_files';
    execute 'create trigger ai_file_jobs after insert or update on public.user_files for each row when (new.content_backend = ''object'') execute function public.ai_sync_file()';
  else
    -- The private-files migration is also exercised without the optional AI migration.
    execute 'drop trigger if exists ai_file_jobs on public.user_files';
  end if;
end;
$$;

-- Activity mutations live here so opens and stars never touch file/folder revisions or updated_at.
create function public.mutate_account_folder(
  p_profile_id uuid, p_auth_user_id uuid, p_operation text, p_folder_id uuid default null,
  p_expected_revision bigint default null, p_metadata jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.file_folders; activity public.folder_activity; parent_key uuid; course_key text;
  course_name text; course_color text; folder_key uuid; operation_key uuid; item_name text; item_kind text;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  if p_operation is null or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid folder operation' using errcode = '22023';
  end if;

  if p_operation = 'create' then
    folder_key := coalesce(p_folder_id, gen_random_uuid());
    item_name := nullif(btrim(p_metadata->>'name'), '');
    item_kind := coalesce(p_metadata->>'kind', 'custom');
    parent_key := nullif(p_metadata->>'parentId', '')::uuid;
    course_key := nullif(p_metadata->>'courseId', '');
    if item_name is null or length(item_name) > 255 or item_kind not in ('custom', 'course') then
      raise exception 'Invalid folder name or kind' using errcode = '22023';
    end if;
    if (item_kind = 'custom' and course_key is not null)
        or (item_kind = 'course' and (course_key is null or parent_key is not null)) then
      raise exception 'Invalid folder kind or course placement' using errcode = '23514';
    end if;
    if parent_key is not null and not exists(select 1 from public.file_folders folder_row
        where folder_row.profile_id = p_profile_id and folder_row.id = parent_key) then
      raise exception 'Unknown or foreign folder parent' using errcode = '23503';
    end if;
    if parent_key is not null and not public.file_folder_location_is_active(p_profile_id, parent_key) then
      raise exception 'Folder destination is under a trashed folder' using errcode = '23514';
    end if;
    if course_key is not null and not exists(select 1 from public.courses c where c.profile_id = p_profile_id and c.id = course_key) then
      raise exception 'Unknown course' using errcode = '23503';
    end if;
    select * into f from public.file_folders where profile_id = p_profile_id and id = folder_key for update;
    if found then
      if f.name = item_name and f.kind = item_kind and f.parent_id is not distinct from parent_key
          and f.course_id is not distinct from course_key and f.trashed_at is null then
        return to_jsonb(f);
      end if;
      raise exception 'Folder ID already used' using errcode = '23505';
    end if;
    insert into public.file_folders(profile_id, id, parent_id, name, kind, course_id)
      values(p_profile_id, folder_key, parent_key, item_name, item_kind, course_key) returning * into f;
    return to_jsonb(f);
  end if;

  if p_folder_id is null then raise exception 'Folder ID is required' using errcode = '22023'; end if;
  select * into f from public.file_folders where profile_id = p_profile_id and id = p_folder_id for update;
  if not found then raise exception 'Folder not found' using errcode = 'P0002'; end if;

  if p_operation in ('star', 'unstar', 'open') then
    if p_operation = 'open' and f.trashed_at is not null then
      raise exception 'Trashed folders cannot be opened' using errcode = '23514';
    end if;
    insert into public.folder_activity(profile_id, folder_id, starred_at, last_opened_at)
      values(p_profile_id, p_folder_id,
        case when p_operation = 'star' then clock_timestamp() end,
        case when p_operation = 'open' then clock_timestamp() end)
      on conflict(profile_id, folder_id) do update set
        starred_at = case when p_operation = 'star' then clock_timestamp()
          when p_operation = 'unstar' then null else public.folder_activity.starred_at end,
        last_opened_at = case when p_operation = 'open' then clock_timestamp()
          else public.folder_activity.last_opened_at end,
        updated_at = clock_timestamp()
      returning * into activity;
    return to_jsonb(activity);
  end if;

  if p_expected_revision is null or f.revision <> p_expected_revision then
    raise exception 'Folder changed; reload before editing' using errcode = '40001';
  end if;
  if p_operation = 'rename' then
    item_name := nullif(btrim(p_metadata->>'name'), '');
    if item_name is null or length(item_name) > 255 then raise exception 'Invalid folder name' using errcode = '22023'; end if;
    if f.kind = 'course' and f.course_id is not null then raise exception 'Managed course folders follow their course name' using errcode = '23514'; end if;
    update public.file_folders set name = item_name where profile_id = p_profile_id and id = p_folder_id returning * into f;
  elsif p_operation = 'move' then
    if f.trashed_at is not null then raise exception 'Restore a folder before moving it' using errcode = '23514'; end if;
    if f.kind = 'course' and f.course_id is not null then raise exception 'Managed course folders stay at the root' using errcode = '23514'; end if;
    parent_key := nullif(p_metadata->>'parentId', '')::uuid;
    if parent_key is not null and not exists(select 1 from public.file_folders folder_row
        where folder_row.profile_id = p_profile_id and folder_row.id = parent_key) then
      raise exception 'Unknown or foreign folder parent' using errcode = '23503';
    end if;
    if parent_key is not null and not public.file_folder_location_is_active(p_profile_id, parent_key) then
      raise exception 'Folder destination is under a trashed folder' using errcode = '23514';
    end if;
    update public.file_folders set parent_id = parent_key where profile_id = p_profile_id and id = p_folder_id returning * into f;
  elsif p_operation = 'archive' then
    if f.parent_id is not null then raise exception 'Only root folders can be archived' using errcode = '23514'; end if;
    item_name := nullif(btrim(p_metadata->>'semesterLabel'), '');
    if item_name is null or length(item_name) > 120 then raise exception 'Invalid archive label' using errcode = '22023'; end if;
    if f.course_id is not null then
      select c.name, c.color into course_name, course_color from public.courses c
        where c.profile_id = p_profile_id and c.id = f.course_id;
    end if;
    update public.file_folders set archived_at = clock_timestamp(), semester_label = item_name,
        course_name_snapshot = case when f.kind = 'course' then coalesce(course_name, f.name)
          else nullif(p_metadata->>'courseNameSnapshot', '') end,
        course_color_snapshot = case when f.kind = 'course' then course_color
          else nullif(p_metadata->>'courseColorSnapshot', '') end
      where profile_id = p_profile_id and id = p_folder_id returning * into f;
  elsif p_operation = 'unarchive' then
    if f.archived_at is null then raise exception 'Folder is not archived' using errcode = '22023'; end if;
    update public.file_folders set archived_at = null, semester_label = null,
        course_name_snapshot = null, course_color_snapshot = null
      where profile_id = p_profile_id and id = p_folder_id returning * into f;
  elsif p_operation = 'trash' then
    if f.kind = 'course' and f.course_id is not null then raise exception 'Managed course folders cannot be trashed' using errcode = '23514'; end if;
    if f.trashed_at is not null then raise exception 'Folder is already trashed' using errcode = '22023'; end if;
    if exists(select 1 from public.file_folders child where child.profile_id = p_profile_id and child.parent_id = p_folder_id)
        or exists(select 1 from public.user_files file where file.profile_id = p_profile_id and file.folder_id = p_folder_id) then
      raise exception 'A folder must be empty before it can be trashed' using errcode = '23514';
    end if;
    operation_key := coalesce(nullif(p_metadata->>'operationId', '')::uuid, gen_random_uuid());
    update public.file_folders set original_parent_id = parent_id, parent_id = null,
        trashed_at = clock_timestamp(), trash_operation_id = operation_key
      where profile_id = p_profile_id and id = p_folder_id returning * into f;
  elsif p_operation = 'restore' then
    if f.trashed_at is null then raise exception 'Folder is not in Trash' using errcode = '22023'; end if;
    if p_metadata ? 'parentId' then parent_key := nullif(p_metadata->>'parentId', '')::uuid;
    elsif public.file_folder_location_is_active(p_profile_id, f.original_parent_id) then parent_key := f.original_parent_id;
    else parent_key := null; end if;
    if parent_key is not null and not exists(select 1 from public.file_folders folder_row
        where folder_row.profile_id = p_profile_id and folder_row.id = parent_key) then
      raise exception 'Unknown or foreign folder parent' using errcode = '23503';
    end if;
    if parent_key is not null and not public.file_folder_location_is_active(p_profile_id, parent_key) then
      raise exception 'Folder destination is under a trashed folder' using errcode = '23514';
    end if;
    update public.file_folders set parent_id = parent_key, original_parent_id = null,
        trashed_at = null, trash_operation_id = null
      where profile_id = p_profile_id and id = p_folder_id returning * into f;
  else
    raise exception 'Invalid folder operation' using errcode = '22023';
  end if;
  return to_jsonb(f);
end;
$$;
revoke all on function public.mutate_account_folder(uuid, uuid, text, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.mutate_account_folder(uuid, uuid, text, uuid, bigint, jsonb) to service_role;

create function public.mutate_account_document(
  p_profile_id uuid, p_auth_user_id uuid, p_file_id uuid, p_operation text,
  p_expected_content_revision bigint default null, p_document jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.user_files; d public.native_file_documents; content text; digest text; file_name text;
  file_kind text; course_key text; assignment_key text; folder_key uuid; existed boolean;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  if p_file_id is null or p_operation is null or p_operation not in ('create', 'update_content')
      or jsonb_typeof(coalesce(p_document, '{}'::jsonb)) <> 'object'
      or not (coalesce(p_document, '{}'::jsonb) ? 'body')
      or jsonb_typeof(p_document->'body') <> 'string' then
    raise exception 'Invalid native document request' using errcode = '22023';
  end if;
  content := p_document->>'body';
  if octet_length(convert_to(content, 'UTF8')) > 1048576 then
    raise exception 'Text documents are limited to 1 MiB of UTF-8 content' using errcode = '22023';
  end if;
  digest := encode(sha256(convert_to(content, 'UTF8')), 'hex');

  if p_operation = 'create' then
    file_name := nullif(btrim(p_document->>'name'), '');
    file_kind := coalesce(p_document->>'kind', 'resource');
    course_key := nullif(p_document->>'courseId', '');
    assignment_key := nullif(p_document->>'assignmentId', '');
    folder_key := nullif(p_document->>'folderId', '')::uuid;
    if file_name is null or length(file_name) > 255 or file_kind not in ('resource', 'syllabus', 'attachment') then
      raise exception 'Invalid native document name or kind' using errcode = '22023';
    end if;
    if folder_key is not null and not exists(select 1 from public.file_folders folder_row
        where folder_row.profile_id = p_profile_id and folder_row.id = folder_key) then
      raise exception 'Unknown or foreign document folder' using errcode = '23503';
    end if;
    if folder_key is not null and not public.file_folder_location_is_active(p_profile_id, folder_key) then
      raise exception 'Document folder is under a trashed folder' using errcode = '23514';
    end if;
    if course_key is not null and not exists(select 1 from public.courses c where c.profile_id = p_profile_id and c.id = course_key) then
      raise exception 'Unknown course' using errcode = '23503';
    end if;
    if assignment_key is not null and not exists(select 1 from jsonb_array_elements(
        coalesce((select payload->'d'->'assignments' from public.dashboard_state where profile_id = p_profile_id), '[]'::jsonb)) item
        where item->>'id' = assignment_key and item->>'courseId' = coalesce(course_key, '')) then
      raise exception 'Unknown assignment' using errcode = '23503';
    end if;
    select * into f from public.user_files where profile_id = p_profile_id and id = p_file_id for update;
    existed := found;
    if existed then
      select * into d from public.native_file_documents where profile_id = p_profile_id and file_id = p_file_id;
      if f.content_backend = 'native-text' and f.state = 'ready' and f.deleted_at is null and f.trashed_at is null
          and f.name = file_name and f.kind = file_kind and f.course_id is not distinct from course_key
          and f.assignment_id is not distinct from assignment_key and f.folder_id is not distinct from folder_key
          and found and d.body = content then
        return jsonb_build_object('file', to_jsonb(f), 'document', to_jsonb(d));
      end if;
      raise exception 'File ID already used with different document data' using errcode = '23505';
    end if;
    if (select count(*) from public.user_files file_row where file_row.profile_id = p_profile_id and file_row.deleted_at is null) >= 1000 then
      raise exception 'Keep at most 1000 files' using errcode = '22023';
    end if;
    insert into public.user_files(profile_id, id, course_id, assignment_id, kind, name, mime_type,
        size_bytes, object_path, content_sha256, content_backend, state, folder_id)
      values(p_profile_id, p_file_id, course_key, assignment_key, file_kind, file_name, 'text/plain',
        octet_length(convert_to(content, 'UTF8')), p_profile_id::text || '/' || p_file_id::text,
        digest, 'native-text', 'ready', folder_key) returning * into f;
    insert into public.native_file_documents(profile_id, file_id, body)
      values(p_profile_id, p_file_id, content) returning * into d;
    return jsonb_build_object('file', to_jsonb(f), 'document', to_jsonb(d));
  end if;

  select * into f from public.user_files where profile_id = p_profile_id and id = p_file_id for update;
  if not found then raise exception 'File not found' using errcode = 'P0002'; end if;
  if f.content_backend <> 'native-text' or f.state <> 'ready' or f.deleted_at is not null or f.trashed_at is not null then
    raise exception 'File is not an active native text document' using errcode = '23514';
  end if;
  select * into d from public.native_file_documents where profile_id = p_profile_id and file_id = p_file_id for update;
  if not found then raise exception 'Native document body is missing' using errcode = '23514'; end if;
  if p_expected_content_revision is null or f.content_revision <> p_expected_content_revision then
    raise exception 'Document content changed; reload before saving' using errcode = '40001';
  end if;
  update public.native_file_documents set body = content
    where profile_id = p_profile_id and file_id = p_file_id returning * into d;
  select * into f from public.user_files where profile_id = p_profile_id and id = p_file_id;
  return jsonb_build_object('file', to_jsonb(f), 'document', to_jsonb(d));
end;
$$;
revoke all on function public.mutate_account_document(uuid, uuid, uuid, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.mutate_account_document(uuid, uuid, uuid, text, bigint, jsonb) to service_role;

create function public.mutate_account_file_location(
  p_profile_id uuid, p_auth_user_id uuid, p_file_id uuid, p_operation text,
  p_expected_metadata_revision bigint default null, p_metadata jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.user_files; activity public.file_activity; folder_key uuid; operation_key uuid;
  dashboard jsonb;
begin
  perform 1 from public.app_profiles where id = p_profile_id and auth_user_id = p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;
  if p_operation is null or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid file location operation' using errcode = '22023';
  end if;
  if p_file_id is null then raise exception 'File ID is required' using errcode = '22023'; end if;
  select * into f from public.user_files where profile_id = p_profile_id and id = p_file_id for update;
  if not found then raise exception 'File not found' using errcode = 'P0002'; end if;

  if p_operation in ('star', 'unstar', 'open') then
    if f.deleted_at is not null or (p_operation = 'open' and (f.trashed_at is not null or f.state <> 'ready')) then
      raise exception 'File is unavailable for this activity' using errcode = '23514';
    end if;
    insert into public.file_activity(profile_id, file_id, starred_at, last_opened_at)
      values(p_profile_id, p_file_id,
        case when p_operation = 'star' then clock_timestamp() end,
        case when p_operation = 'open' then clock_timestamp() end)
      on conflict(profile_id, file_id) do update set
        starred_at = case when p_operation = 'star' then clock_timestamp()
          when p_operation = 'unstar' then null else public.file_activity.starred_at end,
        last_opened_at = case when p_operation = 'open' then clock_timestamp()
          else public.file_activity.last_opened_at end,
        updated_at = clock_timestamp()
      returning * into activity;
    return to_jsonb(activity);
  end if;

  if f.state <> 'ready' or f.deleted_at is not null then
    raise exception 'File is unavailable for location changes' using errcode = '23514';
  end if;
  if p_expected_metadata_revision is null or f.metadata_revision <> p_expected_metadata_revision then
    raise exception 'File changed; reload before editing location' using errcode = '40001';
  end if;
  if p_operation = 'move' then
    if f.trashed_at is not null then raise exception 'Restore a file before moving it' using errcode = '23514'; end if;
    folder_key := nullif(p_metadata->>'folderId', '')::uuid;
    if folder_key is not null and not exists(select 1 from public.file_folders folder_row
        where folder_row.profile_id = p_profile_id and folder_row.id = folder_key) then
      raise exception 'Unknown or foreign file folder' using errcode = '23503';
    end if;
    if folder_key is not null and not public.file_folder_location_is_active(p_profile_id, folder_key) then
      raise exception 'File destination is under a trashed folder' using errcode = '23514';
    end if;
    update public.user_files set folder_id = folder_key
      where profile_id = p_profile_id and id = p_file_id returning * into f;
  elsif p_operation = 'trash' then
    if f.trashed_at is not null then raise exception 'File is already in Trash' using errcode = '22023'; end if;
    select payload into dashboard from public.dashboard_state where profile_id = p_profile_id;
    if exists (
      select 1 from (
        select value->>'syllabusFileId' as id from jsonb_each(coalesce(dashboard->'d'->'courseDetails', '{}'::jsonb))
        union all
        select value->>'sourceFileId' from jsonb_array_elements(coalesce(dashboard->'d'->'syllabusDrafts', '[]'::jsonb)) value
      ) refs where refs.id = p_file_id::text
    ) then
      raise exception 'Detach the syllabus source in its class or review before moving it to Trash' using errcode = '23503';
    end if;
    operation_key := coalesce(nullif(p_metadata->>'operationId', '')::uuid, gen_random_uuid());
    update public.user_files set original_folder_id = folder_id, folder_id = null,
        trashed_at = clock_timestamp(), trash_operation_id = operation_key
      where profile_id = p_profile_id and id = p_file_id returning * into f;
  elsif p_operation = 'restore' then
    if f.trashed_at is null then raise exception 'File is not in Trash' using errcode = '22023'; end if;
    if p_metadata ? 'folderId' then folder_key := nullif(p_metadata->>'folderId', '')::uuid;
    elsif public.file_folder_location_is_active(p_profile_id, f.original_folder_id) then folder_key := f.original_folder_id;
    else folder_key := null; end if;
    if folder_key is not null and not exists(select 1 from public.file_folders folder_row
        where folder_row.profile_id = p_profile_id and folder_row.id = folder_key) then
      raise exception 'Unknown or foreign file folder' using errcode = '23503';
    end if;
    if folder_key is not null and not public.file_folder_location_is_active(p_profile_id, folder_key) then
      raise exception 'File destination is under a trashed folder' using errcode = '23514';
    end if;
    update public.user_files set folder_id = folder_key, original_folder_id = null,
        trashed_at = null, trash_operation_id = null
      where profile_id = p_profile_id and id = p_file_id returning * into f;
  else
    raise exception 'Invalid file location operation' using errcode = '22023';
  end if;
  return to_jsonb(f);
end;
$$;
revoke all on function public.mutate_account_file_location(uuid, uuid, uuid, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.mutate_account_file_location(uuid, uuid, uuid, text, bigint, jsonb) to service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array['file_folders', 'native_file_documents', 'file_activity', 'folder_activity'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from service_role', table_name);
    execute format('grant select on public.%I to service_role', table_name);
  end loop;
end;
$$;
-- Existing file APIs still read metadata directly. All writes use the account-locking RPCs.
revoke insert, update, delete, truncate, references, trigger on public.user_files from service_role;
grant select on public.user_files to service_role;

notify pgrst, 'reload schema';
commit;
