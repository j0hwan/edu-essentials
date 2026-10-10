import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/files", pretendToBeVisual: true });
for (const name of [
  "window", "document", "Element", "Node", "HTMLElement", "HTMLFormElement", "HTMLButtonElement",
  "HTMLAnchorElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "MouseEvent",
  "KeyboardEvent", "Event", "FormData", "MutationObserver",
]) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true, value: (callback) => setTimeout(() => callback(Date.now()), 0) });
Object.defineProperty(dom.window, "cancelAnimationFrame", { configurable: true, value: (id) => clearTimeout(id) });

const nativeCreateObjectURL = globalThis.URL.createObjectURL;
const nativeRevokeObjectURL = globalThis.URL.revokeObjectURL;
let objectUrlId = 0;
globalThis.URL.createObjectURL = () => `blob:preview-${++objectUrlId}`;
globalThis.URL.revokeObjectURL = () => {};
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;
dom.window.URL.revokeObjectURL = globalThis.URL.revokeObjectURL;

const [
  { createElement, act }, { createRoot }, { FilePreview, PrivateImage }, { useFileActivity },
  { archiveFolder, recordFileOpened, setBrowserItemStarred }, { deriveFilesBrowser },
] = await Promise.all([
  import("react"), import("react-dom/client"), import(await clientModule("app/private-files.tsx")),
  import(await clientModule("app/use-file-activity.ts")), import(await clientModule("lib/files-browser-activity.ts")),
  import(await clientModule("lib/files-browser.ts")),
]);

const PROFILE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const OPENED_AT = "2026-10-08T12:34:56.000Z";

const file = (id = FILE_ID, overrides = {}) => ({
  id, name: id === FILE_ID ? "Notes.txt" : "Reference.txt", mime_type: "text/plain", size_bytes: 12,
  course_id: null, assignment_id: null, kind: "resource", state: "ready",
  created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-08T00:00:00.000Z",
  content_sha256: null, folder_id: null, content_backend: "object", metadata_revision: 7,
  content_revision: 11, trashed_at: null, trash_operation_id: null, original_folder_id: null,
  ...overrides,
});

const rootNode = document.getElementById("root");
let root;
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => globalThis.__activityFetch(...args);

function reset() {
  window.history.replaceState({}, "", "/files");
  rootNode.innerHTML = "";
  root = createRoot(rootNode);
  globalThis.__activityFetch = async () => { throw new Error("Unexpected fetch"); };
  globalThis.__activityRequests = [];
}

async function render(element) {
  await act(async () => root.render(element));
}

async function unmount() {
  if (!root) return;
  await act(async () => root.unmount());
  root = undefined;
  rootNode.innerHTML = "";
}

async function waitUntil(predicate, description, timeoutMs = 3000) {
  let remaining = timeoutMs;
  await act(async () => {
    while (!predicate() && remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      remaining -= 10;
    }
  });
  assert.ok(predicate(), `Timed out waiting for ${description}`);
}

function button(label) {
  const found = [...rootNode.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
  assert.ok(found, `Missing button ${label}`);
  return found;
}

async function click(label) {
  await act(async () => button(label).click());
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function actionPayload(id = FILE_ID, lastOpenedAt = OPENED_AT, starredAt = null, extra = {}) {
  return {
    activities: {
      files: [{ file_id: id, starred_at: starredAt, last_opened_at: lastOpenedAt }],
      ...extra,
    },
  };
}

function ActivityHarness({ session, currentFile = file(), store, onRefresh = async () => null, enabled = true, showPreview = true }) {
  const [openedAt, setOpenedAt] = ReactUseState(null);
  const activity = useFileActivity(session, enabled, async (signal, strict) => {
    const openedAt = await onRefresh(signal, strict);
    if (typeof openedAt === "string") setOpenedAt(openedAt);
  });
  const recent = deriveFilesBrowser({
    folders: [], files: [currentFile, file(OTHER_ID, { updated_at: "2026-10-08T11:00:00.000Z" })],
    fileActivity: {
      [currentFile.id]: { starred_at: null, last_opened_at: openedAt },
      [OTHER_ID]: { starred_at: null, last_opened_at: "2026-10-08T12:00:00.000Z" },
    },
    folderActivity: {},
  }, { view: "recent", folderId: null, layout: "list" });
  return createElement(ReactFragment, null,
    createElement("button", { onClick: () => activity.opened(currentFile) }, "Queue open event"),
    createElement("output", { "data-testid": "recent-order" }, recent.items.map(({ id }) => id).join(",")),
    activity.failure && createElement("div", { role: "alert" },
      createElement("span", null, activity.failure.message),
      createElement("button", { onClick: activity.retry }, "Retry activity")),
    showPreview && createElement(FilePreview, {
      key: `${session.profileId}-${session.generation}`, file: currentFile, store,
      onOpened: activity.opened, onClose: () => {}, onEdit: () => {}, canWrite: true,
    }));
}

const { Fragment: ReactFragment, useCallback: ReactUseCallback, useState: ReactUseState } = await import("react");

function ActivityQueueHarness({ session, files, onRefresh }) {
  const [activityRows, setActivityRows] = ReactUseState({});
  const refresh = ReactUseCallback(async (signal, strict) => {
    setActivityRows(await onRefresh(signal, strict));
  }, [onRefresh]);
  const activity = useFileActivity(session, true, refresh);
  const recent = deriveFilesBrowser({
    folders: [], files, fileActivity: activityRows, folderActivity: {},
  }, { view: "recent", folderId: null, layout: "list" });
  return createElement(ReactFragment, null,
    ...files.map((current) => createElement("button", { key: current.id, onClick: () => activity.opened(current) }, "Open " + current.name)),
    createElement("output", { "data-testid": "queue-recent" }, recent.items.map(({ file: current }) => current.name).join(",")),
    activity.failure && createElement("div", { role: "alert" },
      createElement("span", null, activity.failure.message),
      createElement("button", { onClick: activity.retry }, "Retry queued event")),
  );
}

afterEach(async () => { await unmount(); });
after(() => {
  dom.window.close();
  if (nativeCreateObjectURL) globalThis.URL.createObjectURL = nativeCreateObjectURL;
  else delete globalThis.URL.createObjectURL;
  if (nativeRevokeObjectURL) globalThis.URL.revokeObjectURL = nativeRevokeObjectURL;
  else delete globalThis.URL.revokeObjectURL;
  if (originalFetch) globalThis.fetch = originalFetch;
});

test("open acknowledgement uses the captured profile and metadata revision, then returns its canonical timestamp", async () => {
  reset();
  const requests = globalThis.__activityRequests;
  globalThis.__activityFetch = async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json(actionPayload(FILE_ID, OPENED_AT));
  };

  const saved = await recordFileOpened(PROFILE_A, file());
  assert.deepEqual(saved, { activity: { starred_at: null, last_opened_at: OPENED_AT } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/files/actions");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(new Headers(requests[0].init.headers).get("x-profile-id"), PROFILE_A);
  assert.equal(requests[0].init.credentials, "same-origin");
  assert.equal(requests[0].init.cache, "no-store");
  assert.deepEqual(requests[0].body, { action: "open", items: [{ type: "file", id: FILE_ID, revision: 7 }] });
});

test("star acknowledgements validate the selected item and reject a different account", async () => {
  reset();
  globalThis.__activityFetch = async () => Response.json(actionPayload(FILE_ID, null, "2026-10-08T12:00:00.000Z"));
  const saved = await setBrowserItemStarred(PROFILE_A, { type: "file", id: FILE_ID, file: file() }, true);
  assert.equal(saved.activity.starred_at, "2026-10-08T12:00:00.000Z");

  globalThis.__activityFetch = async () => Response.json({ ...actionPayload(FILE_ID, null, "2026-10-08T12:00:00.000Z"), profile_id: PROFILE_B });
  await assert.rejects(setBrowserItemStarred(PROFILE_A, { type: "file", id: FILE_ID, file: file() }, true), /different signed-in account/i);
});

test("open acknowledgements reject changed file content revisions while accepting ownership-free file projections", async () => {
  reset();
  globalThis.__activityFetch = async () => Response.json({
    ...actionPayload(),
    files: [file()],
    folders: [],
  });
  assert.equal((await recordFileOpened(PROFILE_A, file())).activity.last_opened_at, OPENED_AT);

  globalThis.__activityFetch = async () => Response.json({
    ...actionPayload(),
    files: [file(FILE_ID, { content_revision: 12 })],
    folders: [],
  });
  await assert.rejects(recordFileOpened(PROFILE_A, file()), /changed saved file data/i);
});

test("archive requests capture the folder revision and require the saved label and identity in the acknowledgement", async () => {
  reset();
  const source = {
    id: "33333333-3333-4333-8333-333333333333", parent_id: null, name: "Class notes",
    kind: "custom", course_id: null, course_code: null, revision: 4,
    created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-08T00:00:00.000Z",
    archived_at: null, semester_label: null, course_name_snapshot: null, course_color_snapshot: null,
    trashed_at: null, trash_operation_id: null, original_parent_id: null,
  };
  const archived = { ...source, revision: 5, archived_at: OPENED_AT, semester_label: "Fall 2026" };
  const requests = globalThis.__activityRequests;
  globalThis.__activityFetch = async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json({ folder: archived });
  };
  assert.deepEqual(await archiveFolder(PROFILE_A, source, " Fall 2026 "), archived);
  assert.equal(requests[0].url, "/api/file-folders");
  assert.equal(requests[0].init.method, "PUT");
  assert.equal(new Headers(requests[0].init.headers).get("x-profile-id"), PROFILE_A);
  assert.deepEqual(requests[0].body, { action: "archive", id: source.id, revision: 4, semesterLabel: "Fall 2026" });

  globalThis.__activityFetch = async () => Response.json({ folder: { ...archived, semester_label: "Wrong label" } });
  await assert.rejects(archiveFolder(PROFILE_A, source, "Fall 2026"), /did not confirm the archive label/i);
});

test("a successful text preview records Recent only after both bytes and text are read", async () => {
  reset();
  const bytes = deferred();
  const text = deferred();
  let textStarted = false;
  const requests = globalThis.__activityRequests;
  globalThis.__activityFetch = async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json(actionPayload());
  };
  const blob = new Blob(["fixture"], { type: "text/plain" });
  Object.defineProperty(blob, "text", { value: () => { textStarted = true; return text.promise; } });
  const store = { busy: false, url: () => "/api/file-content", blob: (_file, signal) => {
    store.signal = signal;
    return bytes.promise;
  } };
  const refreshCalls = [];
  const onRefresh = async (signal, strict) => { refreshCalls.push({ signal, strict }); return OPENED_AT; };

  await render(createElement(ActivityHarness, { session: { profileId: PROFILE_A, generation: 1 }, store, onRefresh }));
  await waitUntil(() => !!store.signal, "the private byte read");
  assert.equal(requests.length, 0, "starting a read does not update Recent");
  bytes.resolve(blob);
  await waitUntil(() => textStarted, "the text body read");
  assert.equal(requests.length, 0, "reading bytes alone does not count as a successful text preview");
  text.resolve("hello from the private file");
  await waitUntil(() => requests.length === 1, "the open acknowledgement");
  await waitUntil(() => refreshCalls.length === 1, "the strict activity refresh");
  assert.equal(rootNode.querySelector("pre")?.textContent, "hello from the private file");
  assert.equal(refreshCalls[0].strict, true);
  assert.deepEqual(requests[0].body, { action: "open", items: [{ type: "file", id: FILE_ID, revision: 7 }] });
  assert.equal(rootNode.querySelector('[data-testid="recent-order"]').textContent, `${FILE_ID},${OTHER_ID}`, "the acknowledged open moves this actual file ahead of a newer-modified file");
});

test("failed private reads offer retry and only a successful retry records Recent", async () => {
  reset();
  let blobs = 0;
  const requests = globalThis.__activityRequests;
  globalThis.__activityFetch = async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json(actionPayload());
  };
  const store = { busy: false, url: () => "/api/file-content", blob: async () => {
    blobs += 1;
    if (blobs === 1) throw new Error("Private bytes unavailable");
    return new Blob(["recovered text"], { type: "text/plain" });
  } };
  const refreshCalls = [];
  const onRefresh = async (_signal, strict) => { refreshCalls.push(strict); return OPENED_AT; };

  await render(createElement(ActivityHarness, { session: { profileId: PROFILE_A, generation: 1 }, store, onRefresh }));
  await waitUntil(() => !!rootNode.querySelector('[role="alert"]'), "the private read error");
  assert.match(rootNode.textContent, /Private bytes unavailable/);
  assert.equal(requests.length, 0);
  assert.equal(refreshCalls.length, 0);
  await click("Retry preview");
  await waitUntil(() => rootNode.querySelector("pre")?.textContent === "recovered text", "the retried preview");
  await waitUntil(() => requests.length === 1, "the open action after the successful read");
  await waitUntil(() => refreshCalls.length === 1, "refresh after the acknowledged open");
  assert.equal(blobs, 2);
  assert.deepEqual(refreshCalls, [true]);
});

test("failed open activity exposes retry and does not refresh until the server acknowledges it", async () => {
  reset();
  const requests = globalThis.__activityRequests;
  let shouldFail = true;
  globalThis.__activityFetch = async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    if (shouldFail) {
      shouldFail = false;
      return Response.json({ error: "Temporary activity failure" }, { status: 503 });
    }
    return Response.json(actionPayload());
  };
  const refreshCalls = [];
  const onRefresh = async (_signal, strict) => { refreshCalls.push(strict); return OPENED_AT; };
  const store = { busy: false, url: () => "/api/file-content", blob: async () => new Blob(["read text"], { type: "text/plain" }) };

  await render(createElement(ActivityHarness, { session: { profileId: PROFILE_A, generation: 1 }, store, onRefresh, showPreview: false }));
  await click("Queue open event");
  await waitUntil(() => !!rootNode.querySelector('[role="alert"]'), "the failed activity acknowledgement");
  assert.match(rootNode.textContent, /Temporary activity failure/);
  assert.equal(refreshCalls.length, 0, "a failed open action cannot refresh as though it were saved");
  await click("Retry activity");
  await waitUntil(() => refreshCalls.length === 1, "refresh after retry is acknowledged");
  assert.deepEqual(refreshCalls, [true]);
  assert.equal(requests.length, 2);
});

test("a refresh failure after an acknowledged open retries only the refresh", async () => {
  reset();
  const requests = globalThis.__activityRequests;
  globalThis.__activityFetch = async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json(actionPayload());
  };
  let refreshes = 0;
  const onRefresh = async (_signal, strict) => {
    assert.equal(strict, true);
    refreshes += 1;
    if (refreshes === 1) throw new Error("Saved Recent but refresh failed");
    return OPENED_AT;
  };
  const store = { busy: false, url: () => "/api/file-content", blob: async () => new Blob(["text"], { type: "text/plain" }) };

  await render(createElement(ActivityHarness, { session: { profileId: PROFILE_A, generation: 1 }, store, onRefresh, showPreview: false }));
  await click("Queue open event");
  await waitUntil(() => !!rootNode.querySelector('[role="alert"]'), "the refresh failure");
  assert.match(rootNode.textContent, /saved, but Files could not refresh/i);
  await click("Retry activity");
  await waitUntil(() => refreshes === 2 && !rootNode.querySelector('[role="alert"]'), "the retried refresh");
  assert.equal(requests.length, 1, "the acknowledged open is not posted a second time");
  assert.equal(refreshes, 2);
});

test("closing a preview aborts its held byte read and a late result records no open", async () => {
  reset();
  const held = deferred();
  let signal;
  const requests = globalThis.__activityRequests;
  globalThis.__activityFetch = async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(init.body) });
    return Response.json(actionPayload());
  };
  const store = { busy: false, url: () => "/api/file-content", blob: (_file, readSignal) => { signal = readSignal; return held.promise; } };
  const onRefresh = async () => OPENED_AT;
  function ClosableHarness(props) {
    const [visible, setVisible] = ReactUseState(true);
    return createElement(ReactFragment, null,
      createElement("button", { onClick: () => setVisible(false) }, "Close test preview"),
      visible && createElement(ActivityHarness, { ...props, showPreview: true }));
  }
  await render(createElement(ClosableHarness, { session: { profileId: PROFILE_A, generation: 1 }, store, onRefresh }));
  await waitUntil(() => !!signal, "the held byte read");
  await click("Close test preview");
  assert.equal(signal.aborted, true);
  held.resolve(new Blob(["late text"], { type: "text/plain" }));
  await act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(requests.length, 0, "a closed preview does not report a later byte result as opened");
});

test("switching profiles aborts a held preview and fences its late result", async () => {
  reset();
  const heldA = deferred();
  const requests = globalThis.__activityRequests;
  let signalA;
  globalThis.__activityFetch = async (input, init) => {
    requests.push({ url: String(input), profileId: new Headers(init.headers).get("x-profile-id"), body: JSON.parse(init.body) });
    return Response.json(actionPayload());
  };
  const store = { busy: false, url: () => "/api/file-content", blob: (current, signal) => {
    if (current.id === FILE_ID) { signalA = signal; return heldA.promise; }
    return Promise.resolve(new Blob(["profile B content"], { type: "text/plain" }));
  } };
  const onRefresh = async () => OPENED_AT;
  const sessionA = { profileId: PROFILE_A, generation: 1 };
  await render(createElement(ActivityHarness, { session: sessionA, store, onRefresh }));
  await waitUntil(() => !!signalA, "profile A byte read");
  await render(createElement(ActivityHarness, { session: { profileId: PROFILE_B, generation: 1 }, currentFile: file(OTHER_ID), store, onRefresh }));
  await waitUntil(() => rootNode.textContent.includes("profile B content"), "profile B preview");
  assert.equal(signalA.aborted, true);
  heldA.resolve(new Blob(["late account A content"], { type: "text/plain" }));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.deepEqual(requests.map(({ profileId }) => profileId), [PROFILE_B]);
  assert.doesNotMatch(rootNode.textContent, /late account A content/);
});

test("A to B to A session changes fence an old open acknowledgement by generation", async () => {
  reset();
  const heldResponse = deferred();
  const requests = globalThis.__activityRequests;
  globalThis.__activityFetch = async (input, init) => {
    requests.push({ url: String(input), profileId: new Headers(init.headers).get("x-profile-id"), signal: init.signal });
    return heldResponse.promise;
  };
  const refreshCalls = [];
  const onRefresh = async () => { refreshCalls.push(true); return OPENED_AT; };
  const store = { busy: false, url: () => "/api/file-content", blob: async () => new Blob(["unused"], { type: "text/plain" }) };

  await render(createElement(ActivityHarness, { session: { profileId: PROFILE_A, generation: 1 }, store, onRefresh, showPreview: false }));
  await click("Queue open event");
  await waitUntil(() => requests.length === 1, "profile A activity request");
  await render(createElement(ActivityHarness, { session: { profileId: PROFILE_B, generation: 1 }, currentFile: file(OTHER_ID), store, onRefresh, showPreview: false }));
  await render(createElement(ActivityHarness, { session: { profileId: PROFILE_A, generation: 2 }, store, onRefresh, showPreview: false }));
  assert.equal(requests[0].signal.aborted, true);
  heldResponse.resolve(Response.json(actionPayload()));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(refreshCalls.length, 0, "the generation-1 acknowledgement cannot refresh generation 2");
  assert.equal(rootNode.querySelector('[role="alert"]'), null, "the old response cannot create a failure in the new session");
});

test("background PrivateImage reads its blob without creating a Recent event", async () => {
  reset();
  let blobReads = 0;
  const requests = globalThis.__activityRequests;
  globalThis.__activityFetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json(actionPayload());
  };
  const image = file(FILE_ID, { name: "Card.png", mime_type: "image/png", kind: "class-image", course_id: "biology" });
  const store = { blob: async () => { blobReads += 1; return new Blob(["image"], { type: "image/png" }); } };
  await render(createElement(PrivateImage, { file: image, store }));
  await waitUntil(() => !!rootNode.querySelector("img"), "the background private image");
  assert.equal(blobReads, 1);
  assert.equal(requests.length, 0, "background image loading is not an explicit file open");
});

test("the actual Recent derivation uses an acknowledged open timestamp rather than modification time", async () => {
  reset();
  const files = [file(FILE_ID, { updated_at: "2026-10-01T00:00:00.000Z" }), file(OTHER_ID, { updated_at: "2026-10-08T00:00:00.000Z" })];
  const data = { folders: [], files, fileActivity: {
    [FILE_ID]: { starred_at: null, last_opened_at: OPENED_AT },
    [OTHER_ID]: { starred_at: null, last_opened_at: "2026-10-08T11:00:00.000Z" },
  }, folderActivity: {} };
  assert.deepEqual(deriveFilesBrowser(data, { view: "recent", folderId: null, layout: "list" }).items.map(({ id }) => id), [FILE_ID, OTHER_ID]);
});

test("held opens coalesce A to B to A at the latest event position and Recent follows canonical acknowledgements", async () => {
  reset();
  const ids = {
    a: "33333333-3333-4333-8333-333333333333",
    b: "44444444-4444-4444-8444-444444444444",
    x: "55555555-5555-4555-8555-555555555555",
  };
  const files = [
    file(ids.a, { name: "A.txt" }),
    file(ids.b, { name: "B.txt" }),
    file(ids.x, { name: "X.txt" }),
  ];
  const canonicalTimes = new Map([
    [ids.x, "2026-10-08T10:00:00.000Z"],
    [ids.b, "2026-10-08T11:00:00.000Z"],
    [ids.a, "2026-10-08T12:00:00.000Z"],
  ]);
  const canonical = new Map();
  const heldX = deferred();
  const requests = globalThis.__activityRequests;
  globalThis.__activityFetch = async (input, init) => {
    const body = JSON.parse(init.body);
    const id = body.items[0].id;
    requests.push({ url: String(input), body });
    if (id === ids.x) return heldX.promise;
    const lastOpenedAt = canonicalTimes.get(id);
    canonical.set(id, { starred_at: null, last_opened_at: lastOpenedAt });
    return Response.json(actionPayload(id, lastOpenedAt));
  };
  const refreshes = [];
  const onRefresh = async (_signal, strict) => {
    refreshes.push(strict);
    return Object.fromEntries(canonical);
  };
  await render(createElement(ActivityQueueHarness, { session: { profileId: PROFILE_A, generation: 1 }, files, onRefresh }));

  await click("Open X.txt");
  await waitUntil(() => requests.length === 1, "the held X open request");
  await click("Open A.txt");
  await click("Open B.txt");
  await click("Open A.txt");
  assert.deepEqual(requests.map(({ body }) => body.items[0].id), [ids.x], "queued activity waits while the first acknowledgement is held");

  const xOpenedAt = canonicalTimes.get(ids.x);
  canonical.set(ids.x, { starred_at: null, last_opened_at: xOpenedAt });
  heldX.resolve(Response.json(actionPayload(ids.x, xOpenedAt)));
  await waitUntil(() => requests.length === 3 && refreshes.length === 3, "all queued opens and strict refreshes");
  await waitUntil(() => rootNode.querySelector('[data-testid="queue-recent"]')?.textContent === "A.txt,B.txt,X.txt", "Recent ordered by the server's canonical open times");
  assert.deepEqual(requests.map(({ body }) => body.items[0].id), [ids.x, ids.b, ids.a], "the repeated A moves behind B in the coalesced queue");
  assert.deepEqual(refreshes, [true, true, true]);
});

test("a failed open holds later events until retry acknowledges it, then drains in actual-event order", async () => {
  reset();
  const ids = {
    a: "66666666-6666-4666-8666-666666666666",
    b: "77777777-7777-4777-8777-777777777777",
  };
  const files = [file(ids.a, { name: "A.txt" }), file(ids.b, { name: "B.txt" })];
  const canonical = new Map();
  const canonicalTimes = new Map([
    [ids.a, "2026-10-08T13:00:00.000Z"],
    [ids.b, "2026-10-08T14:00:00.000Z"],
  ]);
  const requests = globalThis.__activityRequests;
  let failedFirstA = false;
  globalThis.__activityFetch = async (input, init) => {
    const body = JSON.parse(init.body);
    const id = body.items[0].id;
    requests.push({ url: String(input), body });
    if (id === ids.a && !failedFirstA) {
      failedFirstA = true;
      return Response.json({ error: "Open acknowledgement unavailable" }, { status: 503 });
    }
    const lastOpenedAt = canonicalTimes.get(id);
    canonical.set(id, { starred_at: null, last_opened_at: lastOpenedAt });
    return Response.json(actionPayload(id, lastOpenedAt));
  };
  const refreshes = [];
  const onRefresh = async (_signal, strict) => {
    refreshes.push(strict);
    return Object.fromEntries(canonical);
  };
  await render(createElement(ActivityQueueHarness, { session: { profileId: PROFILE_A, generation: 1 }, files, onRefresh }));

  await click("Open A.txt");
  await waitUntil(() => !!rootNode.querySelector('[role="alert"]'), "the failed A acknowledgement");
  await click("Open B.txt");
  assert.deepEqual(requests.map(({ body }) => body.items[0].id), [ids.a], "B stays queued while A is not acknowledged");
  assert.equal(refreshes.length, 0, "a failed write cannot refresh Recent");

  await click("Retry queued event");
  await waitUntil(() => requests.length === 3 && refreshes.length === 2, "retry acknowledgement followed by the retained B event");
  await waitUntil(() => rootNode.querySelector('[data-testid="queue-recent"]')?.textContent === "B.txt,A.txt", "Recent ordered by the retry and later B acknowledgement times");
  assert.deepEqual(requests.map(({ body }) => body.items[0].id), [ids.a, ids.a, ids.b]);
  assert.deepEqual(refreshes, [true, true]);
});
