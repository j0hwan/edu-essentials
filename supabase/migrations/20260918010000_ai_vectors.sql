begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
alter table public.ai_chunks add column embedding extensions.vector(768), add column embedding_model text;
-- Deliberately exact search for the small pilot: ownership filtering precedes ranking.
create function public.ai_hybrid_search(p_profile_id uuid,p_query text,p_embedding extensions.vector(768),p_model text,p_course_id text default null)
returns table(source_id uuid,version text,ordinal integer,page integer,body text,label text) language sql security definer set search_path='' as $$
  with eligible as materialized (
    select c.*,s.label from public.ai_chunks c join public.ai_sources s on s.profile_id=c.profile_id and s.id=c.source_id and s.version=c.version
    where c.profile_id=p_profile_id and s.enabled and s.state='ready' and (p_course_id is null or s.course_id=p_course_id)
  ), lexical as (
    select source_id,ordinal,row_number() over(order by ts_rank_cd(search,websearch_to_tsquery('english',p_query)) desc) rank from eligible where search @@ websearch_to_tsquery('english',p_query)
  ), semantic as (
    select source_id,ordinal,row_number() over(order by embedding operator(extensions.<=>) p_embedding) rank from eligible where embedding is not null and embedding_model=p_model
  )
  select e.source_id,e.version,e.ordinal,e.page,e.body,e.label from eligible e
    left join lexical l using(source_id,ordinal) left join semantic v using(source_id,ordinal)
    where l.rank is not null or v.rank is not null
    order by coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+v.rank),0) desc,e.source_id,e.ordinal limit 8;
$$;
revoke all on function public.ai_hybrid_search(uuid,text,extensions.vector,text,text) from public,anon,authenticated;
grant execute on function public.ai_hybrid_search(uuid,text,extensions.vector,text,text) to service_role;
notify pgrst,'reload schema';
commit;
