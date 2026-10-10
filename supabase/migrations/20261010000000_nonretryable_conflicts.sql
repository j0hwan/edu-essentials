-- Logical revision conflicts are client errors, not retryable serialization
-- failures. PostgREST retries SQLSTATE 40001 transactions indefinitely, so
-- application-owned optimistic-concurrency checks use PT409 instead.
begin;

do $$
declare
  function_row record;
  function_definition text;
  rewritten_definition text;
begin
  -- Keep this list explicit: only application RPCs and compatibility wrappers
  -- whose bodies historically raised 40001 are candidates for rewriting.
  -- Optional AI functions are naturally skipped when those migrations were
  -- not installed.
  for function_row in
    select procedure.oid
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.prokind = 'f'
       and procedure.proname = any (array[
         'ai_apply_proposal',
         'ai_begin_message',
         'ai_finish_message',
         'begin_account_file_purge',
         'finalize_account_file_purge',
         'mutate_account_document',
         'mutate_account_document_request',
         'mutate_account_document_legacy',
         'mutate_account_file',
         'mutate_account_file_legacy',
         'mutate_account_file_location',
         'mutate_account_file_location_legacy',
         'mutate_account_file_tree_action',
         'mutate_account_files_action',
         'mutate_account_files_action_legacy',
         'mutate_account_folder',
         'mutate_account_folder_legacy',
         'read_account_file_content',
         'rename_account_file',
         'rename_account_file_legacy',
         'save_account_workspace',
         'snapshot_account_file_selection'
       ])
  loop
    function_definition := pg_catalog.pg_get_functiondef(function_row.oid);
    rewritten_definition := pg_catalog.regexp_replace(
      function_definition,
      'errcode[[:space:]]*=[[:space:]]*''40001''',
      'errcode = ''PT409''',
      'gi'
    );

    if rewritten_definition <> function_definition then
      execute rewritten_definition;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
