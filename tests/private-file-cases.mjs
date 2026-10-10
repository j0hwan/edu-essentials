// Runs against real PostgreSQL functions; only object-storage transport is faked.
export async function privateFileCases({ t, assert, sql, runtime, a, b, userA, userB, compile, clientModule, authUrl, dbUrl, requestUrl, getWorkspace }) {
  const bytes = new TextEncoder().encode('Private résumé source\nWeek one reading');
  const objects = new Map(), storageReads = [], storageRemoves = [];
  let uploadFails = false, deleteFails = false, deleteFailPath = null;
  runtime.storage = { from(bucket) { assert.equal(bucket, 'eduessentials-private'); return {
    async upload(path, value) { if (uploadFails) return { error: new Error('offline') }; if (objects.has(path)) return { error: new Error('duplicate') }; objects.set(path, new Uint8Array(value)); return { error: null }; },
    async download(path) { storageReads.push(path); return objects.has(path) ? { data: new Blob([objects.get(path)]) } : { error: new Error('missing') }; },
    async remove(paths) { storageRemoves.push(...paths); if (deleteFails || (deleteFailPath && paths.includes(deleteFailPath))) return { error: new Error('offline') }; paths.forEach((path) => objects.delete(path)); return { error: null }; },
  }; } };
  const filesUrl = await clientModule('lib/files.ts');
  const contentUrl = await compile('lib/file-content.ts', { './files': filesUrl });
  const organizationUrl = await compile('lib/file-organization.ts', { './files': filesUrl });
  const helper = await compile('lib/private-files-server.ts', { './auth': authUrl, './supabase-server': dbUrl, './persistence-request': requestUrl, './files': filesUrl });
  const imports = { '../../../lib/private-files-server': helper, '../../../lib/files': filesUrl, '../../../lib/persistence-request': requestUrl, '../../../lib/supabase-server': dbUrl, '../../../lib/file-content': contentUrl, '../../../lib/file-organization': organizationUrl, '../../../lib/zip': await clientModule('lib/zip.ts') };
  const api = await import(await compile('app/api/files/route.ts', imports)), exporter = await import(await compile('app/api/export/route.ts', imports));
  const folders = await import(await compile('app/api/file-folders/route.ts', imports));
  const documents = await import(await compile('app/api/file-documents/route.ts', imports));
  const actions = await import(await compile('app/api/files/actions/route.ts', {
    ...imports,
    '../../../../lib/private-files-server': helper,
    '../../../../lib/files': filesUrl,
    '../../../../lib/persistence-request': requestUrl,
    '../../../../lib/file-organization': organizationUrl,
    '../../../../lib/supabase-server': dbUrl,
  }));
  const sourceId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const ownFolderId = '12121212-1212-4121-8121-121212121212';
  const childFolderId = '13131313-1313-4131-8131-131313131313';
  const foreignFolderId = '14141414-1414-4141-8141-141414141414';
  const foreignDocumentId = '21212121-2121-4121-8121-212121212121';
  const textDocumentId = '15151515-1515-4151-8151-151515151515';
  const snapshotDocumentId = '16161616-1616-4161-8161-161616161616';
  const largeDocumentId = '17171717-1717-4171-8171-171717171717';
  const trashFileId = '18181818-1818-4181-8181-181818181818';
  const atomicFirstId = '19191919-1919-4191-8191-191919191919';
  const atomicSecondId = '20202020-2020-4020-8020-202020202020';
  const partialDeleteFirstId = '26262626-2626-4626-8626-262626262626';
  const partialDeleteSecondId = '27272727-2727-4727-8727-272727272727';
  const meta = { name: 'Résumé.txt', kind: 'resource', courseId: '', assignmentId: '' };
  const req = (id = '', method = 'GET', body, metadata = meta, account = a.id, origin = 'https://edu.example') => new Request(`https://edu.example/api/files${id ? '?id=' + id : ''}`, { method, headers: { origin, 'x-profile-id': account, 'content-type': method === 'POST' ? 'application/octet-stream' : 'application/json', 'x-file-metadata': encodeURIComponent(JSON.stringify(metadata)) }, ...(body === undefined ? {} : { body: method === 'POST' ? body : JSON.stringify(body) }) });
  const apiRequest = (path, method = 'GET', body, account = a.id, origin = 'https://edu.example') => new Request(`https://edu.example${path}`, { method, headers: { origin, 'x-profile-id': account, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const upload = async (id, metadata = meta, content = bytes) => api.POST(req(id, 'POST', content, metadata));
  const assertPublic = (value) => assert.doesNotMatch(JSON.stringify(value), /"(?:profile_id|auth_user_id|owner_id|user_id|account_id|bucket_id|object_path)"/);
  const parseZip = (bytesValue) => {
    const entries = new Map(); let offset = 0;
    while (offset + 4 <= bytesValue.length && bytesValue.readUInt32LE(offset) === 0x04034b50) {
      const nameLength = bytesValue.readUInt16LE(offset + 26), extraLength = bytesValue.readUInt16LE(offset + 28), size = bytesValue.readUInt32LE(offset + 18);
      const nameStart = offset + 30, dataStart = nameStart + nameLength + extraLength;
      const name = bytesValue.subarray(nameStart, nameStart + nameLength).toString();
      entries.set(name, bytesValue.subarray(dataStart, dataStart + size));
      offset = dataStart + size;
    }
    return entries;
  };
  const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; let saved;
  await t.test('private upload verifies actual bytes, stable retries, owner scope and safe downloads', async () => {
    assert.equal((await upload(id)).status, 201);
    saved = (await (await api.GET(req())).json()).files.find((f) => f.id === id);
    assert.equal(saved.state, 'ready'); assert.equal(saved.mime_type, 'text/plain'); assert.match(saved.content_sha256, /^[a-f0-9]{64}$/);
    assert.equal(saved.content_backend, 'object'); assert.equal(saved.metadata_revision, 2); assert.equal(saved.content_revision, 1); assert.equal(saved.folder_id, null);
    assert.equal(saved.object_path, undefined); assert.equal(objects.size, 1);
    assertPublic(saved);
    const list = await api.GET(req()); assertPublic(await list.json());
    const retry = await upload(id); assert.equal(retry.status, 201); assert.equal((await retry.json()).file.updated_at, saved.updated_at); assert.equal(objects.size, 1);
    assert.equal((await upload(id, meta, new Uint8Array([1]))).status, 409);
    const download = await api.GET(req(id)); assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes); assert.match(download.headers.get('content-disposition'), /attachment/); assert.match(download.headers.get('cache-control'), /no-store/);
    runtime.user = userB;
    assert.equal((await api.GET(req(id, 'GET', undefined, meta, b.id))).status, 404);
    assert.equal((await api.GET(req(id))).status, 401);
    assert.equal((await api.PUT(req(id, 'PUT', { ...meta, baseRevision: saved.updated_at }, meta, b.id))).status, 404);
    assert.equal((await exporter.GET(new Request('https://edu.example/api/export?account=' + a.id))).status, 401);
    runtime.user = userA;
  });
  await t.test('pending uploads survive failure, block export, resume, and can still be cancelled', async () => {
    const pending = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; uploadFails = true;
    assert.equal((await upload(pending)).status, 503); uploadFails = false;
    assert.equal((await sql('select state from user_files where profile_id=$1 and id=$2', [a.id, pending])).rows[0].state, 'pending');
    const pendingExport = await exporter.GET(new Request('https://edu.example/api/export'));
    assert.equal(pendingExport.status, 409, await pendingExport.clone().text());
    assert.equal((await upload(pending)).status, 201);
    const file = (await (await api.GET(req())).json()).files.find((f) => f.id === pending);
    assert.equal(file.state, 'ready');

    const cancelled = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef'; uploadFails = true;
    assert.equal((await upload(cancelled)).status, 503); uploadFails = false;
    const pendingFile = (await (await api.GET(req())).json()).files.find((f) => f.id === cancelled);
    deleteFails = true;
    assert.equal((await api.DELETE(req(cancelled, 'DELETE', { baseRevision: pendingFile.updated_at }))).status, 503);
    deleteFails = false;
    assert.equal((await sql('select state from user_files where profile_id=$1 and id=$2', [a.id, cancelled])).rows[0].state, 'deleting');
    assert.equal((await api.DELETE(req(cancelled, 'DELETE', { baseRevision: pendingFile.updated_at }))).status, 200);
    assert.equal((await upload(cancelled)).status, 409);
    assert.equal((await api.GET(req(cancelled))).status, 404);
    assert.equal((await sql('select deleted_at is not null as deleted from user_files where profile_id=$1 and id=$2', [a.id, cancelled])).rows[0].deleted, true);
  });
  await t.test('file edits reject stale revisions and Personal assignment links survive workspace saves', async () => {
    const changed = await api.PUT(req(id, 'PUT', { ...meta, name: 'Renamed.txt', baseRevision: saved.updated_at })); assert.equal(changed.status, 200);
    assert.equal((await api.DELETE(req(id, 'DELETE', { baseRevision: saved.updated_at }))).status, 409);
    saved = (await changed.json()).file;
    const current = await getWorkspace(); const dashboard = { ...current.dashboard, d: { ...current.dashboard.d, assignments: [{ id: 'personal', courseId: '', title: 'Personal reading', dateKey: '2026-09-07', due: '', type: 'Assignment', status: 'later', progress: 0 }] } };
    const save = async (doc) => sql('select save_account_workspace($1,$2,$3,$4,$5)', [a.id, userA, (await getWorkspace()).revision, JSON.stringify(current.courses), JSON.stringify(doc)]);
    await save(dashboard);
    const attached = await api.PUT(req(id, 'PUT', { ...meta, assignmentId: 'personal', kind: 'attachment', baseRevision: saved.updated_at })); assert.equal(attached.status, 200); saved = (await attached.json()).file;
    await save(dashboard); assert.equal((await sql('select assignment_id from user_files where profile_id=$1 and id=$2', [a.id, id])).rows[0].assignment_id, 'personal');
    await save(current.dashboard); assert.equal((await sql('select assignment_id from user_files where profile_id=$1 and id=$2', [a.id, id])).rows[0].assignment_id, null);
  });
  await t.test('syllabus references validate ownership and require explicit detach before deletion', async () => {
    assert.equal((await upload(sourceId, { ...meta, kind: 'syllabus' })).status, 201);
    const current = await getWorkspace(); const doc = { ...current.dashboard, d: { ...current.dashboard.d, syllabusDrafts: [{ sourceFileId: sourceId }] } };
    const save = (owner, user, revision, dashboard) => sql('select save_account_workspace($1,$2,$3,$4,$5)', [owner, user, revision, '[]', JSON.stringify(dashboard)]);
    await save(a.id, userA, current.revision, doc);
    const source = (await (await api.GET(req())).json()).files.find((f) => f.id === sourceId);
    const denied = await api.DELETE(req(sourceId, 'DELETE', { baseRevision: source.updated_at })); assert.equal(denied.status, 409); assert.match((await denied.json()).error, /Detach/);
    const foreignRevision = (await sql('select updated_at from dashboard_state where profile_id=$1', [b.id])).rows[0].updated_at;
    await assert.rejects(save(b.id, userB, foreignRevision, doc), { code: '23503' });
    const course = { id: 'approved', code: 'BIO', name: 'Biology', credits: 3, instructor: '', room: '', color: '#123456', soft_color: '#ffffff', initials: 'BI' };
    const approved = { ...current.dashboard, d: { ...current.dashboard.d, courseDetails: { approved: { syllabusFileId: sourceId } }, syllabusDrafts: [] } };
    await sql('select save_account_workspace($1,$2,$3,$4,$5)', [a.id, userA, (await getWorkspace()).revision, JSON.stringify([course]), JSON.stringify(approved)]);
    assert.equal((await sql('select course_id from user_files where profile_id=$1 and id=$2', [a.id, sourceId])).rows[0].course_id, 'approved');
    assert.equal((await api.DELETE(req(sourceId, 'DELETE', { baseRevision: source.updated_at }))).status, 409);
    await save(a.id, userA, (await getWorkspace()).revision, current.dashboard);
    const detached = (await (await api.GET(req())).json()).files.find((f) => f.id === sourceId);
    assert.equal(detached.course_id, null);
    const removesBeforeTrash = storageRemoves.length;
    const trashed = await api.DELETE(req(sourceId, 'DELETE', { baseRevision: detached.updated_at }));
    assert.equal(trashed.status, 200);
    const trashResult = await trashed.json();
    assert.ok(trashResult.file.trashed_at);
    assert.equal(storageRemoves.length, removesBeforeTrash, 'ordinary ready-file DELETE retains the uploaded bytes');
    assert.equal((await api.GET(req(sourceId))).status, 404);
    const trashList = await api.GET(new Request('https://edu.example/api/files?view=trash', { headers: { 'x-profile-id': a.id } }));
    assert.ok((await trashList.json()).files.some((f) => f.id === sourceId));
    const workspaceBeforeStaleReference = await getWorkspace();
    const staleReference = { ...workspaceBeforeStaleReference.dashboard, d: {
      ...workspaceBeforeStaleReference.dashboard.d,
      syllabusDrafts: [...(workspaceBeforeStaleReference.dashboard.d.syllabusDrafts ?? []), { sourceFileId: sourceId }],
    } };
    await assert.rejects(sql('select save_account_workspace($1,$2,$3,$4,$5)', [
      a.id, userA, workspaceBeforeStaleReference.revision, JSON.stringify(workspaceBeforeStaleReference.courses), JSON.stringify(staleReference),
    ]), { code: '23503' }, 'a workspace save cannot attach a trashed syllabus through a stale reference');
    assert.deepEqual(await getWorkspace(), workspaceBeforeStaleReference, 'the rejected reference leaves the workspace unchanged');
    const restored = await actions.POST(apiRequest('/api/files/actions', 'POST', { action: 'restore', items: [{ type: 'file', id: sourceId, revision: trashResult.file.metadata_revision }] }));
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).files[0].trashed_at, null);
    const restoredMetadata = (await (await api.GET(req())).json()).files.find((f) => f.id === sourceId);
    assert.deepEqual(new Uint8Array(await (await api.GET(req(sourceId))).arrayBuffer()), bytes);
    assert.equal((await api.DELETE(req(sourceId, 'DELETE', { baseRevision: restoredMetadata.updated_at }))).status, 200);
  });

  await t.test('folder and document APIs enforce session ownership, safe response fields, and UTF-8 content limits', async () => {
    runtime.user = userB;
    const foreignFolderResponse = await folders.POST(apiRequest('/api/file-folders', 'POST', { id: foreignFolderId, name: 'B private folder' }, b.id));
    assert.equal(foreignFolderResponse.status, 201);
    assertPublic(await foreignFolderResponse.json());
    const foreignDocResponse = await documents.POST(apiRequest(`/api/file-documents?id=${foreignDocumentId}`, 'POST', { name: 'B private.txt', body: 'B secret', folderId: foreignFolderId }, b.id));
    assert.equal(foreignDocResponse.status, 201);
    assertPublic(await foreignDocResponse.json());
    runtime.user = userA;

    assert.equal((await folders.POST(apiRequest('/api/file-folders', 'POST', { id: ownFolderId, name: 'Spoofed owner', profile_id: b.id }))).status, 400);
    assert.equal((await sql('select count(*)::int as count from file_folders where profile_id=$1 and id=$2', [a.id, ownFolderId])).rows[0].count, 0);
    assert.equal((await folders.POST(apiRequest('/api/file-folders', 'POST', { name: 'Wrong origin' }, a.id, 'https://attacker.example'))).status, 403);

    const ownFolderResponse = await folders.POST(apiRequest('/api/file-folders', 'POST', { id: ownFolderId, name: 'Archived Δ notes' }));
    assert.equal(ownFolderResponse.status, 201);
    const ownFolder = (await ownFolderResponse.json()).folder;
    assert.equal(ownFolder.parent_id, null); assert.equal(ownFolder.kind, 'custom'); assert.equal(ownFolder.revision, 1);
    assertPublic(ownFolder);
    const childResponse = await folders.POST(apiRequest('/api/file-folders', 'POST', { id: childFolderId, name: 'Nested', parentId: ownFolderId }));
    assert.equal(childResponse.status, 201);
    const childFolder = (await childResponse.json()).folder;
    assert.equal(childFolder.parent_id, ownFolderId);
    assert.equal((await folders.POST(apiRequest('/api/file-folders', 'POST', { name: 'Foreign parent', parentId: foreignFolderId }))).status, 404);
    const nested = await folders.GET(apiRequest(`/api/file-folders?parentId=${ownFolderId}`));
    assert.deepEqual((await nested.json()).folders.map((folder) => folder.id), [childFolderId]);
    const workspaceBeforeCourse = await getWorkspace();
    const courseForFolderApi = { id: 'files-course', code: 'FILE 100', name: 'Files course', credits: 2, instructor: '', room: '', color: '#225577', soft_color: '#22557718', initials: 'FL' };
    const sqlCourses = [
      ...workspaceBeforeCourse.courses.map(({ soft, ...course }) => ({ ...course, soft_color: soft })),
      courseForFolderApi,
    ];
    await sql('select save_account_workspace($1,$2,$3,$4,$5)', [a.id, userA, workspaceBeforeCourse.revision, JSON.stringify(sqlCourses), JSON.stringify(workspaceBeforeCourse.dashboard)]);
    const savedCourse = (await sql('select id,code from courses where profile_id=$1 and id=$2', [a.id, courseForFolderApi.id])).rows[0];
    const savedCourseFolder = (await sql("select id,course_code from file_folders where profile_id=$1 and kind='course' and course_id=$2", [a.id, savedCourse.id])).rows[0];
    assert.ok(savedCourseFolder);
    assert.equal(savedCourseFolder.course_code, savedCourse.code);
    const folderList = await folders.GET(apiRequest('/api/file-folders'));
    const folderListData = await folderList.json();
    assertPublic(folderListData);
    assert.ok(folderListData.folders.some((folder) => folder.id === ownFolderId));
    assert.ok(!folderListData.folders.some((folder) => folder.id === foreignFolderId));
    assert.equal(folderListData.folders.find((folder) => folder.id === savedCourseFolder.id)?.course_code, savedCourse.code,
      'the folder API returns the managed course code as secondary display metadata');

    const docBody = 'Quotes: "hello"\\world\nUnicode: résumé — 日本語 — 😀\n';
    const bodySpoof = await documents.POST(apiRequest(`/api/file-documents?id=${textDocumentId}`, 'POST', { name: 'Spoof.txt', body: 'x', auth_user_id: userB }));
    assert.equal(bodySpoof.status, 400);
    assert.equal((await documents.POST(apiRequest('/api/file-documents?id=24242424-2424-4424-8424-242424242424', 'POST', { name: 'Foreign folder.txt', body: 'x', folderId: foreignFolderId }))).status, 404);
    assert.equal((await documents.POST(apiRequest(`/api/file-documents?id=${textDocumentId}`, 'POST', { name: 'Wrong origin.txt', body: 'x' }, a.id, 'https://attacker.example'))).status, 403);
    assert.equal((await documents.GET(apiRequest(`/api/file-documents?id=${foreignDocumentId}`))).status, 404);
    assert.equal((await documents.GET(apiRequest(`/api/file-documents?id=${foreignDocumentId}`, 'GET', undefined, b.id))).status, 401,
      'a request scoped to another signed-in account is rejected');

    const created = await documents.POST(apiRequest(`/api/file-documents?id=${textDocumentId}`, 'POST', { name: 'Working notes', body: docBody, folderId: ownFolderId }));
    assert.equal(created.status, 201);
    const createdData = await created.json();
    assert.equal(createdData.document.body, docBody);
    assert.equal(createdData.document.content_revision, 1);
    assert.equal(createdData.file.content_backend, 'native-text');
    assert.equal(createdData.file.size_bytes, Buffer.byteLength(docBody, 'utf8'));
    assert.equal(createdData.file.folder_id, ownFolderId);
    assert.equal(createdData.file.content_revision, 1);
    assert.equal(createdData.file.metadata_revision, 1);
    assertPublic(createdData);

    const beforeRead = storageReads.length;
    const nativeDownload = await api.GET(req(textDocumentId));
    assert.equal(nativeDownload.status, 200);
    assert.deepEqual(new Uint8Array(await nativeDownload.arrayBuffer()), new TextEncoder().encode(docBody));
    assert.match(nativeDownload.headers.get('content-disposition'), /Working%20notes\.txt/);
    assert.equal(storageReads.length, beforeRead, 'native document downloads never consult private object storage');
    const loaded = await documents.GET(apiRequest(`/api/file-documents?id=${textDocumentId}`));
    assert.deepEqual((await loaded.json()).document, createdData.document);
    assertPublic(await (await api.GET(req())).json());

    const exactBody = 'é'.repeat(524288);
    const exact = await documents.POST(apiRequest(`/api/file-documents?id=${largeDocumentId}`, 'POST', { name: 'Exact limit', body: exactBody }));
    assert.equal(exact.status, 201, '1 MiB of UTF-8 text is accepted even though JSON adds framing bytes');
    const exactData = await exact.json();
    assert.equal(exactData.file.size_bytes, 1_048_576);
    const tooLarge = 'é'.repeat(524289);
    const rejected = await documents.POST(apiRequest('/api/file-documents?id=23232323-2323-4323-8323-232323232323', 'POST', { name: 'Over limit', body: tooLarge }));
    assert.equal(rejected.status, 413);

    const contentSave = await documents.PUT(apiRequest(`/api/file-documents?id=${textDocumentId}`, 'PUT', { action: 'update_content', body: 'Second body ✨', baseContentRevision: 1 }));
    assert.equal(contentSave.status, 200);
    const contentSaved = await contentSave.json();
    assert.equal(contentSaved.file.content_revision, 2);
    assert.equal(contentSaved.file.metadata_revision, 1);
    assert.equal(contentSaved.document.body, 'Second body ✨');

    const renamed = await api.PUT(req(textDocumentId, 'PUT', { ...meta, name: 'Renamed native document', baseRevision: contentSaved.file.updated_at }));
    assert.equal(renamed.status, 200);
    const renameData = (await renamed.json()).file;
    assert.equal(renameData.name, 'Renamed native document');
    assert.equal(renameData.folder_id, ownFolderId, 'omitting folderId from an older metadata client preserves the saved location');
    assert.equal(renameData.content_revision, 2, 'metadata edits do not advance the document content revision');
    assert.equal(renameData.metadata_revision, 2, 'metadata and content revisions advance independently');
    const saveAfterRename = await documents.PUT(apiRequest(`/api/file-documents?id=${textDocumentId}`, 'PUT', { action: 'update_content', body: 'Saved after rename', baseContentRevision: 2 }));
    assert.equal(saveAfterRename.status, 200, 'a metadata rename does not stale the independent content revision');
    const afterRenameSave = await saveAfterRename.json();
    assert.equal(afterRenameSave.file.metadata_revision, 2);
    assert.equal(afterRenameSave.file.content_revision, 3);
    assert.equal(afterRenameSave.file.folder_id, ownFolderId);
    assert.equal(afterRenameSave.document.body, 'Saved after rename');
    assertPublic(afterRenameSave);

    const largeTrash = await api.DELETE(req(largeDocumentId, 'DELETE', { baseRevision: exactData.file.updated_at }));
    assert.equal(largeTrash.status, 200);
    const largeTrashFile = (await largeTrash.json()).file;
    const largePermanent = await actions.POST(apiRequest('/api/files/actions', 'POST', { action: 'permanent-delete', items: [{ type: 'file', id: largeDocumentId, revision: largeTrashFile.metadata_revision }] }));
    assert.equal(largePermanent.status, 200);
    assert.equal((await sql('select count(*)::int as count from native_file_documents where profile_id=$1 and file_id=$2', [a.id, largeDocumentId])).rows[0].count, 0,
      'permanent native deletion purges the database body after the tombstone is finalized');
  });

  await t.test('batch actions validate atomically, restore locations, and reserve physical deletion for trashed files', async () => {
    assert.equal((await upload(atomicFirstId, { ...meta, name: 'Atomic first.txt', folderId: ownFolderId })).status, 201);
    assert.equal((await upload(atomicSecondId, { ...meta, name: 'Atomic second.txt', folderId: ownFolderId })).status, 201);
    const activeFiles = (await (await api.GET(req())).json()).files;
    const first = activeFiles.find((file) => file.id === atomicFirstId);
    const second = activeFiles.find((file) => file.id === atomicSecondId);
    const secondRename = await api.PUT(req(atomicSecondId, 'PUT', { ...meta, name: 'Atomic second renamed.txt', folderId: ownFolderId, baseRevision: second.updated_at }));
    assert.equal(secondRename.status, 200);
    const secondRenamed = (await secondRename.json()).file;

    const staleBatch = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'trash', items: [
        { type: 'file', id: atomicFirstId, revision: first.metadata_revision },
        { type: 'file', id: atomicSecondId, revision: second.metadata_revision },
      ],
    }));
    assert.equal(staleBatch.status, 409, 'a stale second item rejects the whole batch');
    const afterRollback = (await sql('select id,trashed_at,folder_id from user_files where profile_id=$1 and id=any($2::uuid[]) order by id', [a.id, [atomicFirstId, atomicSecondId]])).rows;
    assert.ok(afterRollback.every((file) => file.trashed_at === null && file.folder_id === ownFolderId),
      'the valid first item stays active when the second item is stale');
    assert.equal((await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'move', destinationId: foreignFolderId, items: [{ type: 'file', id: atomicFirstId, revision: first.metadata_revision }],
    }))).status, 404, 'a foreign destination is not disclosed or accepted');
    assert.equal((await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'trash', profile_id: b.id, items: [{ type: 'file', id: atomicFirstId, revision: first.metadata_revision }],
    }))).status, 400, 'the signed-in profile cannot be overridden by a request body');

    const trashedBatch = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'trash', items: [
        { type: 'file', id: atomicFirstId, revision: first.metadata_revision },
        { type: 'file', id: atomicSecondId, revision: secondRenamed.metadata_revision },
      ],
    }));
    assert.equal(trashedBatch.status, 200);
    const trashedFiles = (await trashedBatch.json()).files;
    assertPublic(trashedFiles);
    assert.equal(trashedFiles.length, 2);
    assert.ok(trashedFiles.every((file) => file.trashed_at && file.folder_id === null));
    const restoreOriginal = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'restore', items: [{ type: 'file', id: atomicFirstId, revision: trashedFiles.find((file) => file.id === atomicFirstId).metadata_revision }],
    }));
    assert.equal(restoreOriginal.status, 200);
    assert.equal((await restoreOriginal.json()).files[0].folder_id, ownFolderId,
      'omitting destinationId restores to the saved original folder when it is active');
    const restoreAtRoot = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'restore', destinationId: null,
      items: [{ type: 'file', id: atomicSecondId, revision: trashedFiles.find((file) => file.id === atomicSecondId).metadata_revision }],
    }));
    assert.equal(restoreAtRoot.status, 200);
    assert.equal((await restoreAtRoot.json()).files[0].folder_id, null,
      'explicit destinationId:null restores the file to the Files root');

    const activeAfterRestore = (await (await api.GET(req())).json()).files;
    const moveBatch = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'move', destinationId: childFolderId,
      items: [atomicFirstId, atomicSecondId].map((id) => ({
        type: 'file', id, revision: activeAfterRestore.find((file) => file.id === id).metadata_revision,
      })),
    }));
    assert.equal(moveBatch.status, 200, `a valid multi-file move commits as one action: ${await moveBatch.clone().text()}`);
    const movedFiles = (await moveBatch.json()).files;
    assertPublic(movedFiles);
    assert.equal(movedFiles.length, 2);
    assert.ok(movedFiles.every((file) => file.folder_id === childFolderId));
    const movedBackBatch = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'move', destinationId: ownFolderId,
      items: movedFiles.map((file) => ({ type: 'file', id: file.id, revision: file.metadata_revision })),
    }));
    assert.equal(movedBackBatch.status, 200, 'a second valid multi-file move can leave the destination folder empty');
    assert.ok((await movedBackBatch.json()).files.every((file) => file.folder_id === ownFolderId));

    const child = (await (await folders.GET(apiRequest('/api/file-folders'))).json()).folders.find((folder) => folder.id === childFolderId);
    const trashedFolderResponse = await folders.DELETE(apiRequest(`/api/file-folders?id=${childFolderId}`, 'DELETE', { revision: child.revision }));
    assert.equal(trashedFolderResponse.status, 200);
    const trashedFolder = (await trashedFolderResponse.json()).folder;
    assert.ok(trashedFolder.trashed_at);
    assert.ok((await (await folders.GET(apiRequest('/api/file-folders?view=trash'))).json()).folders.some((folder) => folder.id === childFolderId));
    const restoredFolderResponse = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'restore', destinationId: ownFolderId,
      items: [{ type: 'folder', id: childFolderId, revision: trashedFolder.revision }],
    }));
    assert.equal(restoredFolderResponse.status, 200);
    const restoredFolder = (await restoredFolderResponse.json()).folders[0];
    assert.equal(restoredFolder.trashed_at, null);
    assert.equal(restoredFolder.parent_id, ownFolderId);
    assertPublic(restoredFolder);
    const trashedAgainResponse = await folders.DELETE(apiRequest(`/api/file-folders?id=${childFolderId}`, 'DELETE', { revision: restoredFolder.revision }));
    assert.equal(trashedAgainResponse.status, 200);
    const trashedAgainFolder = (await trashedAgainResponse.json()).folder;
    const folderRestoreAtRoot = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'restore', destinationId: null,
      items: [{ type: 'folder', id: childFolderId, revision: trashedAgainFolder.revision }],
    }));
    assert.equal(folderRestoreAtRoot.status, 200);
    const rootRestoredFolder = (await folderRestoreAtRoot.json()).folders[0];
    assert.equal(rootRestoredFolder.trashed_at, null);
    assert.equal(rootRestoredFolder.parent_id, null, 'explicit destinationId:null restores a folder to the organization root');
    const folderMoveBack = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'move', destinationId: ownFolderId,
      items: [{ type: 'folder', id: childFolderId, revision: rootRestoredFolder.revision }],
    }));
    assert.equal(folderMoveBack.status, 200, `moving the restored folder back under its existing parent should succeed: ${await folderMoveBack.clone().text()}`);
    assert.equal((await folderMoveBack.json()).folders[0].parent_id, ownFolderId,
      'the explicit-root restore fixture returns under its original parent');

    const removeFixture = async (fileId) => {
      const file = (await (await api.GET(req())).json()).files.find((item) => item.id === fileId);
      const deleted = await api.DELETE(req(fileId, 'DELETE', { baseRevision: file.updated_at }));
      assert.equal(deleted.status, 200);
      return (await deleted.json()).file;
    };
    const firstTrash = await removeFixture(atomicFirstId);
    const secondTrash = await removeFixture(atomicSecondId);
    const cleanupBatch = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'permanent-delete', items: [
        { type: 'file', id: atomicFirstId, revision: firstTrash.metadata_revision },
        { type: 'file', id: atomicSecondId, revision: secondTrash.metadata_revision },
      ],
    }));
    assert.equal(cleanupBatch.status, 200);
    assert.equal((await sql('select count(*)::int as count from user_files where profile_id=$1 and id=any($2::uuid[]) and deleted_at is not null', [a.id, [atomicFirstId, atomicSecondId]])).rows[0].count, 2);

    assert.equal((await upload(trashFileId, { ...meta, name: 'Recoverable upload.txt', folderId: ownFolderId })).status, 201);
    const trashCandidate = (await (await api.GET(req())).json()).files.find((file) => file.id === trashFileId);
    const activePermanent = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'permanent-delete', items: [{ type: 'file', id, revision: saved.metadata_revision }],
    }));
    assert.equal(activePermanent.status, 400, 'an active file cannot enter permanent cleanup');
    const removalsBeforeOrdinaryDelete = storageRemoves.length;
    const ordinaryDelete = await api.DELETE(req(trashFileId, 'DELETE', { baseRevision: trashCandidate.updated_at }));
    assert.equal(ordinaryDelete.status, 200);
    const trashedCandidate = (await ordinaryDelete.json()).file;
    assert.equal(trashedCandidate.state, 'ready');
    assert.ok(trashedCandidate.trashed_at);
    assert.equal(storageRemoves.length, removalsBeforeOrdinaryDelete);
    const repeatedDelete = await api.DELETE(req(trashFileId, 'DELETE', { baseRevision: trashCandidate.updated_at }));
    assert.equal(repeatedDelete.status, 200);
    assert.equal(storageRemoves.length, removalsBeforeOrdinaryDelete, 'repeated ready-file DELETE never removes bytes');
    assert.equal((await api.GET(req(trashFileId))).status, 404);
    assert.ok(!(await (await api.GET(req())).json()).files.some((file) => file.id === trashFileId));
    assert.ok((await (await api.GET(new Request('https://edu.example/api/files?view=trash', { headers: { 'x-profile-id': a.id } }))).json()).files.some((file) => file.id === trashFileId));

    deleteFails = true;
    const failedPermanent = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'permanent-delete', requestId: '31313131-3131-4131-8131-313131313131', items: [{ type: 'file', id: trashFileId, revision: trashedCandidate.metadata_revision }],
    }));
    assert.equal(failedPermanent.status, 503);
    deleteFails = false;
    const interrupted = (await sql('select state,trashed_at,deleted_at from user_files where profile_id=$1 and id=$2', [a.id, trashFileId])).rows[0];
    assert.equal(interrupted.state, 'deleting'); assert.ok(interrupted.trashed_at); assert.equal(interrupted.deleted_at, null);
    assert.ok(objects.has(`${a.id}/${trashFileId}`), 'failed physical cleanup retains the uploaded bytes for retry');
    const retriedPermanent = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'permanent-delete', requestId: '31313131-3131-4131-8131-313131313131', items: [{ type: 'file', id: trashFileId, revision: trashedCandidate.metadata_revision }],
    }));
    assert.equal(retriedPermanent.status, 200);
    const tombstone = (await sql('select state,trashed_at,deleted_at from user_files where profile_id=$1 and id=$2', [a.id, trashFileId])).rows[0];
    assert.equal(tombstone.state, 'deleting'); assert.ok(tombstone.trashed_at); assert.ok(tombstone.deleted_at);
    assert.ok(!objects.has(`${a.id}/${trashFileId}`));
    assert.equal((await upload(trashFileId, { ...meta, name: 'Recoverable upload.txt', folderId: ownFolderId })).status, 409,
      'a permanent tombstone cannot be reused or become recoverable Trash');

    assert.equal((await upload(partialDeleteFirstId, { ...meta, name: 'Delete batch first.txt' })).status, 201);
    assert.equal((await upload(partialDeleteSecondId, { ...meta, name: 'Delete batch second.txt' })).status, 201);
    const beforePartialTrash = (await (await api.GET(req())).json()).files;
    const firstPartial = beforePartialTrash.find((file) => file.id === partialDeleteFirstId);
    const secondPartial = beforePartialTrash.find((file) => file.id === partialDeleteSecondId);
    const partialTrash = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'trash', items: [
        { type: 'file', id: partialDeleteFirstId, revision: firstPartial.metadata_revision },
        { type: 'file', id: partialDeleteSecondId, revision: secondPartial.metadata_revision },
      ],
    }));
    assert.equal(partialTrash.status, 200);
    const partialTrashed = (await partialTrash.json()).files;
    const retryItems = partialTrashed.map((file) => ({ type: 'file', id: file.id, revision: file.metadata_revision }));
    deleteFailPath = `${a.id}/${partialDeleteSecondId}`;
    const partialPermanent = await actions.POST(apiRequest('/api/files/actions', 'POST', { action: 'permanent-delete', requestId: '32323232-3232-4232-8232-323232323232', items: retryItems }));
    assert.equal(partialPermanent.status, 503, 'the second storage removal fails after the first item is finalized');
    deleteFailPath = null;
    const partialStates = (await sql('select id,state,trashed_at,deleted_at from user_files where profile_id=$1 and id=any($2::uuid[]) order by id', [a.id, [partialDeleteFirstId, partialDeleteSecondId]])).rows;
    assert.equal(partialStates[0].deleted_at !== null, true, 'the first file has its permanent tombstone');
    assert.equal(partialStates[1].state, 'deleting'); assert.ok(partialStates[1].trashed_at); assert.equal(partialStates[1].deleted_at, null);
    assert.ok(!objects.has(`${a.id}/${partialDeleteFirstId}`));
    assert.ok(objects.has(`${a.id}/${partialDeleteSecondId}`));
    const partialRetry = await actions.POST(apiRequest('/api/files/actions', 'POST', { action: 'permanent-delete', requestId: '32323232-3232-4232-8232-323232323232', items: retryItems }));
    assert.equal(partialRetry.status, 200, 'retrying the identical batch tolerates its already-finalized first tombstone');
    const partialFinal = (await sql('select id,state,deleted_at from user_files where profile_id=$1 and id=any($2::uuid[]) order by id', [a.id, [partialDeleteFirstId, partialDeleteSecondId]])).rows;
    assert.ok(partialFinal.every((file) => file.state === 'deleting' && file.deleted_at));
    assert.ok(!objects.has(`${a.id}/${partialDeleteSecondId}`));
  });

  await t.test('archived folder labels and recoverable native document state persist through the API', async () => {
    const snapshotBody = 'Captured body at revision one\n';
    const recoverableBody = 'Recoverable native text from Trash\n';
    const snapshotCreate = await documents.POST(apiRequest(`/api/file-documents?id=${snapshotDocumentId}`, 'POST', {
      // Keep the concurrent-edit fixture active while the other originals
      // exercise archive export. Archived contents deliberately reject edits.
      name: 'Snapshot notes', body: snapshotBody, folderId: null,
    }));
    assert.equal(snapshotCreate.status, 201);
    const snapshotFile = (await snapshotCreate.json()).file;
    assert.equal(snapshotFile.content_revision, 1);
    const recoverableId = '25252525-2525-4525-8525-252525252525';
    const recoverableCreate = await documents.POST(apiRequest(`/api/file-documents?id=${recoverableId}`, 'POST', {
      name: 'Recoverable native', body: recoverableBody, folderId: ownFolderId,
    }));
    assert.equal(recoverableCreate.status, 201);
    const recoverableFile = (await recoverableCreate.json()).file;
    const currentFolderRevision = Number((await sql('select revision from file_folders where profile_id=$1 and id=$2', [a.id, ownFolderId])).rows[0].revision);
    const archiveResponse = await folders.PUT(apiRequest('/api/file-folders', 'PUT', {
      id: ownFolderId, action: 'archive', revision: currentFolderRevision, semesterLabel: 'Fall 2026',
    }));
    assert.equal(archiveResponse.status, 200);
    const archivedFolder = (await archiveResponse.json()).folder;
    assert.equal(archivedFolder.semester_label, 'Fall 2026');
    assert.ok(archivedFolder.archived_at);
    assert.ok(!(await (await folders.GET(apiRequest('/api/file-folders?view=active'))).json()).folders.some((folder) => folder.id === ownFolderId));
    assert.ok((await (await folders.GET(apiRequest('/api/file-folders?view=archives'))).json()).folders.some((folder) => folder.id === ownFolderId));

    const recoverableTrash = await actions.POST(apiRequest('/api/files/actions', 'POST', {
      action: 'trash', items: [{ type: 'file', id: recoverableId, revision: recoverableFile.metadata_revision }],
    }));
    assert.equal(recoverableTrash.status, 200);
    const trashedNative = (await recoverableTrash.json()).files[0];
    assert.equal(trashedNative.original_folder_id, ownFolderId);
    assert.ok(trashedNative.trashed_at);
  });
  await t.test('export includes the coherent account snapshot and verified uploaded bytes; corruption fails the stream', async () => {
    // Earlier foundation test created a pending metadata fixture without bytes.
    await sql("delete from user_files where profile_id=$1 and state='pending' and content_sha256 is null", [a.id]);
    const snapshotBody = 'Captured body at revision one\n';
    let snapshotRevision;
    runtime.afterExportSnapshot = async (snapshot) => {
      runtime.afterExportSnapshot = null;
      const document = snapshot.documents.find((item) => item.file_id === snapshotDocumentId);
      assert.ok(document);
      snapshotRevision = document.content_revision;
      assert.equal(document.body, snapshotBody);
      await sql('select mutate_account_document($1,$2,$3,$4,$5,$6)', [
        a.id, userA, snapshotDocumentId, 'update_content', snapshotRevision, JSON.stringify({ body: 'Current body after export snapshot\n' }),
      ]);
    };
    const response = await exporter.GET(new Request('https://edu.example/api/export'));
    assert.equal(response.status, 200);
    const archive = parseZip(Buffer.from(await response.arrayBuffer()));
    const manifest = JSON.parse(archive.get('account.json').toString());
    assert.equal(manifest.profile.id, a.id);
    const preservedSyllabusIds = (await sql("select id from user_files where profile_id=$1 and name='history.txt' and content_backend='native-text' and deleted_at is null", [a.id])).rows.map((row) => row.id);
    assert.equal(preservedSyllabusIds.length, 1, 'the earlier class removal preserved its syllabus as native content');
    const expectedIds = [id, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', sourceId, textDocumentId, snapshotDocumentId, '25252525-2525-4525-8525-252525252525', ...preservedSyllabusIds].sort();
    assert.deepEqual(manifest.files.map((file) => file.id).sort(), expectedIds,
      'account export includes all active files and recoverable Trash, while permanent tombstones stay excluded');
    assertPublic({ files: manifest.files, folders: manifest.folders });
    const uploadEntry = manifest.files.find((file) => file.id === id);
    assert.deepEqual(new Uint8Array(archive.get(uploadEntry.archivePath)), bytes);
    const syllabusEntry = manifest.files.find((file) => file.id === sourceId);
    assert.deepEqual(new Uint8Array(archive.get(syllabusEntry.archivePath)), bytes, 'detached syllabus content remains exportable from Trash');
    const snapshotEntry = manifest.files.find((file) => file.id === snapshotDocumentId);
    assert.equal(snapshotEntry.content_revision, snapshotRevision);
    assert.deepEqual(new Uint8Array(archive.get(snapshotEntry.archivePath)), new TextEncoder().encode(snapshotBody),
      'export content matches the revision captured in the manifest after the live document changes');
    const recoverableEntry = manifest.files.find((file) => file.id === '25252525-2525-4525-8525-252525252525');
    assert.ok(recoverableEntry.trashed_at);
    assert.deepEqual(new Uint8Array(archive.get(recoverableEntry.archivePath)), new TextEncoder().encode('Recoverable native text from Trash\n'));
    assert.ok(manifest.folders.some((folder) => folder.id === ownFolderId && folder.semester_label === 'Fall 2026'));
    const exportCourse = (await sql('select id,code from courses where profile_id=$1 and id=$2', [a.id, 'files-course'])).rows[0];
    const exportCourseFolder = (await sql("select id from file_folders where profile_id=$1 and kind='course' and course_id=$2", [a.id, exportCourse.id])).rows[0];
    assert.equal(manifest.folders.find((folder) => folder.id === exportCourseFolder.id)?.course_code, exportCourse.code,
      'account export includes the managed course code');
    assert.equal(archive.has(`files/${b.id}/${foreignDocumentId}`), false);
    const current = (await sql('select f.content_revision,d.body from user_files f join native_file_documents d on d.profile_id=f.profile_id and d.file_id=f.id where f.profile_id=$1 and f.id=$2', [a.id, snapshotDocumentId])).rows[0];
    assert.equal(current.content_revision, snapshotRevision + 1);
    assert.equal(current.body, 'Current body after export snapshot\n');

    objects.set(`${a.id}/${id}`, new Uint8Array([99]));
    const corrupt = await exporter.GET(new Request('https://edu.example/api/export'));
    await assert.rejects(corrupt.arrayBuffer(), /size|content/);
  });
  await t.test('new storage functions deny all browser roles and mismatched verified identities', async () => {
    await assert.rejects(sql('select export_account($1,$2)', [a.id, userB]), { code: '42501' });
    for (const role of ['anon', 'authenticated']) {
      await sql(`set role ${role}`);
      try { await assert.rejects(sql('select export_account($1,$2)', [a.id, userA]), { code: '42501' }); await assert.rejects(sql("select mutate_account_file($1,$2,$3,'ready')", [a.id, userA, id]), { code: '42501' }); }
      finally { await sql('reset role'); }
    }
  });
}
