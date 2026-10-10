-- Give editor saves a stable receipt so a retried request cannot overwrite a
-- later edit. The receipt stores only the payload fingerprint and acknowledged
-- content revision; native document bodies remain in native_file_documents.
begin;

create table public.document_save_receipts (
  profile_id uuid not null references public.app_profiles(id) on delete cascade,
  file_id uuid not null,
  request_id uuid not null,
  fingerprint bytea not null check (octet_length(fingerprint) = 32),
  acknowledged_content_revision bigint not null check (acknowledged_content_revision > 0),
  primary key (profile_id, request_id),
  foreign key (profile_id, file_id) references public.user_files(profile_id, id) on delete cascade
);
create index document_save_receipts_file_idx
  on public.document_save_receipts(profile_id, file_id);

alter table public.document_save_receipts enable row level security;
revoke all on table public.document_save_receipts from public, anon, authenticated, service_role;

-- The name is optional, but when supplied its optimistic metadata revision and
-- the content save are committed with the receipt in the same transaction.
create function public.mutate_account_document_request(
  p_profile_id uuid,
  p_auth_user_id uuid,
  p_file_id uuid,
  p_request_id uuid,
  p_expected_content_revision bigint,
  p_document jsonb,
  p_name text,
  p_expected_metadata_revision bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_receipt public.document_save_receipts;
  v_file public.user_files;
  v_name text;
  v_body text;
  v_fingerprint bytea;
  v_result jsonb;
  v_acknowledged_revision bigint;
begin
  perform 1 from public.app_profiles
    where id = p_profile_id and auth_user_id = p_auth_user_id
      and initialized and onboarding_completed_at is not null
    for update;
  if not found then raise exception 'Account not ready' using errcode = '42501'; end if;

  if p_file_id is null or p_request_id is null
      or p_expected_content_revision is null or p_expected_content_revision < 1
      or p_document is null or jsonb_typeof(p_document) <> 'object'
      or not (p_document ? 'body') or jsonb_typeof(p_document->'body') <> 'string' then
    raise exception 'Invalid document save request' using errcode = '22023';
  end if;
  v_body := p_document->>'body';
  if octet_length(convert_to(v_body, 'UTF8')) > 1048576 then
    raise exception 'Text documents are limited to 1 MiB of UTF-8 content' using errcode = '22023';
  end if;

  if (p_name is null) <> (p_expected_metadata_revision is null) then
    raise exception 'A document name and metadata revision must be provided together' using errcode = '22023';
  end if;
  if p_name is not null then
    v_name := btrim(p_name);
    if p_expected_metadata_revision < 1 or not (length(p_name) between 1 and 255)
        or v_name = '' or p_name ~ '[[:cntrl:]]'
        or position('/' in p_name) > 0 or position(chr(92) in p_name) > 0 then
      raise exception 'Use a document name of 1–255 characters without path separators' using errcode = '22023';
    end if;
  end if;

  v_fingerprint := sha256(convert_to(jsonb_build_object(
    'file_id', p_file_id,
    'expected_content_revision', p_expected_content_revision,
    'document', p_document,
    'name', v_name,
    'expected_metadata_revision', p_expected_metadata_revision
  )::text, 'UTF8'));

  select * into v_receipt from public.document_save_receipts
    where profile_id = p_profile_id and request_id = p_request_id;
  if found then
    if v_receipt.file_id <> p_file_id or v_receipt.fingerprint <> v_fingerprint then
      raise exception 'Save request ID was already used with different document data' using errcode = '23505';
    end if;
    v_result := public.read_account_file_content(p_profile_id, p_file_id, null, false);
    return v_result || jsonb_build_object(
      'requestId', p_request_id,
      'acknowledgedContentRevision', v_receipt.acknowledged_content_revision
    );
  end if;

  if p_name is not null then
    select * into v_file from public.user_files
      where profile_id = p_profile_id and id = p_file_id
      for update;
    if not found then raise exception 'File not found' using errcode = 'P0002'; end if;
    if v_file.content_backend <> 'native-text' or v_file.state <> 'ready'
        or v_file.deleted_at is not null or v_file.trashed_at is not null then
      raise exception 'File is not an active native text document' using errcode = '23514';
    end if;
    if v_file.content_revision <> p_expected_content_revision
        or v_file.metadata_revision <> p_expected_metadata_revision then
      raise exception 'Document changed; reload before saving' using errcode = '40001';
    end if;
    update public.user_files set name = v_name
      where profile_id = p_profile_id and id = p_file_id;
  end if;

  v_result := public.mutate_account_document(
    p_profile_id, p_auth_user_id, p_file_id, 'update_content',
    p_expected_content_revision, p_document
  );
  v_acknowledged_revision := (v_result->'file'->>'content_revision')::bigint;
  insert into public.document_save_receipts(
    profile_id, file_id, request_id, fingerprint, acknowledged_content_revision
  ) values (
    p_profile_id, p_file_id, p_request_id, v_fingerprint, v_acknowledged_revision
  );

  return v_result || jsonb_build_object(
    'requestId', p_request_id,
    'acknowledgedContentRevision', v_acknowledged_revision
  );
end;
$$;
revoke all on function public.mutate_account_document_request(uuid, uuid, uuid, uuid, bigint, jsonb, text, bigint)
  from public, anon, authenticated;
grant execute on function public.mutate_account_document_request(uuid, uuid, uuid, uuid, bigint, jsonb, text, bigint)
  to service_role;

notify pgrst, 'reload schema';
commit;
