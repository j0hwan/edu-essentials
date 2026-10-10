-- Fence completed AI answers against the workspace and document sources used
-- to produce them. Keep this optional so installations without AI can migrate.
begin;

do $migration$
declare
  v_ai_installed boolean;
begin
  v_ai_installed := to_regclass('public.ai_messages') is not null
    or to_regclass('public.ai_proposals') is not null
    or to_regclass('public.ai_sources') is not null;
  if not v_ai_installed then
    return;
  end if;

  if to_regclass('public.ai_messages') is null
      or to_regclass('public.ai_proposals') is null
      or to_regclass('public.ai_sources') is null
      or to_regclass('public.app_profiles') is null
      or to_regclass('public.dashboard_state') is null
      or to_regclass('public.user_files') is null
      or to_regprocedure('public.ai_source_file_is_current(uuid,uuid,text)') is null then
    raise exception 'AI result fence migration requires the complete AI file-source schema';
  end if;

  execute $ddl$
    create or replace function public.ai_finish_message(
      p_profile_id uuid,
      p_id uuid,
      p_result jsonb,
      p_proposal jsonb default null
    ) returns void
    language plpgsql security definer set search_path = '' as $function$
    declare
      v_actual_revision timestamptz;
      v_result_revision timestamptz;
      v_citation jsonb;
      v_source_id uuid;
      v_record_id text;
      v_record_enabled boolean;
      v_source public.ai_sources;
    begin
      -- File, workspace, and AI-source mutators use this account lock before
      -- locking their rows. It serializes final validation with Trash, edits,
      -- source exclusion, and indexing publication.
      perform 1 from public.app_profiles as profile_row
        where profile_row.id = p_profile_id
        for update;
      if not found then
        raise exception 'Request unavailable' using errcode = '40001';
      end if;

      perform 1 from public.ai_messages as message_row
        where message_row.profile_id = p_profile_id
          and message_row.id = p_id
          and message_row.status = 'running'
        for update;
      if not found then
        raise exception 'Request unavailable' using errcode = '40001';
      end if;

      if p_result is null or jsonb_typeof(p_result) is distinct from 'object'
          or jsonb_typeof(p_result -> 'revision') is distinct from 'string'
          or jsonb_typeof(p_result -> 'citations') is distinct from 'array' then
        raise exception 'Workspace or source changed; request a new answer' using errcode = '40001';
      end if;

      begin
        v_result_revision := (p_result ->> 'revision')::timestamptz;
      exception when others then
        raise exception 'Workspace or source changed; request a new answer' using errcode = '40001';
      end;

      select workspace.updated_at into v_actual_revision
        from public.dashboard_state as workspace
        where workspace.profile_id = p_profile_id;
      if not found or v_result_revision is distinct from v_actual_revision then
        raise exception 'Workspace or source changed; request a new answer' using errcode = '40001';
      end if;

      for v_citation in
        select citation.value from jsonb_array_elements(p_result -> 'citations') as citation(value)
      loop
        if jsonb_typeof(v_citation) is distinct from 'object' then
          raise exception 'Workspace or source changed; request a new answer' using errcode = '40001';
        end if;

        -- Record citations for live notes and syllabi are covered by the
        -- workspace revision. Only document citations name an indexed source.
        if v_citation ->> 'kind' = 'document' then
          if jsonb_typeof(v_citation -> 'sourceId') is distinct from 'string'
              or jsonb_typeof(v_citation -> 'version') is distinct from 'string' then
            raise exception 'Workspace or source changed; request a new answer' using errcode = '40001';
          end if;

          begin
            v_source_id := (v_citation ->> 'sourceId')::uuid;
          exception when others then
            raise exception 'Workspace or source changed; request a new answer' using errcode = '40001';
          end;

          select source_row.* into v_source
            from public.ai_sources as source_row
            where source_row.profile_id = p_profile_id
              and source_row.id = v_source_id
            for update;
          if not found or not v_source.enabled or v_source.state <> 'ready'
              or not v_source.file_available
              or v_source.version is distinct from (v_citation ->> 'version') then
            raise exception 'Workspace or source changed; request a new answer' using errcode = '40001';
          end if;

          if v_source.file_id is not null
              and not public.ai_source_file_is_current(
                p_profile_id, v_source.file_id, v_source.version
              ) then
            raise exception 'Workspace or source changed; request a new answer' using errcode = '40001';
          end if;
        elsif v_citation ->> 'kind' = 'record' then
          v_record_id := v_citation ->> 'recordId';
          if v_record_id ~ '^(note:|syllabus:|legacy-note)' then
            select source_row.enabled into v_record_enabled
              from public.ai_sources as source_row
              where source_row.profile_id = p_profile_id
                and source_row.source_key = v_record_id
              for update;
            if found and not v_record_enabled then
              raise exception 'Workspace or source changed; request a new answer' using errcode = '40001';
            end if;
          end if;
        end if;
      end loop;

      if p_proposal is not null then
        insert into public.ai_proposals(
          profile_id, id, message_id, expected_revision, expected_profile_revision,
          snapshot, preview
        ) values (
          p_profile_id, (p_proposal ->> 'id')::uuid, p_id,
          (p_proposal ->> 'revision')::timestamptz,
          (p_proposal ->> 'profileRevision')::timestamptz,
          p_proposal -> 'snapshot', p_proposal -> 'preview'
        );
      end if;

      update public.ai_messages
        set status = 'complete', result = p_result, finished_at = now()
        where profile_id = p_profile_id and id = p_id;
    end
    $function$;
  $ddl$;

  execute 'revoke all on function public.ai_finish_message(uuid,uuid,jsonb,jsonb) from public, anon, authenticated, service_role';
  execute 'grant execute on function public.ai_finish_message(uuid,uuid,jsonb,jsonb) to service_role';
end
$migration$;

notify pgrst, 'reload schema';
commit;
