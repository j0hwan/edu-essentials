import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import test, { before, after } from "node:test";

let base = process.env.TEST_BASE_URL || "http://127.0.0.1:3101";
let server;
before(async () => {
  let reuse = !!process.env.TEST_BASE_URL;
  if (!reuse) {
    try {
      const lock = JSON.parse(await readFile(new URL("../.vinext/dev/lock.json", import.meta.url), "utf8"));
      process.kill(lock.pid, 0);
      const url = new URL(lock.appUrl);
      if (["127.0.0.1", "localhost"].includes(url.hostname)) { base = url.origin; reuse = true; }
    } catch { /* No live development server for this project. */ }
  }
  let output = "";
  if (!reuse) {
    server = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "dev", "--hostname", "127.0.0.1", "--port", "3101"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    server.stdout.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
    server.stderr.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
  }
  for (let attempt = 0; attempt < 90; attempt++) {
    if (server && server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    try { if ((await fetch(`${base}/login`, { signal: AbortSignal.timeout(3000) })).ok) return; } catch { /* Wait for compilation. */ }
    await setTimeout(500);
  }
  throw new Error("Test server did not start");
});
after(() => server?.kill());

test("public login offers only Google sign-in and no dashboard data", async () => {
  const response = await fetch(`${base}/login`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Continue with Google/);
  assert.match(html, /action="\/auth\/google"/);
  assert.match(html, /method="post"/i);
  assert.doesNotMatch(html, /type="password"|Maya Chen|Limits problem set/);
  assert.match(html, /href="\/overview"/);
});
test("overview is available without signing in", async () => {
  assert.equal((await fetch(`${base}/overview`, { redirect: "manual" })).status, 200);
});
test("private pages and unknown routes reject anonymous and legacy-cookie visitors", async () => {
  for (const path of ["/", "/dashboard", "/onboarding", "/settings", "/future-page", "/private.json"]) {
    const response = await fetch(base + path, { redirect: "manual", headers: { cookie: "eduessentials_profile=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
    assert.equal(response.status, 307, path);
    assert.equal(new URL(response.headers.get("location"), base).pathname, "/login");
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});
test("every private API verb returns 401 without an account", async () => {
  for (const [path, methods] of [["/api/workspace", ["GET", "POST", "PUT", "DELETE"]], ["/api/profile", ["GET", "PUT"]], ["/api/files", ["GET", "POST", "PUT", "DELETE"]], ["/api/export", ["GET"]]]) {
    for (const method of methods) assert.equal((await fetch(base + path, { method, redirect: "manual", headers: { origin: base } })).status, 401, `${method} ${path}`);
  }
});
test("Google OAuth creates an HttpOnly PKCE verifier and fixed callback", async () => {
  const response = await fetch(`${base}/auth/google`, { method: "POST", redirect: "manual", headers: { origin: base } });
  assert.equal(response.status, 303);
  const target = new URL(response.headers.get("location"), base);
  assert.equal(target.pathname, "/auth/v1/authorize");
  assert.equal(target.searchParams.get("provider"), "google");
  assert.equal(target.searchParams.get("redirect_to"), `${base}/auth/callback`);
  assert.equal(target.searchParams.get("code_challenge_method"), "s256");
  assert.ok(target.searchParams.get("code_challenge"));
  assert.ok(response.headers.getSetCookie().some((cookie) => /code-verifier/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie)));
});
test("cross-origin login and signout are rejected", async () => {
  const login = await fetch(`${base}/auth/google`, { method: "POST", headers: { origin: "https://unrelated.example" }, redirect: "manual" });
  assert.equal(login.status, 403);
  assert.equal(login.headers.getSetCookie().length, 0);
  const signout = await fetch(`${base}/auth/signout`, { method: "POST", headers: { origin: "https://unrelated.example" }, redirect: "manual" });
  assert.equal(signout.status, 403);
});
test("cancelled callback cannot redirect to an attacker-supplied next URL", async () => {
  const response = await fetch(`${base}/auth/callback?error=access_denied&next=https://unrelated.example`, { redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login?error=callback");
});
