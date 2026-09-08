-- Read-only catalog verification. All six checks passed in the connected project
-- after applying 20260905000000_persistence_foundation.sql via the SQL editor.
select 'RLS enabled on all four app tables' as check_name,
  count(*) = 4 and bool_and(c.relrowsecurity) as passed
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('app_profiles','courses','dashboard_state','user_files')
union all
select 'Browser roles have no app table grants', count(*) = 0
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('app_profiles','courses','dashboard_state','user_files')
  and grantee in ('anon','authenticated','PUBLIC')
union all
select 'Snapshot function is service-only',
  not has_function_privilege('anon','public.save_account_workspace(uuid,uuid,timestamptz,jsonb,jsonb)','execute')
  and not has_function_privilege('authenticated','public.save_account_workspace(uuid,uuid,timestamptz,jsonb,jsonb)','execute')
  and has_function_privilege('service_role','public.save_account_workspace(uuid,uuid,timestamptz,jsonb,jsonb)','execute')
union all
select 'Private bucket has restrictive browser policy', count(*) = 1
from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and policyname = 'eduessentials_private_server_only' and permissive = 'RESTRICTIVE'
  and roles @> array['anon','authenticated']::name[]
union all
select 'Five foundation triggers are installed', count(*) = 5
from pg_trigger where not tgisinternal and tgenabled = 'O'
  and tgname in ('app_profiles_save_revision','dashboard_state_save_revision','courses_save_revision','user_files_save_revision','user_files_detach_assignment')
union all
select 'Profile ownership references Supabase Auth', count(*) = 1
from pg_constraint where contype = 'f' and conrelid = 'public.app_profiles'::regclass
  and confrelid = 'auth.users'::regclass;
