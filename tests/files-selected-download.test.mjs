import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const USERS = {
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const ID = {
  root: "10101010-1010-4010-8010-101010101010",
  child: "12121212-1212-4121-8121-121212121212",
  empty: "13131313-1313-4131-8131-131313131313",
  file: "14141414-1414-4141-8141-141414141414",
  nested: "15151515-1515-4151-8151-151515151515",
  direct: "16161616-1616-4161-8161-161616161616",
  native: "17171717-1717-4171-8171-171717171717",
  corrupt: "18181818-1818-4818-8818-181818181818",
  second: "19191919-1919-4919-8919-191919191919",
  pending: "20202020-2020-4020-8020-202020202020",
  trash: "21212121-2121-4121-8121-212121212121",
  archive: "22222222-2222-4222-8222-222222222222",
  foreign: "23232323-2323-4323-8323-232323232323",
  collisionFolder: "24242424-2424-4424-8424-242424242424",
  collisionFile: "25252525-2525-4525-8525-252525252525",
  unsafe: "26262626-2626-4626-8626-262626262626",
  finalFile: "27272727-2727-4727-8727-272727272727",
  unsafeFolder: "28282828-2828-4828-8828-282828282828",
  tombstone: "29292929-2929-4929-8929-292929292929",
  pendingFolder: "30303030-3030-4030-8030-303030303030",
  pendingChild: "31313131-3131-4131-8131-313131313131",
  windowsDevice: "32323232-3232-4232-8232-323232323232",
};

const migrations = [
  "20260903000000_workspace_persistence.sql",
  "20260904000000_google_accounts.sql",
  "20260905000000_persistence_foundation.sql",
  "20260907000000_private_files.sql",
  "20260918000000_academic_ai.sql",
  "20260918010000_ai_vectors.sql",
  "20260918020000_ai_export_backfill.sql",
  "20261008000000_onboarding_details.sql",
  "20261008010000_file_organization.sql",
  "20261008020000_file_content_api.sql",
  "20261008030000_file_content_ai.sql",
  "20261008040000_managed_course_folders.sql",
  "20261008050000_syllabus_replacement.sql",
  "20261008060000_document_save_requests.sql",
  "20261008070000_folder_moves.sql",
  "20261008080000_recursive_trash.sql",
  "20261008090000_archive_integrity.sql",
  "20261009100000_selected_file_download.sql",
  "20261009110000_file_release_integrity.sql", "20261009120000_ai_file_result_fence.sql",
];

const emptyDashboard = {
  v: 2, a: "day", w: [], t: [], n: "",
  d: { assignments: [], manualEvents: [], courseDetails: {}, syllabusDrafts: [] },
};
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

async function compile(path, imports = {}) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [name, replacement] of Object.entries(imports)) source = source.replaceAll(`"${name}"`, JSON.stringify(replacement));
  return moduleUrl(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function setup() {
  const pg = new PGlite({ extensions: { vector } });
  const sql = (statement, params = []) => pg.query(statement, params, {
    parsers: { 1184: (value) => value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00") },
  });
  await pg.exec(`
    set timezone = 'UTC';
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, body bytea);
    alter table storage.objects enable row level security;
    grant usage on schema public, storage to anon, authenticated, service_role;
    grant all on storage.objects to anon, authenticated, service_role;
  `);
  for (const migration of migrations.slice(0, 2)) {
    await pg.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  }
  const profiles = {};
  for (const authId of Object.values(USERS)) {
    await sql("insert into auth.users values ($1, 'test@example.invalid', '{\"provider\":\"google\"}', '{\"name\":\"Test student\"}')", [authId]);
    profiles[authId] = (await sql("update app_profiles set onboarding_completed_at = now() where auth_user_id = $1 returning *", [authId])).rows[0];
    await sql("select initialize_account_workspace($1,$2,$3)", [profiles[authId].id, JSON.stringify([]), JSON.stringify(emptyDashboard)]);
  }
  for (const migration of migrations.slice(2)) {
    await pg.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  }

  const runtime = { profile: profiles[USERS.a], profiles, objects: new Map(), storageReads: [] };
  const admin = {
    async rpc(name, args) {
      try {
        if (name === "snapshot_account_file_selection") {
          const result = await sql("select public.snapshot_account_file_selection($1,$2,$3::jsonb) as data", [
            args.p_profile_id, args.p_auth_user_id, JSON.stringify(args.p_items),
          ]);
          return { data: result.rows[0]?.data ?? null, error: null };
        }
        if (name === "mutate_account_document") {
          const result = await sql("select public.mutate_account_document($1,$2,$3,$4,$5,$6::jsonb) as data", [
            args.p_profile_id, args.p_auth_user_id, args.p_file_id, args.p_operation,
            args.p_expected_content_revision ?? null, JSON.stringify(args.p_document ?? {}),
          ]);
          return { data: result.rows[0]?.data ?? null, error: null };
        }
        return { data: null, error: Object.assign(new Error(`Unexpected RPC ${name}`), { code: "42883" }) };
      } catch (error) {
        return { data: null, error };
      }
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "eduessentials-private");
        return {
          async download(path, _options, parameters) {
            runtime.storageReads.push(path);
            if (parameters?.signal?.aborted) throw parameters.signal.reason;
            const bytes = runtime.objects.get(path);
            return bytes
              ? { data: new Blob([bytes]), error: null }
              : { data: null, error: new Error("missing object") };
          },
        };
      },
    },
  };
  globalThis.__selectedDownloadTest = runtime;
  globalThis.__selectedDownloadAdmin = admin;

  const auth = moduleUrl(`
    export class AuthError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
    export const requireProfile = async () => globalThis.__selectedDownloadTest.profile;
    export function requireSameOrigin(request) {
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).origin !== new URL(request.url).origin) throw new AuthError("Wrong origin.", 403);
    }
    export function apiError(error) {
      return Response.json({ error: error.message }, { status: error.status ?? 503, headers: { "cache-control": "no-store" } });
    }
  `);
  const db = moduleUrl("export const getSupabaseAdmin = () => globalThis.__selectedDownloadAdmin;");
  const files = await compile("lib/files.ts");
  const organization = await compile("lib/file-organization.ts");
  const persistence = await compile("lib/persistence-request.ts");
  const content = await compile("lib/file-content.ts", { "./files": files });
  const selected = await compile("lib/files-selected-download.ts", {
    "./files": files, "./file-organization": organization, "./file-content": content,
  });
  const helper = await compile("lib/private-files-server.ts", {
    "./auth": auth, "./supabase-server": db, "./persistence-request": persistence, "./files": files,
  });
  const api = await import(await compile("app/api/files/download/route.ts", {
    "../../../../lib/private-files-server": helper,
    "../../../../lib/persistence-request": persistence,
    "../../../../lib/supabase-server": db,
    "../../../../lib/file-content": content,
    "../../../../lib/zip": await compile("lib/zip.ts"),
    "../../../../lib/files-selected-download": selected,
  }));

  const createFolder = async (profile = runtime.profile, id, name, parentId = null) => {
    const result = await sql("select public.mutate_account_folder($1,$2,'create',$3,null,$4::jsonb) as data", [
      profile.id, profile.auth_user_id, id, JSON.stringify({ name, parentId }),
    ]);
    return result.rows[0].data;
  };
  const createObject = async (profile = runtime.profile, id, name, body, folderId = null) => {
    const bytes = Buffer.from(body);
    const result = await sql("select public.mutate_account_file($1,$2,$3,'reserve',null,$4::jsonb) as data", [
      profile.id, profile.auth_user_id, id,
      JSON.stringify({
        name, kind: "attachment", courseId: "", assignmentId: "", folderId,
        mime: "application/octet-stream", size: bytes.length, sha256: digest(bytes),
      }),
    ]);
    runtime.objects.set(`${profile.id}/${id}`, new Uint8Array(bytes));
    const ready = await sql("select public.mutate_account_file($1,$2,$3,'ready',null,'{}'::jsonb) as data", [
      profile.id, profile.auth_user_id, id,
    ]);
    return ready.rows[0].data ?? result.rows[0].data;
  };
  const createDocument = async (profile = runtime.profile, id, name, body, folderId = null) => {
    const result = await sql("select public.mutate_account_document($1,$2,$3,'create',null,$4::jsonb) as data", [
      profile.id, profile.auth_user_id, id,
      JSON.stringify({ name, body, kind: "resource", courseId: "", assignmentId: "", folderId }),
    ]);
    return result.rows[0].data;
  };
  const updateDocument = async (profile, file, body) => {
    const result = await sql("select public.mutate_account_document($1,$2,$3,'update_content',$4,$5::jsonb) as data", [
      profile.id, profile.auth_user_id, file.id, file.content_revision, JSON.stringify({ body }),
    ]);
    return result.rows[0].data;
  };
  const row = async (table, profile, id) => (await sql(`select * from public.${table} where profile_id=$1 and id=$2`, [profile.id, id])).rows[0];
  const request = (body, options = {}) => new Request("https://edu.example/api/files/download", {
    method: "POST",
    headers: { origin: "https://edu.example", "x-profile-id": options.profileId ?? runtime.profile.id, "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return { pg, sql, runtime, profiles, api, createFolder, createObject, createDocument, updateDocument, row, request };
}

async function zipEntries(response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const end = dataStart + size;
    entries.push({
      name: bytes.toString("utf8", nameStart, nameStart + nameLength),
      body: bytes.subarray(dataStart, end),
    });
    offset = end;
  }
  return entries;
}

test("selected downloads snapshot, validate, deduplicate, sanitize, and stream files", async (t) => {
  const fixture = await setup();
  t.after(async () => {
    delete globalThis.__selectedDownloadTest;
    delete globalThis.__selectedDownloadAdmin;
    await fixture.pg.close();
  });
  const { sql, runtime, profiles, api, createFolder, createObject, createDocument, updateDocument, row, request } = fixture;
  const own = runtime.profile;
  const root = await createFolder(own, ID.root, "Study");
  const child = await createFolder(own, ID.child, "Week 1", root.id);
  await createFolder(own, ID.empty, "Empty", root.id);
  const file = await createObject(own, ID.file, "notes.bin", "uploaded bytes", ID.child);
  const native = await createDocument(own, ID.native, "draft", "snapshot body", ID.child);

  await t.test("folder snapshots deduplicate covered rows and retain the captured native revision", async () => {
    const response = await api.POST(request({ items: [
      { type: "folder", id: root.id, revision: root.revision },
      { type: "folder", id: child.id, revision: child.revision },
      { type: "file", id: file.id, revision: file.metadata_revision },
    ] }));
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("content-type"), "application/zip");

    const changed = await updateDocument(own, native.file, "changed after snapshot");
    assert.equal(changed.file.content_revision, native.file.content_revision + 1);
    const entries = await zipEntries(response);
    const names = entries.map((entry) => entry.name);
    assert.equal(names.filter((name) => name.endsWith("notes.bin")).length, 1);
    assert.ok(names.includes("Study/"));
    assert.ok(names.includes("Study/Empty/"), "empty folders have explicit directory entries");
    assert.ok(names.includes("Study/Week 1/draft.txt"), "native documents receive a .txt ZIP name");
    assert.equal(entries.find((entry) => entry.name === "Study/Week 1/draft.txt").body.toString(), "snapshot body");
    assert.equal(names.filter((name) => name.includes("notes.bin")).length, 1, "overlapping file selections are deduplicated");

    const reverse = await api.POST(request({ items: [
      { type: "file", id: file.id, revision: file.metadata_revision },
      { type: "folder", id: child.id, revision: child.revision },
      { type: "folder", id: root.id, revision: root.revision },
    ] }));
    assert.equal(reverse.status, 200);
    assert.deepEqual((await zipEntries(reverse)).map((entry) => entry.name).sort(), [...names].sort(),
      "selecting descendants before their ancestor preserves the same hierarchy and exports each item once");
  });

  await t.test("every raw revision is checked before overlap deduplication; foreign and trashed roots are denied", async () => {
    const stale = await api.POST(request({ items: [
      { type: "folder", id: root.id, revision: root.revision },
      { type: "file", id: file.id, revision: file.metadata_revision + 1 },
    ] }));
    assert.equal(stale.status, 409, "a stale descendant selection still fails when its parent covers it");

    const childNow = await row("file_folders", own, child.id);
    await sql("select public.mutate_account_folder($1,$2,'trash',$3,$4,'{}'::jsonb)", [own.id, own.auth_user_id, child.id, childNow.revision]);
    const rootNow = await row("file_folders", own, root.id);
    const activeParent = await api.POST(request({ items: [{ type: "folder", id: root.id, revision: rootNow.revision }] }));
    assert.equal(activeParent.status, 200, "trashing a descendant does not block downloads from its active parent");
    assert.ok(!(await zipEntries(activeParent)).some((entry) => entry.name.startsWith("Study/Week 1")));

    const tombstone = await createFolder(own, ID.tombstone, "Removed while linked", root.id);
    await sql(`
      with purge_permission as (select set_config('app.account_file_purge_write','1',true))
      update public.file_folders folder set deleted_at=clock_timestamp()
        from purge_permission where folder.profile_id=$1 and folder.id=$2
    `, [own.id, tombstone.id]);
    const rootAfterTombstone = await row("file_folders", own, root.id);
    const excludesTombstone = await api.POST(request({ items: [{ type: "folder", id: root.id, revision: rootAfterTombstone.revision }] }));
    assert.equal(excludesTombstone.status, 200, "a tombstoned descendant is hidden from the active parent archive");
    assert.ok(!(await zipEntries(excludesTombstone)).some((entry) => entry.name.includes("Removed while linked")));
    const tombstoneDownload = await api.POST(request({ items: [{ type: "folder", id: tombstone.id, revision: tombstone.revision }] }));
    assert.equal(tombstoneDownload.status, 404);

    const foreign = await createObject(profiles[USERS.b], ID.foreign, "private.bin", "other account");
    const denied = await api.POST(request({ items: [{ type: "file", id: foreign.id, revision: foreign.metadata_revision }] }));
    assert.equal(denied.status, 404);

    const trash = await createFolder(own, ID.trash, "Trash me");
    await sql("select public.mutate_account_folder($1,$2,'trash',$3,$4,'{}'::jsonb)", [own.id, own.auth_user_id, trash.id, trash.revision]);
    const trashed = await row("file_folders", own, trash.id);
    const trashedResponse = await api.POST(request({ items: [{ type: "folder", id: trash.id, revision: trashed.revision }] }));
    assert.equal(trashedResponse.status, 404);
  });

  await t.test("archived folders and unrelated pending uploads stay downloadable", async () => {
    const archived = await createFolder(own, ID.archive, "Archived");
    const archivedFile = await createObject(own, ID.second, "readme.txt", "archived bytes", archived.id);
    await sql("update public.file_folders set archived_at=now(), semester_label='Fall 2026' where profile_id=$1 and id=$2", [own.id, archived.id]);
    const archivedRow = await row("file_folders", own, archived.id);
    const pendingBytes = Buffer.from("unfinished");
    await sql("select public.mutate_account_file($1,$2,$3,'reserve',null,$4::jsonb)", [
      own.id, own.auth_user_id, ID.pending,
      JSON.stringify({ name: "pending.bin", kind: "attachment", courseId: "", assignmentId: "", folderId: null,
        mime: "application/octet-stream", size: pendingBytes.length, sha256: digest(pendingBytes) }),
    ]);
    const response = await api.POST(request({ items: [{ type: "folder", id: archived.id, revision: archivedRow.revision }] }));
    assert.equal(response.status, 200);
    assert.ok((await zipEntries(response)).some((entry) => entry.name === "Archived/readme.txt"));
    assert.equal(archivedFile.state, "ready");

    const pendingFolder = await createFolder(own, ID.pendingFolder, "Pending tree");
    const pendingChildBytes = Buffer.from("not ready yet");
    await sql("select public.mutate_account_file($1,$2,$3,'reserve',null,$4::jsonb)", [
      own.id, own.auth_user_id, ID.pendingChild,
      JSON.stringify({ name: "incomplete.bin", kind: "attachment", courseId: "", assignmentId: "", folderId: pendingFolder.id,
        mime: "application/octet-stream", size: pendingChildBytes.length, sha256: digest(pendingChildBytes) }),
    ]);
    const pendingTree = await api.POST(request({ items: [{ type: "folder", id: pendingFolder.id, revision: pendingFolder.revision }] }));
    assert.equal(pendingTree.status, 409, "an unfinished file inside the selected tree rejects the whole archive");
  });

  await t.test("ZIP paths sanitize unsafe names and disambiguate case-folded file/folder collisions", async () => {
    const collisionFolder = await createFolder(own, ID.collisionFolder, "report.txt");
    const collisionFile = await createObject(own, ID.collisionFile, "report.txt", "collision");
    const unsafe = await createObject(own, ID.unsafe, "safe.txt", "unsafe name");
    const unsafeFolder = await createFolder(own, ID.unsafeFolder, "unsafe-folder");
    await sql("update public.user_files set name='CON:bad.txt' where profile_id=$1 and id=$2", [own.id, unsafe.id]);
    await sql("update public.file_folders set name='．．／absolute' where profile_id=$1 and id=$2", [own.id, unsafeFolder.id]);
    const device = await createObject(own, ID.windowsDevice, "device.txt", "reserved name");
    await sql("update public.user_files set name='CON' where profile_id=$1 and id=$2", [own.id, device.id]);
    const folderRow = await row("file_folders", own, collisionFolder.id);
    const unsafeFolderRow = await row("file_folders", own, unsafeFolder.id);
    const deviceRow = await row("user_files", own, device.id);
    const fileRow = await row("user_files", own, collisionFile.id);
    const unsafeRow = await row("user_files", own, unsafe.id);
    const response = await api.POST(request({ items: [
      { type: "folder", id: collisionFolder.id, revision: folderRow.revision },
      { type: "file", id: collisionFile.id, revision: fileRow.metadata_revision },
      { type: "file", id: unsafe.id, revision: unsafeRow.metadata_revision },
      { type: "folder", id: unsafeFolder.id, revision: unsafeFolderRow.revision },
      { type: "file", id: device.id, revision: deviceRow.metadata_revision },
    ] }));
    assert.equal(response.status, 200);
    const names = (await zipEntries(response)).map((entry) => entry.name);
    assert.ok(names.some((name) => name.startsWith(".._absolute")));
    assert.ok(names.some((name) => /report.*\(2\)/i.test(name)), names.join(", "));
    assert.ok(names.includes("CON_bad.txt"));
    assert.ok(names.includes("_CON"), "Windows device names are made safe for ZIP extraction");
    const normalized = names.map((name) => name.replace(/\/$/, "").normalize("NFKC").toLowerCase());
    assert.equal(new Set(normalized).size, normalized.length, "ZIP entries have no case-folded collisions");
    for (const name of names) {
      assert.ok(!name.startsWith("/") && !name.includes("\\") && !name.includes(":") && !name.split("/").some((part) => part === ".." || part === "."));
    }
  });

  await t.test("strict request fields, numeric revisions, and selection limits are enforced", async () => {
    const item = { type: "file", id: file.id, revision: file.metadata_revision };
    assert.equal((await api.POST(request({ items: [{ ...item, extra: true }] }))).status, 400);
    assert.equal((await api.POST(request({ accountId: own.id, items: [item] }))).status, 400);
    assert.equal((await api.POST(request({ items: [{ ...item, revision: String(item.revision) }] }))).status, 400);
    assert.equal((await api.POST(request({ items: Array.from({ length: 1_001 }, () => item) }))).status, 413);
    const mismatch = await api.POST(request({ items: [item] }, { profileId: profiles[USERS.b].id }));
    assert.equal(mismatch.status, 401);
  });

  await t.test("corrupt stored bytes fail the stream instead of completing a damaged ZIP", async () => {
    const corruptFile = await createObject(own, ID.corrupt, "corrupt.bin", "original bytes");
    runtime.objects.set(`${own.id}/${corruptFile.id}`, Buffer.from("corrupted bytes"));
    const response = await api.POST(request({ items: [{ type: "file", id: corruptFile.id, revision: corruptFile.metadata_revision }] }));
    assert.equal(response.status, 200);
    let failure;
    try { await response.arrayBuffer(); } catch (error) { failure = error; }
    assert.ok(failure, `the stream completed; type=${response.headers.get("content-type")}, reads=${runtime.storageReads.join(",")}`);
    assert.match(failure.message, /verification failed/i);
  });

  await t.test("cancellation prevents later object reads; SQL privileges remain service-only", async () => {
    const first = await createObject(own, ID.direct, "first.bin", "first bytes");
    const second = await createObject(own, ID.finalFile, "second.bin", "second bytes");
    const controller = new AbortController();
    const before = runtime.storageReads.length;
    const response = await api.POST(request({ items: [
      { type: "file", id: first.id, revision: first.metadata_revision },
      { type: "file", id: second.id, revision: second.metadata_revision },
    ] }, { signal: controller.signal }));
    const reader = response.body.getReader();
    const firstChunks = [];
    while (runtime.storageReads.length === before && firstChunks.length < 5) {
      const result = await reader.read();
      assert.equal(result.done, false);
      firstChunks.push(result.value);
    }
    assert.equal(runtime.storageReads.length, before + 1, "the first file is read only when its ZIP entry is consumed");
    controller.abort();
    for (let attempts = 0; attempts < 5; attempts += 1) {
      try {
        const result = await reader.read();
        if (result.done) break;
      } catch { break; }
    }
    assert.equal(runtime.storageReads.length, before + 1, "an aborted request does not begin another content read");
    await reader.cancel().catch(() => {});

    const cancelBeforeRead = runtime.storageReads.length;
    const cancelResponse = await api.POST(request({ items: [
      { type: "file", id: first.id, revision: first.metadata_revision },
      { type: "file", id: second.id, revision: second.metadata_revision },
    ] }));
    const cancelReader = cancelResponse.body.getReader();
    let cancelChunks = 0;
    while (runtime.storageReads.length === cancelBeforeRead && cancelChunks < 5) {
      const result = await cancelReader.read();
      assert.equal(result.done, false);
      cancelChunks += 1;
    }
    assert.equal(runtime.storageReads.length, cancelBeforeRead + 1, "the first content read begins only as its entry is consumed");
    await cancelReader.cancel();
    assert.equal(runtime.storageReads.length, cancelBeforeRead + 1, "cancelling the response stream prevents later content reads");

    const privileges = await sql(`
      select has_function_privilege('anon', 'public.snapshot_account_file_selection(uuid,uuid,jsonb)', 'execute') as anon_can,
             has_function_privilege('authenticated', 'public.snapshot_account_file_selection(uuid,uuid,jsonb)', 'execute') as user_can,
             has_function_privilege('service_role', 'public.snapshot_account_file_selection(uuid,uuid,jsonb)', 'execute') as service_can
    `);
    assert.deepEqual(privileges.rows[0], { anon_can: false, user_can: false, service_can: true });
    await assert.rejects(
      () => sql("select public.snapshot_account_file_selection($1,$2,$3::jsonb)", [own.id, profiles[USERS.b].auth_user_id, JSON.stringify([{ type: "file", id: first.id, revision: first.metadata_revision }])]),
      /Account is not available/,
    );
  });
});
