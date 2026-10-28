import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { clientModule } from "./helpers/client-modules.mjs";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const state = globalThis.__locationRouteTests = { signedIn: true, profileId: "location-user" };
const authUrl = moduleUrl(`
  export async function requireProfile() {
    if (!globalThis.__locationRouteTests.signedIn) throw new Error("Sign in");
    return { id: globalThis.__locationRouteTests.profileId };
  }
  export function apiError() { return Response.json({ error: "Sign in" }, { status: 401 }); }
`);
let source = await readFile(new URL("../app/api/locations/route.ts", import.meta.url), "utf8");
source = source.replace('"../../../lib/auth"', JSON.stringify(authUrl)).replace('"../../../lib/locations"', JSON.stringify(await clientModule("lib/locations.ts")));
const { GET } = await import(moduleUrl(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText));
const request = (query) => GET(new Request(`https://edu.example/api/locations${query}`));

test("location route requires sign-in, validates queries, caches and limits provider requests", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ features: [{ properties: { street: "College Ave", housenumber: "10" } }] }); };
  try {
    state.signedIn = false;
    assert.equal((await request("?q=College")).status, 401);
    state.signedIn = true;
    assert.equal((await request("")).status, 400);
    assert.equal((await request("?q=a&q=b")).status, 400);
    assert.equal((await request(`?q=${"x".repeat(161)}`)).status, 400);
    assert.deepEqual(await (await request("?q=ab")).json(), { locations: [] });
    assert.equal(calls, 0);
    const response = await request("?q=College");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).locations[0].address, "10 College Ave");
    await request("?q=college");
    assert.equal(calls, 1);
    for (let index = 0; index < 28; index++) assert.equal((await request("?q=College")).status, 200);
    assert.equal((await request("?q=College")).status, 429);
    state.profileId = "another-user";
    globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
    assert.equal((await request("?q=Different")).status, 503);
  } finally { globalThis.fetch = originalFetch; }
});
