begin;
alter table public.user_files add column content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
alter table public.user_files add column deleted_at timestamptz;
alter table public.user_files drop constraint file_assignment_needs_course;

create or replace function public.detach_file_assignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.course_id is not null and new.course_id is null
      and new.assignment_id is not distinct from old.assignment_id then new.assignment_id := null; end if;
  return new;
end;
$$;

-- Every metadata mutation takes the same account lock as workspace saves.
create function public.mutate_account_file(
  p_profile_id uuid, p_auth_user_id uuid, p_file_id uuid, p_operation text,
  p_expected_revision timestamptz default null, p_metadata jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.user_files; c text; a text; doc jsonb;
begin
  perform 1 from public.app_profiles where id=p_profile_id and auth_user_id=p_auth_user_id
    and initialized and onboarding_completed_at is not null for update;
  if not found then raise exception 'Account not ready' using errcode='42501'; end if;
  select * into f from public.user_files where profile_id=p_profile_id and id=p_file_id for update;
  if p_operation='reserve' then
    if found then
      if f.deleted_at is not null or f.state='deleting' or f.content_sha256 is distinct from p_metadata->>'sha256'
         or f.size_bytes is distinct from (p_metadata->>'size')::bigint then
        raise exception 'Upload ID already used or deleted' using errcode='40001';
      end if;
      return to_jsonb(f);
    end if;
    if (select count(*) from public.user_files where profile_id=p_profile_id and deleted_at is null)>=1000 then
      raise exception 'Keep at most 1000 files' using errcode='22023'; end if;
    if coalesce(p_metadata->>'sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid digest' using errcode='22023'; end if;
  elsif not found then raise exception 'File not found' using errcode='P0002';
  end if;
  select payload into doc from public.dashboard_state where profile_id=p_profile_id;
  if p_operation in ('deleting','edit') and exists (
    select 1 from (
      select v->>'syllabusFileId' as id from jsonb_each(coalesce(doc->'d'->'courseDetails','{}')) e(k,v)
      union all select v->>'sourceFileId' from jsonb_array_elements(coalesce(doc->'d'->'syllabusDrafts','[]')) v
    ) refs where refs.id=p_file_id::text
  ) and (p_operation='deleting' or p_metadata->>'kind'<>'syllabus' or nullif(p_metadata->>'courseId','') is distinct from f.course_id) then
    raise exception 'Detach the syllabus source in its class or review before deleting or reassigning this file' using errcode='23503';
  end if;
  if p_operation in ('reserve','edit') then
    c:=nullif(p_metadata->>'courseId',''); a:=nullif(p_metadata->>'assignmentId','');
    if c is not null and not exists(select 1 from public.courses where profile_id=p_profile_id and id=c) then raise exception 'Unknown class' using errcode='23503'; end if;
    select payload into doc from public.dashboard_state where profile_id=p_profile_id;
    if a is not null and not exists(select 1 from jsonb_array_elements(coalesce(doc->'d'->'assignments','[]')) item
        where item->>'id'=a and item->>'courseId'=coalesce(c,'')) then raise exception 'Unknown assignment' using errcode='23503'; end if;
    if p_operation='reserve' then
      insert into public.user_files(profile_id,id,course_id,assignment_id,kind,name,mime_type,size_bytes,object_path,content_sha256)
      values(p_profile_id,p_file_id,c,a,p_metadata->>'kind',p_metadata->>'name',p_metadata->>'mime',
        (p_metadata->>'size')::bigint,p_profile_id::text||'/'||p_file_id::text,p_metadata->>'sha256') returning * into f;
    else
      if f.updated_at is distinct from p_expected_revision or f.state<>'ready' or f.deleted_at is not null then raise exception 'File changed; reload before editing' using errcode='40001'; end if;
      update public.user_files set name=p_metadata->>'name',course_id=c,assignment_id=a,kind=p_metadata->>'kind'
        where profile_id=p_profile_id and id=p_file_id returning * into f;
    end if;
  elsif p_operation='ready' then
    if f.state='deleting' or f.deleted_at is not null then raise exception 'File was deleted' using errcode='40001'; end if;
    if f.state='pending' then update public.user_files set state='ready' where profile_id=p_profile_id and id=p_file_id returning * into f; end if;
  elsif p_operation='deleting' then
    if f.state<>'deleting' then
      if f.updated_at is distinct from p_expected_revision then raise exception 'File changed; reload before deleting' using errcode='40001'; end if;
      update public.user_files set state='deleting' where profile_id=p_profile_id and id=p_file_id returning * into f;
    end if;
  elsif p_operation='removed' then
    if f.state<>'deleting' then raise exception 'Delete was not started' using errcode='40001'; end if;
    if f.deleted_at is null then update public.user_files set deleted_at=now() where profile_id=p_profile_id and id=p_file_id returning * into f; end if;
  else raise exception 'Invalid file operation' using errcode='22023';
  end if;
  return to_jsonb(f);
end;
$$;
revoke all on function public.mutate_account_file(uuid,uuid,uuid,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_account_file(uuid,uuid,uuid,text,timestamptz,jsonb) to service_role;

create function public.export_account(p_profile_id uuid,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform 1 from public.app_profiles where id=p_profile_id and auth_user_id=p_auth_user_id and initialized for update;
  if not found then raise exception 'Account not ready' using errcode='42501'; end if;
  select jsonb_build_object('profile',(select to_jsonb(p) from public.app_profiles p where p.id=p_profile_id),
    'courses',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.courses c where c.profile_id=p_profile_id),
    'workspace',(select jsonb_build_object('dashboard',payload,'revision',updated_at) from public.dashboard_state where profile_id=p_profile_id),
    'files',(select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') from public.user_files f where f.profile_id=p_profile_id and f.deleted_at is null)) into result;
  return result;
end;
$$;
revoke all on function public.export_account(uuid,uuid) from public,anon,authenticated;
grant execute on function public.export_account(uuid,uuid) to service_role;

-- The updated workspace function is appended below before the transaction commits.

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
  if exists (select 1 from (
      select v->>'syllabusFileId' as id from jsonb_each(coalesce(p_dashboard->'d'->'courseDetails','{}')) e(k,v)
      union all select v->>'sourceFileId' from jsonb_array_elements(coalesce(p_dashboard->'d'->'syllabusDrafts','[]')) v
    ) refs where refs.id is not null and not exists (select 1 from public.user_files f where f.profile_id=p_profile_id
      and f.id::text=refs.id and f.state='ready' and f.deleted_at is null and f.kind='syllabus')) then
    raise exception 'Unknown syllabus file' using errcode='23503';
  end if;
  if (select count(v->>'syllabusFileId')<>count(distinct v->>'syllabusFileId') from jsonb_each(coalesce(p_dashboard->'d'->'courseDetails','{}')) e(k,v)) then
    raise exception 'Use a separate syllabus file for each class' using errcode='23514';
  end if;
  insert into public.courses(profile_id, id, code, name, credits, instructor, room, color, soft_color, initials)
    select p_profile_id, c.id, c.code, c.name, c.credits, c.instructor, c.room, c.color, c.soft_color, c.initials
    from jsonb_to_recordset(p_courses) as c(id text, code text, name text, credits smallint, instructor text, room text, color text, soft_color text, initials text)
    on conflict (profile_id, id) do update set code = excluded.code, name = excluded.name,
      credits = excluded.credits, instructor = excluded.instructor, room = excluded.room,
      color = excluded.color, soft_color = excluded.soft_color, initials = excluded.initials;
  update public.user_files f set course_id=e.k,assignment_id=null
    from jsonb_each(coalesce(p_dashboard->'d'->'courseDetails','{}')) e(k,v)
    where f.profile_id=p_profile_id and f.id::text=e.v->>'syllabusFileId' and f.course_id is distinct from e.k;
  -- Keep files accessible as personal resources when their class/item is removed.
  update public.user_files f set assignment_id = null
    where f.profile_id = p_profile_id and f.assignment_id is not null
    and not exists (select 1 from jsonb_array_elements(coalesce(p_dashboard->'d'->'assignments', '[]')) a
      where a->>'id' = f.assignment_id and a->>'courseId' = coalesce(f.course_id, ''));
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
