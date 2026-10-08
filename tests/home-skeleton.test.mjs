import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const { HOME_SKELETON_PRESETS, chooseHomeSkeletonPreset, getHomeSkeletonPreset, getHomeSkeletonPlacements } = await import(await clientModule("lib/home-skeleton.ts"));
const { calculateWidgetPlacements } = await import(await clientModule("lib/widget-layout.ts"));
const { createElement, act } = await import("react");
const knownPresetIds = ["study-overview", "study-rhythm", "calendar-focus", "notes-board", "weekly-pulse"];

function assertNoOverlap(placements, columns, label) {
  const occupied = new Set();
  for (const placement of placements) {
    assert.ok(placement.column >= 1 && placement.column + placement.columnSpan - 1 <= columns, `${label}: placement stays within ${columns} columns`);
    assert.ok(placement.row >= 1 && placement.rowSpan >= 1, `${label}: placement has a positive row footprint`);
    for (let row = placement.row; row < placement.row + placement.rowSpan; row++) {
      for (let column = placement.column; column < placement.column + placement.columnSpan; column++) {
        const cell = `${column},${row}`;
        assert.ok(!occupied.has(cell), `${label}: no two cards occupy ${cell}`);
        occupied.add(cell);
      }
    }
  }
  return occupied;
}

function assertTodayPlaceholder(root, label) {
  const today = root.querySelector(".home-skeleton__today");
  assert.ok(today, `${label}: the pending skeleton reserves space for Today`);
  assert.ok(today.closest('[aria-hidden="true"]'), `${label}: Today placeholder is decorative`);
  assert.ok(today.closest("[inert]"), `${label}: Today placeholder is inert`);
  assert.equal(today.childElementCount, 0, `${label}: Today placeholder has no content`);
  assert.equal(today.textContent.trim(), "", `${label}: Today placeholder contains no text`);
  assert.equal(today.querySelectorAll("button, a, input, select, textarea").length, 0, `${label}: Today placeholder contains no fake controls`);
  const toolbar = root.querySelector(".home-skeleton__toolbar");
  assert.ok(toolbar, `${label}: skeleton toolbar renders`);
  assert.ok(today.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING, `${label}: Today placeholder appears before the toolbar`);

  const actions = [...root.querySelectorAll(".home-skeleton__actions > *")];
  assert.equal(actions.length, 3, `${label}: the toolbar reserves its three real actions`);
  assert.ok(actions.every((action) => action.childElementCount === 0 && action.textContent.trim() === ""), `${label}: action placeholders stay empty`);
  assert.equal(root.querySelectorAll(".home-skeleton__actions button, .home-skeleton__actions a, .home-skeleton__actions input, .home-skeleton__actions select, .home-skeleton__actions textarea").length, 0, `${label}: action placeholders are not fake controls`);
}

function installDom(url = "https://edu.example.invalid/home") {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url, pretendToBeVisual: true });
  const { window } = dom;
  for (const name of ["window", "document", "Element", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Node", "MouseEvent", "KeyboardEvent", "PopStateEvent", "MutationObserver"]) {
    globalThis[name] = window[name];
  }
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query) => ({ matches: query.includes("prefers-reduced-motion") ? false : false, media: query, addEventListener() {}, removeEventListener() {} });
  window.confirm = () => true;
  window.alert = () => {};
  window.scrollTo = () => {};
  return dom;
}

test("curated presets have stable ids, distinct balanced layouts, and collision-free responsive placements", () => {
  assert.ok(HOME_SKELETON_PRESETS.length >= 5 && HOME_SKELETON_PRESETS.length <= 6, "the library stays finite and curated");
  assert.deepEqual(HOME_SKELETON_PRESETS.map(({ id }) => id), knownPresetIds, "curated preset identifiers stay stable");

  const desktopSilhouettes = new Set();
  const phoneSilhouettes = new Set();
  for (const preset of HOME_SKELETON_PRESETS) {
    assert.ok(preset.widgets.length >= 7 && preset.widgets.length <= 8, `${preset.id} has a balanced card count`);
    assert.ok(preset.widgets.every((widget) => ["small", "medium", "large", "mini", "medium-vertical"].includes(widget.size)), `${preset.id} uses supported footprints`);

    const layouts = getHomeSkeletonPlacements(preset);
    assert.equal(layouts.desktop.length, preset.widgets.length);
    assert.equal(layouts.phone.length, preset.widgets.length);
    const desktopCells = assertNoOverlap(layouts.desktop, 4, `${preset.id} desktop`);
    assert.equal(Math.max(...layouts.desktop.map(({ row, rowSpan }) => row + rowSpan - 1)), 6, `${preset.id} fits three desktop small-cell rows`);
    assert.equal(desktopCells.size, 24, `${preset.id} fills its complete 4-by-3 desktop footprint`);
    assertNoOverlap(layouts.phone, 2, `${preset.id} phone`);
    assert.ok(Math.max(...layouts.phone.map(({ row, rowSpan }) => row + rowSpan - 1)) <= 16, `${preset.id} stays vertically balanced at two columns`);
    desktopSilhouettes.add(layouts.desktop.map(({ column, columnSpan, row, rowSpan }) => `${column}:${columnSpan}:${row}:${rowSpan}`).join("|"));
    phoneSilhouettes.add(layouts.phone.map(({ column, columnSpan, row, rowSpan }) => `${column}:${columnSpan}:${row}:${rowSpan}`).join("|"));
  }
  assert.equal(desktopSilhouettes.size, HOME_SKELETON_PRESETS.length, "each preset has a distinct desktop silhouette");
  assert.equal(phoneSilhouettes.size, HOME_SKELETON_PRESETS.length, "each preset has a distinct phone silhouette");
  assert.equal(getHomeSkeletonPreset("study-overview").id, "study-overview");
  assert.equal(getHomeSkeletonPreset("stale-preset-id").id, HOME_SKELETON_PRESETS[0].id, "stale server IDs fall back safely");
  for (const preset of HOME_SKELETON_PRESETS) {
    assert.deepEqual(calculateWidgetPlacements(preset.widgets.map((widget) => widget.size), 4), getHomeSkeletonPlacements(preset).desktop);
    assert.deepEqual(calculateWidgetPlacements(preset.widgets.map((widget) => widget.size), 2), getHomeSkeletonPlacements(preset).phone);
  }
});

test("preset selection consumes one finite sample and remains deterministic for server-provided IDs", () => {
  let sampleCalls = 0;
  const selected = chooseHomeSkeletonPreset(() => { sampleCalls++; return 0.41; });
  assert.equal(sampleCalls, 1, "selection consumes one random sample");
  assert.equal(chooseHomeSkeletonPreset(() => 0.41).id, selected.id, "the same finite sample yields the same stable ID");
  assert.notEqual(chooseHomeSkeletonPreset(() => 0).id, chooseHomeSkeletonPreset(() => 0.999999).id, "fresh samples can select different curated IDs");
  assert.equal(chooseHomeSkeletonPreset(() => Number.NaN).id, HOME_SKELETON_PRESETS[0].id);
  assert.equal(chooseHomeSkeletonPreset(() => Number.POSITIVE_INFINITY).id, HOME_SKELETON_PRESETS[0].id);
  assert.equal(chooseHomeSkeletonPreset(() => Number.NEGATIVE_INFINITY).id, HOME_SKELETON_PRESETS[0].id);
  assert.equal(chooseHomeSkeletonPreset(() => -1).id, HOME_SKELETON_PRESETS[0].id, "finite lower-bound samples are clamped");
  assert.equal(chooseHomeSkeletonPreset(() => 2).id, HOME_SKELETON_PRESETS.at(-1).id, "finite upper-bound samples are clamped");
});

test("HomeSkeleton renders and hydrates the same server-selected ID without choosing a client preset", async () => {
  const dom = installDom();
  const { createElement, act } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { hydrateRoot } = await import("react-dom/client");
  const { default: HomeSkeleton } = await import(await clientModule("app/home-skeleton.tsx"));
  const preset = chooseHomeSkeletonPreset(() => 0.63).id;
  const originalRandom = Math.random;
  let randomCalls = 0;
  let randomValue = 0.1;
  Math.random = () => { randomCalls++; return randomValue; };
  let hydratedRoot;
  const errors = [];
  const originalConsoleError = console.error;
  try {
    const callsBeforeRender = randomCalls;
    const markup = renderToString(createElement(HomeSkeleton, { preset, reducedMotion: true }));
    const container = document.getElementById("root");
    container.innerHTML = markup;
    const status = container.querySelector(".home-skeleton[role='status']");
    assert.ok(status);
    assert.equal(status.getAttribute("aria-label"), "Loading Home workspace");
    assert.equal(status.getAttribute("aria-busy"), "true");
    assert.equal(status.getAttribute("data-preset"), preset);
    assert.ok(status.classList.contains("home-skeleton--reduced"));
    assert.equal(container.querySelectorAll("[role='status']").length, 1, "the skeleton exposes one status announcement");
    const cards = [...container.querySelectorAll(".home-skeleton__card[data-size]")];
    assert.ok(cards.length > 0);
    assert.ok(cards.every((card) => card.childElementCount === 0), "skeleton widget footprints are empty outlines, without headers, icons, marks, or lines");
    assertTodayPlaceholder(status, "server-rendered Home skeleton");
    assert.equal(container.querySelectorAll(".home-skeleton__card-header, .home-skeleton__card-icon, .home-skeleton__card-title, .home-skeleton__card-menu, .home-skeleton__body, .home-skeleton__bar, .home-skeleton__list-mark, .home-skeleton__note-pin, .home-skeleton__calendar-day").length, 0);
    assert.equal(container.querySelectorAll(".home-skeleton button, .home-skeleton a, .home-skeleton input, .home-skeleton select, .home-skeleton textarea").length, 0, "decorative skeleton blocks are not fake controls");
    assert.equal(container.querySelectorAll(".home-skeleton__card[data-widget-id]").length, 0, "skeleton cards never claim real widget IDs");
    assert.equal(randomCalls, callsBeforeRender, "the component uses the provided preset instead of browser randomness");

    console.error = (...args) => { errors.push(args.map(String).join(" ")); originalConsoleError(...args); };
    randomValue = 0.999;
    await act(async () => { hydratedRoot = hydrateRoot(container, createElement(HomeSkeleton, { preset, reducedMotion: true })); });
    assert.equal(container.querySelector(".home-skeleton")?.getAttribute("data-preset"), preset);
    assert.doesNotMatch(errors.join("\n"), /hydration|server html|did not match/i, "the server-selected preset hydrates without markup mismatch");
  } finally {
    console.error = originalConsoleError;
    Math.random = originalRandom;
    if (hydratedRoot) await act(async () => hydratedRoot.unmount());
    dom.window.close();
  }
});

test("Workspace hydrates its server-selected pending Home preset without a mismatch", async () => {
  const dom = installDom();
  const { validateProfile } = await import(await clientModule("lib/profile.ts"));
  const profile = makeProfile(validateProfile);
  globalThis.__homeSkeletonTestProfile = profile;
  globalThis.__homeSkeletonTestModules = await import(await clientModule("lib/workspace-codec.ts"));
  const { default: Workspace } = await import(await clientModule("app/workspace-client.tsx"));
  const api = installWorkspaceFetch();
  const { renderToString } = await import("react-dom/server");
  const { hydrateRoot } = await import("react-dom/client");
  const preset = "weekly-pulse";
  const originalConsoleError = console.error;
  const errors = [];
  let root;
  try {
    const props = { initialProfile: profile, initialHomeSkeletonPreset: preset };
    const container = document.getElementById("root");
    container.innerHTML = renderToString(createElement(Workspace, props));
    assert.equal(container.querySelector(".home-skeleton")?.getAttribute("data-preset"), preset);
    console.error = (...args) => { errors.push(args.map(String).join(" ")); originalConsoleError(...args); };
    await act(async () => { root = hydrateRoot(container, createElement(Workspace, props)); });
    await waitFor(() => api.getCalls === 1, "hydrated Workspace's held Home read");
    assert.equal(container.querySelector(".home-skeleton")?.getAttribute("data-preset"), preset, "hydration retains the server-selected preset");
    assert.deepEqual(errors.filter((message) => /hydration|server html|did not match/i.test(message)), [], "the real Workspace shell hydrates without markup mismatch");
    assertTodayPlaceholder(container.querySelector(".home-skeleton"), "hydrated pending Workspace");
    assert.equal(container.querySelector(".home-load-transition__today-outline") !== null, false, "Workspace hydration has no transition outline before saved data arrives");
    assert.equal(api.writes, 0);
  } finally {
    console.error = originalConsoleError;
    if (root) await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.__homeSkeletonTestProfile;
    delete globalThis.__homeSkeletonTestModules;
  }
});

function makeProfile(validateProfile) {
  return {
    ...validateProfile({ display_name: "Alex", major: "History" }),
    id: "home-skeleton-test-profile",
    auth_user_id: "home-skeleton-test-user",
    email: "alex@example.invalid",
    avatar_url: null,
    initialized: true,
    updated_at: "2026-10-08T12:00:00.000Z",
    onboarding_completed_at: "2026-10-07T00:00:00.000Z",
  };
}

function installWorkspaceFetch({ failReads = 0, holdReads = true } = {}) {
  let getCalls = 0;
  let writes = 0;
  let failuresRemaining = failReads;
  const pending = [];
  const { encodeWorkspaceState } = globalThis.__homeSkeletonTestModules;
  const profile = globalThis.__homeSkeletonTestProfile;
  const dashboard = encodeWorkspaceState([
    { id: "saved-home", name: "Saved Home", widgets: [{ instanceId: "saved-note", type: "notes", size: "small", note: "Saved note" }] },
  ], "saved-home", "", { assignments: [], manualEvents: [], dashboardView: "cards" });
  const successPayload = () => ({ initialized: true, courses: [], dashboard, revision: profile.updated_at, profile });
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/files")) return Response.json({ files: [] });
    assert.ok(url.startsWith("/api/workspace"), `Unexpected test fetch ${url}`);
    if (init.method === "PUT") { writes++; return Response.json({ ok: true, revision: "2026-10-08T12:01:00.000Z" }); }
    if (init.method === "POST") return Response.json({ initialized: true, revision: profile.updated_at });
    getCalls++;
    if (failuresRemaining > 0) { failuresRemaining--; return Response.json({ error: "Workspace is temporarily offline." }, { status: 503 }); }
    if (holdReads) return await new Promise((resolve) => pending.push(resolve));
    return Response.json(successPayload());
  };
  globalThis.fetch = fetcher;
  window.fetch = fetcher;
  return {
    get getCalls() { return getCalls; },
    get writes() { return writes; },
    releaseNext() { pending.shift()?.(Response.json(successPayload())); },
  };
}

async function waitFor(predicate, description, timeoutMs = 1800) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  assert.ok(predicate(), `Timed out waiting for ${description}`);
}

async function renderWorkspace(Workspace, { path = "/home", profile, preset = HOME_SKELETON_PRESETS[0].id } = {}) {
  window.history.replaceState({}, "", path);
  const { createRoot } = await import("react-dom/client");
  const rootNode = document.getElementById("root");
  const root = createRoot(rootNode);
  await act(async () => root.render(createElement(Workspace, { initialProfile: profile, initialHomeSkeletonPreset: preset })));
  return { root, rootNode, act };
}

test("Home stays a presentational skeleton until its read succeeds, then shows the unchanged saved snapshot without a write", async () => {
  const dom = installDom();
  const { validateProfile } = await import(await clientModule("lib/profile.ts"));
  const profile = makeProfile(validateProfile);
  globalThis.__homeSkeletonTestProfile = profile;
  globalThis.__homeSkeletonTestModules = await import(await clientModule("lib/workspace-codec.ts"));
  const { default: Workspace } = await import(await clientModule("app/workspace-client.tsx"));
  const api = installWorkspaceFetch();
  const { root, rootNode, act } = await renderWorkspace(Workspace, { profile, preset: "calendar-focus" });
  try {
    await waitFor(() => api.getCalls === 1, "the held workspace read");
    const status = rootNode.querySelector(".home-skeleton[role='status']");
    assert.ok(status, "Home uses the selected skeleton while the saved workspace is unresolved");
    assert.ok(rootNode.querySelector('.home-load-transition[data-phase="pending"]'), "the Home transition reports its pending phase");
    assert.equal(status.getAttribute("data-preset"), "calendar-focus");
    assertTodayPlaceholder(status, "pending Home read");
    assert.equal(rootNode.querySelector(".home-load-transition__today-outline") !== null, false, "unresolved state has no saved-visibility transition overlay yet");
    assert.equal(rootNode.querySelector(".home-today-panel") !== null, false, "unresolved state does not render Today from local defaults");
    assert.ok([...rootNode.querySelectorAll(".home-skeleton__card[data-size]")].every((card) => card.childElementCount === 0), "the pending skeleton has empty widget footprints");
    assert.equal(rootNode.querySelectorAll("[data-widget-id]").length, 0, "no default or fake widget is shown before hydration");
    assert.equal(rootNode.querySelectorAll(".widget-grid").length, 0);
    assert.equal(api.writes, 0, "loading never sends a snapshot");

    const resolvedAt = Date.now();
    await act(async () => { api.releaseNext(); await Promise.resolve(); });
    await waitFor(() => rootNode.querySelector('[data-widget-id="saved-note"]'), "saved Home widgets after hydration");
    assert.ok(Date.now() - resolvedAt < 1200, "a successful read exits loading without an artificial minimum delay");
    assert.equal(rootNode.querySelector(".home-skeleton") !== null, false);
    assert.equal(rootNode.querySelector('[data-widget-id="saved-note"] textarea')?.value, "Saved note");
    assert.ok(rootNode.querySelector('.home-load-transition[data-phase="done"]'), "without WAAPI, a successful read reveals content immediately");
    assert.ok(rootNode.querySelector(".home-today-panel"), "a saved workspace with visible Today retains the real panel after loading");
    assert.equal(rootNode.querySelector(".home-load-transition__today-outline") !== null, false, "the Today outline does not remain over real content");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 760)));
    assert.equal(api.writes, 0, "hydrating an unchanged saved snapshot does not write it back");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.__homeSkeletonTestProfile;
    delete globalThis.__homeSkeletonTestModules;
  }
});

test("Home retry returns to the skeleton while other pages keep the existing loader", async () => {
  const dom = installDom();
  const { validateProfile } = await import(await clientModule("lib/profile.ts"));
  const profile = makeProfile(validateProfile);
  globalThis.__homeSkeletonTestProfile = profile;
  globalThis.__homeSkeletonTestModules = await import(await clientModule("lib/workspace-codec.ts"));
  const { default: Workspace } = await import(await clientModule("app/workspace-client.tsx"));
  const api = installWorkspaceFetch({ failReads: 1 });
  let app = await renderWorkspace(Workspace, { profile, preset: "study-rhythm" });
  try {
    await waitFor(() => app.rootNode.textContent.includes("could not be loaded"), "the existing load error message");
    assert.equal(app.rootNode.querySelector(".home-skeleton") !== null, false, "the skeleton is reserved for active loads, not errors");
    assert.equal(app.rootNode.querySelector(".home-load-transition") !== null, false, "the loading transition is removed on errors");
    assert.ok([...app.rootNode.querySelectorAll("button")].some((button) => button.textContent.trim() === "Retry loading"));
    assert.equal(api.writes, 0);

    const retry = [...app.rootNode.querySelectorAll("button")].find((button) => button.textContent.trim() === "Retry loading");
    await app.act(async () => retry.click());
    await waitFor(() => api.getCalls === 2, "the retry workspace read");
    await waitFor(() => app.rootNode.querySelector(".home-skeleton"), "Home skeleton during retry");
    assert.ok(app.rootNode.querySelector('.home-load-transition[data-phase="pending"]'), "retry starts with the selected loading phase");
    assert.equal(app.rootNode.querySelector(".home-skeleton")?.getAttribute("data-preset"), "study-rhythm");
    assert.equal(api.writes, 0);
    await app.act(async () => { api.releaseNext(); await Promise.resolve(); });
    await waitFor(() => app.rootNode.querySelector('[data-widget-id="saved-note"]'), "saved Home after retry");
    assert.equal(api.writes, 0, "retrying and hydrating do not write an unchanged snapshot");
    await app.act(async () => app.root.unmount());

    api.releaseNext();
    app = await renderWorkspace(Workspace, { path: "/calendar", profile });
    await waitFor(() => api.getCalls === 3, "the other-page workspace read");
    assert.ok(app.rootNode.querySelector(".workspace-loading.is-pending"), "non-Home routes retain the existing centered loader");
    assert.equal(app.rootNode.querySelector(".home-skeleton") !== null, false);
    assert.equal(app.rootNode.querySelector(".home-load-transition") !== null, false, "non-Home routes never mount the Home transition");
    assert.equal(app.rootNode.querySelectorAll("[data-widget-id]").length, 0);
    await app.act(async () => { api.releaseNext(); await Promise.resolve(); });
    await waitFor(() => !app.rootNode.querySelector(".workspace-loading.is-pending"), "calendar after the held read");
    assert.equal(api.writes, 0);
  } finally {
    await app.act(async () => app.root.unmount());
    dom.window.close();
    delete globalThis.__homeSkeletonTestProfile;
    delete globalThis.__homeSkeletonTestModules;
  }
});
