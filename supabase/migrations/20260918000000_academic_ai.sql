-- AI is opt-in. No student content leaves the database during this migration.
begin;
create table public.ai_access (
  profile_id uuid primary key references public.app_profiles(id) on delete cascade,
  adult_confirmed boolean not null default false,
  synthetic_confirmed boolean not null default false,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.ai_conversations (
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  id uuid not null default gen_random_uuid(), title text not null check(length(title) between 1 and 120),
  created_at timestamptz not null default now(), primary key(profile_id,id)
);
create table public.ai_messages (
  profile_id uuid not null, conversation_id uuid not null, id uuid not null,
  question text not null check(length(question) between 1 and 8000),
  status text not null default 'running' check(status in ('running','complete','failed')),
  result jsonb, error text, model text not null, prompt_version text not null,
  created_at timestamptz not null default now(), finished_at timestamptz,
  primary key(profile_id,id),
  foreign key(profile_id,conversation_id) references public.ai_conversations(profile_id,id) on delete cascade
);
create index ai_messages_conversation on public.ai_messages(profile_id,conversation_id,created_at);
create table public.ai_proposals (
  profile_id uuid not null, id uuid not null default gen_random_uuid(), message_id uuid not null,
  expected_revision timestamptz not null, expected_profile_revision timestamptz not null,
  snapshot jsonb not null, preview jsonb not null,
  status text not null default 'pending' check(status in ('pending','applied','dismissed')),
  receipt jsonb, created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '1 day',
  primary key(profile_id,id), unique(profile_id,message_id),
  foreign key(profile_id,message_id) references public.ai_messages(profile_id,id) on delete cascade
);
create table public.ai_sources (
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  id uuid not null default gen_random_uuid(), source_key text not null, file_id uuid,
  label text not null, course_id text, version text not null, body text,
  enabled boolean not null default true,
  state text not null default 'queued' check(state in ('queued','processing','ready','failed','unsupported')),
  error text, attempts integer not null default 0, lease_id uuid, lease_until timestamptz,
  available_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(profile_id,id), unique(profile_id,source_key),
  foreign key(profile_id,file_id) references public.user_files(profile_id,id) on delete cascade
);
create table public.ai_chunks (
  profile_id uuid not null, source_id uuid not null, version text not null,
  ordinal integer not null, page integer not null, body text not null check(length(body)<=10000),
  search tsvector generated always as (to_tsvector('english',body)) stored,
  primary key(profile_id,source_id,version,ordinal),
  foreign key(profile_id,source_id) references public.ai_sources(profile_id,id) on delete cascade
);
create index ai_chunks_search on public.ai_chunks using gin(search);
create table public.ai_budget (
  bucket text primary key, requests integer not null default 0, tokens bigint not null default 0,
  reserved_usd numeric not null default 0, updated_at timestamptz not null default now()
);
create table public.ai_metrics (
  id uuid primary key default gen_random_uuid(), profile_id uuid references public.app_profiles(id) on delete cascade,
  request_id uuid, model text not null, input_tokens integer not null, output_tokens integer not null,
  latency_ms integer not null default 0, created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['ai_access','ai_conversations','ai_messages','ai_proposals','ai_sources','ai_chunks','ai_budget','ai_metrics'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function public.ai_begin_message(p_profile_id uuid,p_conversation_id uuid,p_id uuid,p_question text,p_model text,p_prompt_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.ai_messages;
begin
  perform 1 from public.ai_conversations where profile_id=p_profile_id and id=p_conversation_id for update;
  if not found then raise exception 'Conversation unavailable' using errcode='P0002'; end if;
  select * into existing from public.ai_messages where profile_id=p_profile_id and id=p_id;
  if found then
    if existing.question<>p_question or existing.conversation_id<>p_conversation_id then raise exception 'Request ID reused' using errcode='22023'; end if;
    if existing.status='running' and existing.created_at<now()-interval '5 minutes' then
      update public.ai_messages set status='failed',error='The request was interrupted. Send a new message to retry.',finished_at=now() where profile_id=p_profile_id and id=p_id returning * into existing;
    end if;
    return jsonb_build_object('created',false,'message',to_jsonb(existing));
  end if;
  if exists(select 1 from public.ai_messages where profile_id=p_profile_id and conversation_id=p_conversation_id and status='running' and created_at>now()-interval '5 minutes') then
    raise exception 'A message is still running' using errcode='40001';
  end if;
  insert into public.ai_messages(profile_id,conversation_id,id,question,model,prompt_version) values(p_profile_id,p_conversation_id,p_id,p_question,p_model,p_prompt_version) returning * into existing;
  return jsonb_build_object('created',true,'message',to_jsonb(existing));
end $$;

-- Reserve a conservative upper bound before each provider call, including embeddings.
-- Project-wide advisory lock makes limits effective across Worker instances.
create function public.ai_reserve(p_profile_id uuid,p_user_daily integer,p_project_daily integer,p_rpm integer,p_tpm bigint,p_monthly_usd numeric,p_tokens bigint,p_usd numeric)
returns void language plpgsql security definer set search_path='' as $$
declare minute_key text:=to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI'); day_key text:=to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD'); month_key text:=to_char(now() at time zone 'UTC','YYYY-MM'); k text;
begin
  if least(p_user_daily,p_project_daily,p_rpm,p_tpm,p_monthly_usd,p_tokens,p_usd)<=0 then raise exception 'Invalid limit'; end if;
  perform pg_advisory_xact_lock(9181801);
  foreach k in array array['minute:'||minute_key,'day:'||day_key,'user:'||p_profile_id::text||':'||day_key,'month:'||month_key] loop
    insert into public.ai_budget(bucket) values(k) on conflict do nothing;
  end loop;
  if exists(select 1 from public.ai_budget where
    (bucket='minute:'||minute_key and (requests>=p_rpm or tokens+p_tokens>p_tpm)) or
    (bucket='day:'||day_key and requests>=p_project_daily) or
    (bucket='user:'||p_profile_id::text||':'||day_key and requests>=p_user_daily) or
    (bucket='month:'||month_key and reserved_usd+p_usd>p_monthly_usd)) then
    raise exception 'AI usage limit reached' using errcode='P0001';
  end if;
  update public.ai_budget set requests=requests+1,tokens=tokens+p_tokens,reserved_usd=reserved_usd+p_usd,updated_at=now()
    where bucket in ('minute:'||minute_key,'day:'||day_key,'user:'||p_profile_id::text||':'||day_key,'month:'||month_key);
end $$;

create function public.ai_apply_proposal(p_profile_id uuid,p_auth_user_id uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proposal public.ai_proposals; rev timestamptz; profile_rev timestamptz;
begin
  select updated_at into profile_rev from public.app_profiles where id=p_profile_id and auth_user_id=p_auth_user_id for update;
  if not found then raise exception 'Account unavailable' using errcode='42501'; end if;
  select * into proposal from public.ai_proposals where profile_id=p_profile_id and id=p_id for update;
  if not found then raise exception 'Proposal unavailable' using errcode='P0002'; end if;
  if proposal.status='applied' then return proposal.receipt; end if;
  if proposal.status<>'pending' or proposal.expires_at<now() then raise exception 'Proposal expired or dismissed' using errcode='40001'; end if;
  if profile_rev<>proposal.expected_profile_revision then raise exception 'Profile changed; request a new preview' using errcode='40001'; end if;
  rev:=public.save_account_workspace(p_profile_id,p_auth_user_id,proposal.expected_revision,proposal.snapshot->'courses',proposal.snapshot->'dashboard');
  update public.ai_proposals set status='applied', receipt=jsonb_build_object('proposalId',p_id,'revision',rev,'appliedAt',clock_timestamp(),'changes',proposal.preview->'changes') where profile_id=p_profile_id and id=p_id returning receipt into proposal.receipt;
  return proposal.receipt;
end $$;

create function public.ai_finish_message(p_profile_id uuid,p_id uuid,p_result jsonb,p_proposal jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.ai_messages where profile_id=p_profile_id and id=p_id and status='running' for update;
  if not found then raise exception 'Request unavailable' using errcode='40001'; end if;
  if p_proposal is not null then
    insert into public.ai_proposals(profile_id,id,message_id,expected_revision,expected_profile_revision,snapshot,preview)
      values(p_profile_id,(p_proposal->>'id')::uuid,p_id,(p_proposal->>'revision')::timestamptz,(p_proposal->>'profileRevision')::timestamptz,p_proposal->'snapshot',p_proposal->'preview');
  end if;
  update public.ai_messages set status='complete',result=p_result,finished_at=now() where profile_id=p_profile_id and id=p_id;
end $$;

-- Old clients may edit events, but cannot silently erase an already saved duration.
create function public.ai_preserve_event_duration() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from jsonb_array_elements(coalesce(old.payload->'d'->'manualEvents','[]')) a
    join jsonb_array_elements(coalesce(new.payload->'d'->'manualEvents','[]')) b on a->>'id'=b->>'id'
    where a ? 'durationMinutes' and not b ? 'durationMinutes') then
    raise exception 'Reload the updated app before editing events' using errcode='22023';
  end if;
  return new;
end $$;
create trigger ai_event_duration before update on public.dashboard_state for each row execute function public.ai_preserve_event_duration();

create function public.ai_sync_file() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.state<>'ready' or new.deleted_at is not null then
    delete from public.ai_sources where profile_id=new.profile_id and file_id=new.id; return new;
  end if;
  insert into public.ai_sources(profile_id,source_key,file_id,label,course_id,version,state)
    values(new.profile_id,'file:'||new.id::text,new.id,new.name,new.course_id,new.content_sha256,
      case when new.size_bytes>10485760 or new.mime_type not in ('application/pdf','text/plain','text/markdown') then 'unsupported' else 'queued' end)
    on conflict(profile_id,source_key) do update set label=excluded.label,course_id=excluded.course_id,updated_at=now();
  return new;
end $$;
create trigger ai_file_jobs after insert or update on public.user_files for each row execute function public.ai_sync_file();

create function public.ai_sync_notes() returns trigger language plpgsql security definer set search_path='' as $$
declare w jsonb; widget jsonb; content text; key text; seen text[]:='{}'; entry record;
begin
  if new.payload->>'v'='2' then
    for w in select jsonb_array_elements(new.payload->'w') loop
      for widget in select jsonb_array_elements(w->2) loop
        if widget->>0='12' then
          key:='note:'||(widget->>2); content:=new.payload->'t'->>(widget->>3)::integer; seen:=array_append(seen,key);
          insert into public.ai_sources(profile_id,source_key,label,version,body) values(new.profile_id,key,'Note in '||(w->>1),md5(coalesce(content,'')),coalesce(content,''))
            on conflict(profile_id,source_key) do update set body=excluded.body,version=excluded.version,label=excluded.label,state=case when public.ai_sources.version<>excluded.version then 'queued' else public.ai_sources.state end,attempts=case when public.ai_sources.version<>excluded.version then 0 else public.ai_sources.attempts end,updated_at=now();
        end if;
      end loop;
    end loop;
  end if;
  if coalesce(new.payload->>'n','')<>'' then
    key:='legacy-note'; seen:=array_append(seen,key);
    insert into public.ai_sources(profile_id,source_key,label,version,body) values(new.profile_id,key,'Legacy notes',md5(new.payload->>'n'),new.payload->>'n')
      on conflict(profile_id,source_key) do update set body=excluded.body,version=excluded.version,state=case when public.ai_sources.version<>excluded.version then 'queued' else public.ai_sources.state end;
  end if;
  for entry in select * from jsonb_each(coalesce(new.payload->'d'->'courseDetails','{}')) loop
    if coalesce(entry.value->>'syllabusText','')<>'' then
      key:='syllabus:'||entry.key; seen:=array_append(seen,key); content:=entry.value->>'syllabusText';
      insert into public.ai_sources(profile_id,source_key,label,course_id,version,body) values(new.profile_id,key,coalesce(entry.value->>'syllabusName','Pasted syllabus'),entry.key,md5(content),content)
        on conflict(profile_id,source_key) do update set body=excluded.body,version=excluded.version,label=excluded.label,state=case when public.ai_sources.version<>excluded.version then 'queued' else public.ai_sources.state end,attempts=case when public.ai_sources.version<>excluded.version then 0 else public.ai_sources.attempts end,updated_at=now();
    end if;
  end loop;
  delete from public.ai_sources where profile_id=new.profile_id and file_id is null and not source_key=any(seen);
  return new;
end $$;
create trigger ai_note_jobs after insert or update on public.dashboard_state for each row execute function public.ai_sync_notes();

create function public.ai_claim_source(p_allowed uuid[],p_synthetic boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.ai_sources;
begin
  select s.* into result from public.ai_sources s join public.ai_access a on a.profile_id=s.profile_id
    where s.profile_id=any(p_allowed) and a.enabled and a.adult_confirmed and (not p_synthetic or a.synthetic_confirmed)
    and s.enabled and s.attempts<5 and s.available_at<=now() and (s.state='queued' or (s.state='processing' and s.lease_until<now()))
    order by s.updated_at for update of s skip locked limit 1;
  if not found then return null; end if;
  update public.ai_sources set state='processing',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    where profile_id=result.profile_id and id=result.id returning * into result;
  return to_jsonb(result);
end $$;

create function public.ai_publish_source(p_profile_id uuid,p_id uuid,p_version text,p_lease uuid,p_chunks jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.ai_sources where profile_id=p_profile_id and id=p_id and version=p_version and lease_id=p_lease and enabled for update;
  if not found then return false; end if;
  delete from public.ai_chunks where profile_id=p_profile_id and source_id=p_id;
  insert into public.ai_chunks(profile_id,source_id,version,ordinal,page,body)
    select p_profile_id,p_id,p_version,(c->>'ordinal')::integer,(c->>'page')::integer,c->>'body' from jsonb_array_elements(p_chunks)c;
  update public.ai_sources set state='ready',error=null,lease_id=null,lease_until=null where profile_id=p_profile_id and id=p_id;
  return true;
end $$;

create function public.ai_keyword_search(p_profile_id uuid,p_query text,p_course_id text default null)
returns table(source_id uuid,version text,ordinal integer,page integer,body text,label text) language sql security definer set search_path='' as $$
  select c.source_id,c.version,c.ordinal,c.page,c.body,s.label from public.ai_chunks c
  join public.ai_sources s on s.profile_id=c.profile_id and s.id=c.source_id and s.version=c.version
  where c.profile_id=p_profile_id and s.enabled and s.state='ready' and (p_course_id is null or s.course_id=p_course_id)
    and c.search @@ websearch_to_tsquery('english',p_query)
  order by ts_rank_cd(c.search,websearch_to_tsquery('english',p_query)) desc,c.source_id,c.ordinal limit 8;
$$;
create function public.ai_cleanup() returns void language plpgsql security definer set search_path='' as $$
begin
  delete from public.ai_conversations where created_at<now()-interval '30 days';
  delete from public.ai_metrics where created_at<now()-interval '90 days';
  delete from public.ai_budget where updated_at<now()-interval '90 days';
  delete from public.ai_chunks c where not exists(select 1 from public.ai_sources s where s.profile_id=c.profile_id and s.id=c.source_id and s.version=c.version and s.enabled);
  update public.ai_sources set state='failed',error='Indexing interrupted repeatedly. Retry indexing.' where state='processing' and lease_until<now() and attempts>=5;
end $$;

-- Populate jobs for existing saved sources, preserving the workspace revision.
insert into public.ai_sources(profile_id,source_key,file_id,label,course_id,version,state)
  select profile_id,'file:'||id::text,id,name,course_id,content_sha256,
    case when size_bytes>10485760 or mime_type not in ('application/pdf','text/plain','text/markdown') then 'unsupported' else 'queued' end
  from public.user_files where state='ready' and deleted_at is null;
-- Existing notes are synchronized on the next ordinary workspace save.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'ai_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
