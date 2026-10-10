-- Avoid touching unchanged courses and resolve syllabus references through the
-- user_files primary key while rejecting noncanonical UUIDs as ordinary
-- unknown file references.
begin;

create or replace function public.save_account_workspace(
  p_profile_id uuid, p_auth_user_id uuid, p_expected_revision timestamptz,
  p_courses jsonb, p_dashboard jsonb
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  current_revision timestamptz;
  saved_revision timestamptz;
begin
  perform 1 from public.app_profiles as profile_row
    where profile_row.id = p_profile_id
      and profile_row.auth_user_id = p_auth_user_id
      and profile_row.initialized
      and profile_row.onboarding_completed_at is not null
    for update;
  if not found then
    raise exception 'Account profile not ready' using errcode = '42501';
  end if;

  select dashboard_row.updated_at into current_revision
    from public.dashboard_state as dashboard_row
    where dashboard_row.profile_id = p_profile_id
    for update;
  if not found or p_expected_revision is null or current_revision <> p_expected_revision then
    raise exception 'Workspace changed in another session' using errcode = 'PT409';
  end if;

  if p_courses is null or jsonb_typeof(p_courses) <> 'array' then
    raise exception 'Invalid courses' using errcode = '22023';
  end if;
  if jsonb_array_length(p_courses) > 100 or p_dashboard is null
      or jsonb_typeof(p_dashboard) <> 'object' or octet_length(p_dashboard::text) > 1048576 then
    raise exception 'Invalid workspace' using errcode = '22023';
  end if;
  if exists (
      select 1 from jsonb_array_elements(p_courses) as course_item
      where jsonb_typeof(course_item) <> 'object' or coalesce(course_item->>'id', '') = '')
      or (select count(*) from jsonb_array_elements(p_courses)) <>
         (select count(distinct course_item->>'id') from jsonb_array_elements(p_courses) as course_item) then
    raise exception 'Invalid or duplicate course IDs' using errcode = '22023';
  end if;

  -- Personal items use an empty courseId. Every nonempty reference must belong
  -- to the same account snapshot; another user's course cannot satisfy this.
  if exists (
      select 1 from (
        select jsonb_array_elements(coalesce(p_dashboard->'d'->'assignments', '[]'::jsonb)) as item
        union all
        select jsonb_array_elements(coalesce(p_dashboard->'d'->'manualEvents', '[]'::jsonb)) as item
      ) as items
      where coalesce(items.item->>'courseId', '') <> ''
        and not exists (
          select 1 from jsonb_array_elements(p_courses) as course_item
          where course_item->>'id' = items.item->>'courseId'
        )
    ) then
    raise exception 'Unknown course reference' using errcode = '23503';
  end if;

  -- Check canonical lowercase UUID shape before any text-to-uuid cast. This
  -- preserves the RPC's 23503 response for malformed IDs as well as missing,
  -- unready, deleted, or foreign-account files.
  if exists (
      select 1 from (
        select detail.value->>'syllabusFileId' as id
          from jsonb_each(coalesce(p_dashboard->'d'->'courseDetails', '{}'::jsonb)) as detail(key, value)
        union all
        select draft.value->>'sourceFileId'
          from jsonb_array_elements(coalesce(p_dashboard->'d'->'syllabusDrafts', '[]'::jsonb)) as draft(value)
      ) as refs
      where refs.id is not null
        and refs.id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
    raise exception 'Unknown syllabus file' using errcode = '23503';
  end if;

  if exists (
      select 1 from (
        select detail.value->>'syllabusFileId' as id
          from jsonb_each(coalesce(p_dashboard->'d'->'courseDetails', '{}'::jsonb)) as detail(key, value)
        union all
        select draft.value->>'sourceFileId'
          from jsonb_array_elements(coalesce(p_dashboard->'d'->'syllabusDrafts', '[]'::jsonb)) as draft(value)
      ) as refs
      where refs.id is not null
        and refs.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and not exists (
          select 1 from public.user_files as file_row
          where file_row.profile_id = p_profile_id
            and file_row.id = refs.id::uuid
            and file_row.state = 'ready'
            and file_row.deleted_at is null
            and file_row.kind = 'syllabus'
        )
    ) then
    raise exception 'Unknown syllabus file' using errcode = '23503';
  end if;

  if (select count(detail.value->>'syllabusFileId') <>
        count(distinct (detail.value->>'syllabusFileId')::uuid)
      from jsonb_each(coalesce(p_dashboard->'d'->'courseDetails', '{}'::jsonb)) as detail(key, value)) then
    raise exception 'Use a separate syllabus file for each class' using errcode = '23514';
  end if;

  insert into public.courses(profile_id, id, code, name, credits, instructor, room, color, soft_color, initials)
    select p_profile_id, course_row.id, course_row.code, course_row.name, course_row.credits,
      course_row.instructor, course_row.room, course_row.color, course_row.soft_color, course_row.initials
    from jsonb_to_recordset(p_courses) as course_row(
      id text, code text, name text, credits smallint, instructor text, room text,
      color text, soft_color text, initials text
    )
    on conflict (profile_id, id) do update set
      code = excluded.code,
      name = excluded.name,
      credits = excluded.credits,
      instructor = excluded.instructor,
      room = excluded.room,
      color = excluded.color,
      soft_color = excluded.soft_color,
      initials = excluded.initials
    where row(courses.code, courses.name, courses.credits, courses.instructor, courses.room,
        courses.color, courses.soft_color, courses.initials)
      is distinct from row(excluded.code, excluded.name, excluded.credits, excluded.instructor,
        excluded.room, excluded.color, excluded.soft_color, excluded.initials);

  update public.user_files as file_row
    set course_id = detail.key, assignment_id = null
    from jsonb_each(coalesce(p_dashboard->'d'->'courseDetails', '{}'::jsonb)) as detail(key, value)
    where file_row.profile_id = p_profile_id
      and file_row.id = (detail.value->>'syllabusFileId')::uuid
      and file_row.course_id is distinct from detail.key;

  -- Keep files accessible as personal resources when their class/item is removed.
  update public.user_files as file_row
    set assignment_id = null
    where file_row.profile_id = p_profile_id
      and file_row.assignment_id is not null
      and not exists (
        select 1 from jsonb_array_elements(coalesce(p_dashboard->'d'->'assignments', '[]'::jsonb)) as assignment(value)
        where assignment.value->>'id' = file_row.assignment_id
          and assignment.value->>'courseId' = coalesce(file_row.course_id, '')
      );

  delete from public.courses as existing_course
    where existing_course.profile_id = p_profile_id
      and not exists (
        select 1 from jsonb_array_elements(p_courses) as course_item
        where course_item->>'id' = existing_course.id
      );

  update public.dashboard_state as dashboard_row
    set payload = p_dashboard
    where dashboard_row.profile_id = p_profile_id
    returning dashboard_row.updated_at into saved_revision;
  return saved_revision;
end;
$$;

revoke all on function public.save_account_workspace(uuid, uuid, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_account_workspace(uuid, uuid, timestamptz, jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
commit;
