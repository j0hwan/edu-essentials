// Runs against real PostgreSQL functions; only object-storage transport is faked.
export async function privateFileCases({ t, assert, sql, runtime, a, b, userA, userB, compile, clientModule, authUrl, dbUrl, requestUrl, getWorkspace }) {
  const bytes = new TextEncoder().encode('Private résumé source\nWeek one reading');
  const objects = new Map(); let uploadFails = false, deleteFails = false;
  runtime.storage = { from(bucket) { assert.equal(bucket, 'eduessentials-private'); return {
    async upload(path, value) { if (uploadFails) return { error: new Error('offline') }; if (objects.has(path)) return { error: new Error('duplicate') }; objects.set(path, new Uint8Array(value)); return { error: null }; },
    async download(path) { return objects.has(path) ? { data: new Blob([objects.get(path)]) } : { error: new Error('missing') }; },
    async remove(paths) { if (deleteFails) return { error: new Error('offline') }; paths.forEach((path) => objects.delete(path)); return { error: null }; },
  }; } };
  const filesUrl = await clientModule('lib/files.ts');
  const helper = await compile('lib/private-files-server.ts', { './auth': authUrl, './supabase-server': dbUrl, './persistence-request': requestUrl, './files': filesUrl });
  const imports = { '../../../lib/private-files-server': helper, '../../../lib/files': filesUrl, '../../../lib/persistence-request': requestUrl, '../../../lib/supabase-server': dbUrl, '../../../lib/zip': await clientModule('lib/zip.ts') };
  const api = await import(await compile('app/api/files/route.ts', imports)), exporter = await import(await compile('app/api/export/route.ts', imports));
  const meta = { name: 'Résumé.txt', kind: 'resource', courseId: '', assignmentId: '' };
  const req = (id = '', method = 'GET', body, metadata = meta, account = a.id) => new Request(`https://edu.example/api/files${id ? '?id=' + id : ''}`, { method, headers: { origin: 'https://edu.example', 'x-profile-id': account, 'content-type': method === 'POST' ? 'application/octet-stream' : 'application/json', 'x-file-metadata': encodeURIComponent(JSON.stringify(metadata)) }, ...(body === undefined ? {} : { body: method === 'POST' ? body : JSON.stringify(body) }) });
  const upload = async (id, metadata = meta, content = bytes) => api.POST(req(id, 'POST', content, metadata));
  const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; let saved;
  await t.test('private upload verifies actual bytes, stable retries, owner scope and safe downloads', async () => {
    assert.equal((await upload(id)).status, 201);
    saved = (await (await api.GET(req())).json()).files.find((f) => f.id === id);
    assert.equal(saved.state, 'ready'); assert.equal(saved.mime_type, 'text/plain'); assert.match(saved.content_sha256, /^[a-f0-9]{64}$/);
    assert.equal(saved.object_path, undefined); assert.equal(objects.size, 1);
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
  await t.test('pending uploads survive failure, block complete export and resume without duplicate metadata', async () => {
    const pending = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; uploadFails = true;
    assert.equal((await upload(pending)).status, 503); uploadFails = false;
    assert.equal((await sql('select state from user_files where profile_id=$1 and id=$2', [a.id, pending])).rows[0].state, 'pending');
    assert.equal((await exporter.GET(new Request('https://edu.example/api/export'))).status, 409);
    assert.equal((await upload(pending)).status, 201);
    const file = (await (await api.GET(req())).json()).files.find((f) => f.id === pending);
    deleteFails = true; assert.equal((await api.DELETE(req(pending, 'DELETE', { baseRevision: file.updated_at }))).status, 503); deleteFails = false;
    assert.equal((await sql('select state from user_files where profile_id=$1 and id=$2', [a.id, pending])).rows[0].state, 'deleting');
    assert.equal((await api.DELETE(req(pending, 'DELETE', { baseRevision: file.updated_at }))).status, 200);
    assert.equal((await api.DELETE(req(pending, 'DELETE', { baseRevision: file.updated_at }))).status, 200);
    assert.equal((await upload(pending)).status, 409); assert.equal((await api.GET(req(pending))).status, 404);
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
    const sourceId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; assert.equal((await upload(sourceId, { ...meta, kind: 'syllabus' })).status, 201);
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
    assert.equal((await api.DELETE(req(sourceId, 'DELETE', { baseRevision: detached.updated_at }))).status, 200);
  });
  await t.test('export includes a consistent owned snapshot and verified original files; corruption fails the stream', async () => {
    // Earlier foundation test created a pending metadata fixture without bytes.
    await sql("delete from user_files where profile_id=$1 and content_sha256 is null", [a.id]);
    const response = await exporter.GET(new Request('https://edu.example/api/export'));
    assert.equal(response.status, 200); const zip = Buffer.from(await response.arrayBuffer());
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const nameLength = zip.readUInt16LE(26), length = zip.readUInt32LE(18);
    assert.equal(zip.subarray(30, 30 + nameLength).toString(), 'account.json');
    const manifest = JSON.parse(zip.subarray(30 + nameLength, 30 + nameLength + length));
    assert.equal(manifest.profile.id, a.id); assert.equal(manifest.files.length, 1); assert.equal(manifest.files[0].id, id); assert.equal(zip.includes(Buffer.from(bytes)), true); assert.equal(zip.includes(Buffer.from(b.id)), false);
    objects.set(`${a.id}/${id}`, new Uint8Array([99]));
    const corrupt = await exporter.GET(new Request('https://edu.example/api/export')); await assert.rejects(corrupt.arrayBuffer(), /verification/);
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
