-- Keep AI file sources stable across recoverable Trash while fencing every job
-- against the current file bytes and active file state.
begin;

alter table public.ai_sources
  add column file_available boolean not null default true;

create function public.ai_source_file_is_current(p_profile_id uuid, p_file_id uuid, p_version text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_file_id is null or exists (
    select 1
    from public.user_files f
    where f.profile_id = p_profile_id and f.id = p_file_id
      and f.state = 'ready' and f.deleted_at is null and f.trashed_at is null
      and f.content_sha256 = p_version
      and (f.content_backend = 'object' or (f.content_backend = 'native-text'
        and exists (select 1 from public.native_file_documents d
          where d.profile_id = f.profile_id and d.file_id = f.id)))
  );
$$;

create function public.ai_clear_stale_file_chunks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.version is distinct from new.version or old.file_available is distinct from new.file_available then
    delete from public.ai_chunks where profile_id = new.profile_id and source_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists ai_clear_stale_file_chunks on public.ai_sources;
create trigger ai_clear_stale_file_chunks
  after update of version, file_available on public.ai_sources
  for each row execute function public.ai_clear_stale_file_chunks();

create or replace function public.ai_sync_file()
returns trigger language plpgsql security definer set search_path = '' as $$
declare file_available_now boolean; target_state text;
begin
  -- Pending uploads and permanent-delete tombstones do not retain an AI source.
  -- Recoverable Trash is different: keep the same source and its user preference.
  if new.state <> 'ready' or new.deleted_at is not null then
    delete from public.ai_sources where profile_id = new.profile_id and file_id = new.id;
    return new;
  end if;

  file_available_now := new.trashed_at is null;
  target_state := case
    when not file_available_now then 'queued'
    when new.size_bytes > 10485760 or new.mime_type not in ('application/pdf', 'text/plain', 'text/markdown') then 'unsupported'
    else 'queued'
  end;

  insert into public.ai_sources(profile_id, source_key, file_id, label, course_id, version, state, file_available)
    values(new.profile_id, 'file:' || new.id::text, new.id, new.name, new.course_id,
      new.content_sha256, target_state, file_available_now)
    on conflict(profile_id, source_key) do update set
      label = excluded.label,
      course_id = excluded.course_id,
      version = excluded.version,
      file_available = excluded.file_available,
      state = case when public.ai_sources.version is distinct from excluded.version
          or public.ai_sources.file_available is distinct from excluded.file_available
        then excluded.state else public.ai_sources.state end,
      attempts = case when public.ai_sources.version is distinct from excluded.version
          or public.ai_sources.file_available is distinct from excluded.file_available
        then 0 else public.ai_sources.attempts end,
      error = case when public.ai_sources.version is distinct from excluded.version
          or public.ai_sources.file_available is distinct from excluded.file_available
        then null else public.ai_sources.error end,
      lease_id = case when public.ai_sources.version is distinct from excluded.version
          or public.ai_sources.file_available is distinct from excluded.file_available
        then null else public.ai_sources.lease_id end,
      lease_until = case when public.ai_sources.version is distinct from excluded.version
          or public.ai_sources.file_available is distinct from excluded.file_available
        then null else public.ai_sources.lease_until end,
      available_at = case when public.ai_sources.version is distinct from excluded.version
          or public.ai_sources.file_available is distinct from excluded.file_available
        then now() else public.ai_sources.available_at end,
      updated_at = now();
  return new;
end;
$$;

-- Batch 1 intentionally limited this trigger to object uploads. Native document
-- edits update user_files.content_sha256 in their transaction and use this same
-- synchronization path.
drop trigger if exists ai_file_jobs on public.user_files;
create trigger ai_file_jobs after insert or update on public.user_files
  for each row execute function public.ai_sync_file();

-- Backfill ready files without touching user_files or its revision timestamps.
-- Conflict updates preserve the existing source ID and enabled preference.
insert into public.ai_sources(profile_id, source_key, file_id, label, course_id, version, state, file_available)
  select f.profile_id, 'file:' || f.id::text, f.id, f.name, f.course_id, f.content_sha256,
    case when f.trashed_at is not null then 'queued'
      when f.size_bytes > 10485760 or f.mime_type not in ('application/pdf', 'text/plain', 'text/markdown') then 'unsupported'
      else 'queued' end,
    f.trashed_at is null
  from public.user_files f
  where f.state = 'ready' and f.deleted_at is null
  on conflict(profile_id, source_key) do update set
    label = excluded.label,
    course_id = excluded.course_id,
    version = excluded.version,
    file_available = excluded.file_available,
    state = case when public.ai_sources.version is distinct from excluded.version
        or public.ai_sources.file_available is distinct from excluded.file_available
      then excluded.state else public.ai_sources.state end,
    attempts = case when public.ai_sources.version is distinct from excluded.version
        or public.ai_sources.file_available is distinct from excluded.file_available
      then 0 else public.ai_sources.attempts end,
    error = case when public.ai_sources.version is distinct from excluded.version
        or public.ai_sources.file_available is distinct from excluded.file_available
      then null else public.ai_sources.error end,
    lease_id = case when public.ai_sources.version is distinct from excluded.version
        or public.ai_sources.file_available is distinct from excluded.file_available
      then null else public.ai_sources.lease_id end,
    lease_until = case when public.ai_sources.version is distinct from excluded.version
        or public.ai_sources.file_available is distinct from excluded.file_available
      then null else public.ai_sources.lease_until end,
    available_at = case when public.ai_sources.version is distinct from excluded.version
        or public.ai_sources.file_available is distinct from excluded.file_available
      then now() else public.ai_sources.available_at end,
    updated_at = now();

delete from public.ai_sources s using public.user_files f
  where s.profile_id = f.profile_id and s.file_id = f.id
    and (f.state <> 'ready' or f.deleted_at is not null);

create or replace function public.ai_claim_source(p_allowed uuid[], p_synthetic boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.ai_sources;
begin
  select s.* into result
  from public.ai_sources s
  join public.ai_access a on a.profile_id = s.profile_id
  where s.profile_id = any(p_allowed) and a.enabled and a.adult_confirmed
    and (not p_synthetic or a.synthetic_confirmed)
    and s.enabled and s.attempts < 5 and s.available_at <= now()
    and (s.state = 'queued' or (s.state = 'processing' and s.lease_until < now()))
    and (s.file_id is null or (s.file_available
      and public.ai_source_file_is_current(s.profile_id, s.file_id, s.version)))
  order by s.updated_at for update of s skip locked limit 1;
  if not found then return null; end if;
  update public.ai_sources set state = 'processing', attempts = attempts + 1,
      lease_id = gen_random_uuid(), lease_until = now() + interval '5 minutes'
    where profile_id = result.profile_id and id = result.id returning * into result;
  return to_jsonb(result);
end;
$$;

create or replace function public.ai_publish_source(p_profile_id uuid, p_id uuid, p_version text, p_lease uuid, p_chunks jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare source_row public.ai_sources;
begin
  -- File edit and Trash RPCs take this same lock before locking their file row.
  -- This order keeps publication from racing a committed content mutation.
  perform 1 from public.app_profiles where id = p_profile_id for update;
  if not found then return false; end if;

  select * into source_row from public.ai_sources
    where profile_id = p_profile_id and id = p_id for update;
  if not found or source_row.version is distinct from p_version
      or source_row.lease_id is distinct from p_lease or not source_row.enabled
      or source_row.state <> 'processing' or source_row.lease_until is null
      or source_row.lease_until <= clock_timestamp()
      or (source_row.file_id is not null and (not source_row.file_available
        or not public.ai_source_file_is_current(source_row.profile_id, source_row.file_id, source_row.version))) then
    return false;
  end if;

  delete from public.ai_chunks where profile_id = p_profile_id and source_id = p_id;
  insert into public.ai_chunks(profile_id, source_id, version, ordinal, page, body)
    select p_profile_id, p_id, p_version, (c->>'ordinal')::integer, (c->>'page')::integer, c->>'body'
    from jsonb_array_elements(p_chunks) c;
  update public.ai_sources set state = 'ready', error = null, lease_id = null, lease_until = null
    where profile_id = p_profile_id and id = p_id;
  return true;
end;
$$;

create or replace function public.ai_keyword_search(p_profile_id uuid, p_query text, p_course_id text default null)
returns table(source_id uuid, version text, ordinal integer, page integer, body text, label text)
language sql security definer set search_path = '' as $$
  select c.source_id, c.version, c.ordinal, c.page, c.body, s.label
  from public.ai_chunks c
  join public.ai_sources s on s.profile_id = c.profile_id and s.id = c.source_id and s.version = c.version
  where c.profile_id = p_profile_id and s.enabled and s.file_available and s.state = 'ready'
    and public.ai_source_file_is_current(s.profile_id, s.file_id, s.version)
    and (p_course_id is null or s.course_id = p_course_id)
    and c.search @@ websearch_to_tsquery('english', p_query)
  order by ts_rank_cd(c.search, websearch_to_tsquery('english', p_query)) desc, c.source_id, c.ordinal limit 8;
$$;

create or replace function public.ai_hybrid_search(p_profile_id uuid, p_query text, p_embedding extensions.vector(768), p_model text, p_course_id text default null)
returns table(source_id uuid, version text, ordinal integer, page integer, body text, label text)
language sql security definer set search_path = '' as $$
  with eligible as materialized (
    select c.*, s.label from public.ai_chunks c
    join public.ai_sources s on s.profile_id = c.profile_id and s.id = c.source_id and s.version = c.version
    where c.profile_id = p_profile_id and s.enabled and s.file_available and s.state = 'ready'
      and public.ai_source_file_is_current(s.profile_id, s.file_id, s.version)
      and (p_course_id is null or s.course_id = p_course_id)
  ), lexical as (
    select source_id, ordinal,
      row_number() over(order by ts_rank_cd(search, websearch_to_tsquery('english', p_query)) desc) rank
    from eligible where search @@ websearch_to_tsquery('english', p_query)
  ), semantic as (
    select source_id, ordinal,
      row_number() over(order by embedding operator(extensions.<=>) p_embedding) rank
    from eligible where embedding is not null and embedding_model = p_model
  )
  select e.source_id, e.version, e.ordinal, e.page, e.body, e.label
  from eligible e left join lexical l using(source_id, ordinal) left join semantic v using(source_id, ordinal)
  where l.rank is not null or v.rank is not null
  order by coalesce(1.0/(60+l.rank), 0) + coalesce(1.0/(60+v.rank), 0) desc, e.source_id, e.ordinal limit 8;
$$;

create or replace function public.ai_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.ai_conversations where created_at < now() - interval '30 days';
  delete from public.ai_metrics where created_at < now() - interval '90 days';
  delete from public.ai_budget where updated_at < now() - interval '90 days';
  delete from public.ai_chunks c where not exists (
    select 1 from public.ai_sources s
    where s.profile_id = c.profile_id and s.id = c.source_id and s.version = c.version
      and s.enabled and s.file_available and s.state = 'ready'
      and public.ai_source_file_is_current(s.profile_id, s.file_id, s.version)
  );
  update public.ai_sources s set state = 'failed', error = 'Indexing interrupted repeatedly.',
      lease_id = null, lease_until = null
    where s.state = 'processing' and s.lease_until < now() and s.attempts >= 5
      and s.enabled and s.file_available
      and public.ai_source_file_is_current(s.profile_id, s.file_id, s.version);
end;
$$;

revoke all on function public.ai_source_file_is_current(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ai_source_file_is_current(uuid, uuid, text) to service_role;
revoke all on function public.ai_clear_stale_file_chunks() from public, anon, authenticated;
revoke all on function public.ai_sync_file() from public, anon, authenticated;
do $$ declare r record; begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'ai_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
