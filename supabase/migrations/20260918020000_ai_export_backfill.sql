begin;
-- Backfill source controls without editing user workspaces or advancing revisions.
insert into public.ai_sources(profile_id,source_key,label,version,body)
select d.profile_id,'note:'||(widget->>2),'Note in '||(w->>1),md5(coalesce(d.payload->'t'->>(widget->>3)::integer,'')),coalesce(d.payload->'t'->>(widget->>3)::integer,'')
from public.dashboard_state d cross join lateral jsonb_array_elements(d.payload->'w') w
cross join lateral jsonb_array_elements(w->2) widget
where d.payload->>'v'='2' and widget->>0='12'
on conflict(profile_id,source_key) do nothing;
insert into public.ai_sources(profile_id,source_key,label,version,body)
select profile_id,'legacy-note','Legacy notes',md5(payload->>'n'),payload->>'n'
from public.dashboard_state where coalesce(payload->>'n','')<>''
on conflict(profile_id,source_key) do nothing;
insert into public.ai_sources(profile_id,source_key,label,course_id,version,body)
select d.profile_id,'syllabus:'||entry.key,coalesce(entry.value->>'syllabusName','Pasted syllabus'),entry.key,md5(entry.value->>'syllabusText'),entry.value->>'syllabusText'
from public.dashboard_state d cross join lateral jsonb_each(coalesce(d.payload->'d'->'courseDetails','{}')) entry
where coalesce(entry.value->>'syllabusText','')<>''
on conflict(profile_id,source_key) do nothing;

-- Account export stays available even when AI is disabled or the pilot ends.
create or replace function public.export_account(p_profile_id uuid,p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform 1 from public.app_profiles where id=p_profile_id and auth_user_id=p_auth_user_id and initialized for update;
  if not found then raise exception 'Account not ready' using errcode='42501'; end if;
  select jsonb_build_object('profile',(select to_jsonb(p) from public.app_profiles p where p.id=p_profile_id),
    'courses',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.courses c where c.profile_id=p_profile_id),
    'workspace',(select jsonb_build_object('dashboard',payload,'revision',updated_at) from public.dashboard_state where profile_id=p_profile_id),
    'files',(select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') from public.user_files f where f.profile_id=p_profile_id and f.deleted_at is null),
    'assistant',jsonb_build_object(
      'access',(select to_jsonb(a) from public.ai_access a where a.profile_id=p_profile_id),
      'conversations',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at),'[]') from public.ai_conversations c where c.profile_id=p_profile_id),
      'messages',(select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at),'[]') from public.ai_messages m where m.profile_id=p_profile_id),
      'proposals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at),'[]') from public.ai_proposals p where p.profile_id=p_profile_id),
      'sources',(select coalesce(jsonb_agg(to_jsonb(s) order by s.source_key),'[]') from public.ai_sources s where s.profile_id=p_profile_id)
    )) into result;
  return result;
end $$;
revoke all on function public.export_account(uuid,uuid) from public,anon,authenticated;
grant execute on function public.export_account(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
