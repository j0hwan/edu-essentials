import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { clientModule } from "./helpers/client-modules.mjs";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

async function compile(path, imports = {}) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [name, replacement] of Object.entries(imports)) source = source.replaceAll(`"${name}"`, JSON.stringify(replacement));
  return moduleUrl(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}

const state = globalThis.__schoolRouteTests = { profile: null, required: [], authError: null };
const authUrl = moduleUrl(`
  export class AuthError extends Error { constructor(message, status) { super(message); this.status = status; } }
  export async function requireProfile(onboarded = true) {
    globalThis.__schoolRouteTests.required.push(onboarded);
    if (globalThis.__schoolRouteTests.authError) throw new AuthError(globalThis.__schoolRouteTests.authError.message, globalThis.__schoolRouteTests.authError.status);
    if (!globalThis.__schoolRouteTests.profile) throw new AuthError("Please sign in with Google.", 401);
    if (onboarded && !globalThis.__schoolRouteTests.profile.onboarding_completed_at) throw new AuthError("Complete your profile first.", 403);
    return globalThis.__schoolRouteTests.profile;
  }
  export function apiError(error) {
    const status = error instanceof AuthError ? error.status : 503;
    return Response.json({ error: error instanceof AuthError ? error.message : "Account unavailable." }, { status, headers: { "cache-control": "no-store" } });
  }
`);
const schoolsUrl = await clientModule("lib/schools.ts");
const api = await import(await compile("app/api/schools/route.ts", {
  "../../../lib/auth": authUrl,
  "../../../lib/schools": schoolsUrl,
}));
const { parsePhotonSchools, photonSearchUrl } = await import(schoolsUrl);

function reset(profileId = "profile-incomplete") {
  state.profile = { id: profileId, onboarding_completed_at: null };
  state.required = [];
  state.authError = null;
}

function request(query, type = "high-school") {
  const url = new URL("https://edu.example/api/schools");
  if (query !== undefined) url.searchParams.set("q", query);
  if (type !== undefined) url.searchParams.set("type", type);
  return new Request(url);
}

function feature(name, extra = {}) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-122.33, 47.60] },
    properties: { name, osm_type: "W", osm_id: 1234, osm_key: "amenity", osm_value: "school", city: "Seattle", state: "Washington", country: "USA", ...extra },
  };
}

function setPhoton(body, options = {}) {
  globalThis.fetch = async (input, init) => {
    options.calls?.push({ url: new URL(input), init });
    if (options.fail) throw new Error("secret upstream detail");
    return new Response(JSON.stringify(body), { status: options.status ?? 200, headers: { "content-type": "application/geo+json" } });
  };
}

test("Photon requests are fixed, bounded, and contain no coordinate parameters", () => {
  const highSchool = photonSearchUrl("North Ridge", "high-school");
  assert.equal(highSchool.origin, "https://photon.komoot.io");
  assert.equal(highSchool.pathname, "/api/");
  assert.equal(highSchool.searchParams.get("q"), "North Ridge");
  assert.equal(highSchool.searchParams.get("limit"), "8");
  assert.equal(highSchool.searchParams.get("include"), "osm.amenity.school");
  const college = photonSearchUrl("North Ridge", "college");
  assert.equal(college.searchParams.get("include"), "osm.amenity.college,osm.amenity.university");
  assert.deepEqual([...highSchool.searchParams.keys()].sort(), ["include", "limit", "q"]);
});

test("Photon parser limits, validates, maps text-only locations, and deduplicates schools", () => {
  const parsed = parsePhotonSchools({ features: [
    feature("  North Ridge   High School "),
    feature("North Ridge High School", { osm_id: 4321 }),
    feature("Not a school", { osm_key: "place", osm_value: "city" }),
    feature("Wrong institution", { osm_value: "university" }),
    feature(" "),
    feature("N".repeat(161)),
    { type: "Feature", properties: null },
    feature("Unnamed but tagged"),
  ] }, "high-school");
  assert.deepEqual(parsed, [{ id: "way-1234", name: "North Ridge High School", location: "Seattle, Washington, USA" }]);
  assert.equal(JSON.stringify(parsed).includes("coordinates"), false);

  const collegeFeatures = { features: [
    feature("Elementary School"),
    feature("City College", { osm_value: "college" }),
    feature("State University", { osm_value: "university", osm_id: null, osm_type: null }),
  ] };
  const colleges = parsePhotonSchools(collegeFeatures, "college");
  assert.deepEqual(colleges.map(({ name }) => name), ["City College", "State University"]);
  assert.match(colleges[1].id, /^school-[0-9a-z]+$/);
  assert.equal(colleges[1].id, parsePhotonSchools(collegeFeatures, "college")[1].id);
});

test("authenticated incomplete-onboarding users can search and receive no-store suggestions", async () => {
  reset("profile-autocomplete-main");
  const calls = [];
  setPhoton({ features: [feature("North Ridge High School")] }, { calls });

  const response = await api.GET(request("  North Ridge  "));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { schools: [{ id: "way-1234", name: "North Ridge High School", location: "Seattle, Washington, USA" }] });
  assert.deepEqual(state.required, [false]);
  assert.equal(state.profile.onboarding_completed_at, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("q"), "North Ridge");
  assert.equal(calls[0].init.method, "GET");
});

test("short searches return no results without an upstream call; malformed query values are rejected", async () => {
  reset("profile-short-query");
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("{}", { status: 200 }); };
  const short = await api.GET(request(" a "));
  assert.equal(short.status, 200);
  assert.deepEqual(await short.json(), { schools: [] });
  assert.equal(calls, 0);

  for (const invalid of [request(undefined), request("ok", "trade-school"), request("x".repeat(121)), new Request("https://edu.example/api/schools?q=a&q=b&type=college")]) {
    const response = await api.GET(invalid);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(calls, 0);
});

test("unauthenticated and rejected users cannot access the endpoint", async () => {
  state.profile = null;
  state.authError = null;
  state.required = [];
  const missing = await api.GET(request("test"));
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get("cache-control"), "no-store");

  reset("profile-auth-failure");
  state.authError = Object.assign(new Error("Please sign in."), { status: 401 });
  const failed = await api.GET(request("test"));
  assert.equal(failed.status, 401);
});

test("upstream failures return a readable generic error and do not expose provider details", async () => {
  reset("profile-upstream-failure");
  setPhoton({}, { fail: true });
  const response = await api.GET(request("private-ish query"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "School search is unavailable. You can enter your school." });
});

test("public result caching reduces provider calls and authenticated profiles are rate limited", async () => {
  reset("profile-rate-test");
  const calls = [];
  setPhoton({ features: [feature("Rate Limit Academy")] }, { calls });
  for (let index = 0; index < 30; index += 1) {
    const response = await api.GET(request("Rate Limit Academy"));
    assert.equal(response.status, 200);
  }
  assert.equal(calls.length, 1);
  const blocked = await api.GET(request("Rate Limit Academy"));
  assert.equal(blocked.status, 429);
  assert.equal(calls.length, 1);
});
