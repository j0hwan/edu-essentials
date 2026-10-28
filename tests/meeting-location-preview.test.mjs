import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clientModule } from "./helpers/client-modules.mjs";

const previewHelpers = await import(await clientModule("lib/meeting-location-preview.ts"));
const { buildMeetingWebsiteScreenshotUrl, buildOpenStreetMapUrls, classifyMeetingLocation, parseLocationCoordinates } = previewHelpers;

test("meeting locations distinguish safe public websites, unsafe URL-like text, and addresses", () => {
  const original = "https://courses.example.edu/schedule?token=private#week";
  const website = classifyMeetingLocation(original);
  assert.equal(website.kind, "website");
  assert.equal(website.href, original, "explicit website links preserve their original path, query, and fragment");
  assert.equal(website.hostname, "courses.example.edu");
  assert.equal(website.screenshotUrl, "https://image.thum.io/get/width/600/noanimate/https://courses.example.edu/");
  assert.doesNotMatch(website.screenshotUrl, /token|schedule|week/);

  const bare = classifyMeetingLocation("www.courses.example.edu/portal?key=secret");
  assert.equal(bare.kind, "website");
  assert.equal(bare.href, "https://www.courses.example.edu/portal?key=secret");
  assert.equal(bare.screenshotUrl, "https://image.thum.io/get/width/600/noanimate/https://www.courses.example.edu/");
  assert.equal(buildMeetingWebsiteScreenshotUrl(new URL("http://courses.example.edu:8080/private/path?auth=secret")), "https://image.thum.io/get/width/600/noanimate/http://courses.example.edu:8080/");

  const labelledExplicit = classifyMeetingLocation("Join https://zoom.us/j/123?pwd=secret");
  assert.equal(labelledExplicit.kind, "website");
  assert.equal(labelledExplicit.href, "https://zoom.us/j/123?pwd=secret");
  assert.equal(labelledExplicit.screenshotUrl, "https://image.thum.io/get/width/600/noanimate/https://zoom.us/");
  const labelledBare = classifyMeetingLocation("Join zoom.us/j/123?pwd=secret");
  assert.equal(labelledBare.kind, "website");
  assert.equal(labelledBare.href, "https://zoom.us/j/123?pwd=secret");
  assert.equal(labelledBare.screenshotUrl, "https://image.thum.io/get/width/600/noanimate/https://zoom.us/");
  assert.equal(classifyMeetingLocation("Join https://10.0.0.1/j/123?pwd=secret").kind, "unsupported");
  assert.equal(classifyMeetingLocation("Join zoom.us or webex.com").kind, "unsupported");
  assert.equal(classifyMeetingLocation("student@courses.example.edu").kind, "unsupported");
  assert.equal(classifyMeetingLocation("Join bad..domain/path").kind, "unsupported");

  for (const unsafe of [
    "javascript:alert(1)", "file:///etc/passwd", "ftp://courses.example.edu/", "https:missing-slashes.example.edu",
    "https://user:secret@courses.example.edu/path", "https://localhost/", "https://class.localhost/",
    "https://192.168.1.25/", "https://127.0.0.1/", "https://[::1]/", "https://campus.internal/",
    "https://example.invalid/", "https://bad..example.edu/",
    "Join //localhost/private?token=secret", "Join //10.0.0.1/j/123?pwd=secret",
  ]) {
    assert.equal(classifyMeetingLocation(unsafe).kind, "unsupported", unsafe);
  }

  assert.deepEqual(classifyMeetingLocation("123 College Ave, Davis"), { kind: "address", address: "123 College Ave, Davis" });
  assert.equal(classifyMeetingLocation("Bldg.").kind, "address");
  assert.equal(classifyMeetingLocation("example.edu/path").kind, "website");
  assert.equal(classifyMeetingLocation("" ).kind, "empty");
});

test("OSM URLs encode a bounded bbox and validated coordinates", () => {
  const urls = buildOpenStreetMapUrls(38.5449, -121.7405);
  assert.ok(urls);
  const embed = new URL(urls.embedUrl);
  assert.equal(embed.origin, "https://www.openstreetmap.org");
  assert.equal(embed.pathname, "/export/embed.html");
  assert.equal(embed.searchParams.get("layer"), "mapnik");
  assert.equal(embed.searchParams.get("marker"), "38.5449,-121.7405");
  const bounds = embed.searchParams.get("bbox").split(",").map(Number);
  assert.equal(bounds.length, 4);
  assert.ok(bounds[0] < -121.7405 && bounds[2] > -121.7405);
  assert.ok(bounds[1] < 38.5449 && bounds[3] > 38.5449);
  const map = new URL(urls.mapUrl);
  assert.equal(map.searchParams.get("mlat"), "38.5449");
  assert.equal(map.searchParams.get("mlon"), "-121.7405");
  assert.equal(buildOpenStreetMapUrls(91, 0), null);
  assert.deepEqual(parseLocationCoordinates({ locations: [{ latitude: 91, longitude: 0 }, { latitude: 1, longitude: 2 }] }), { latitude: 1, longitude: 2 });
  assert.equal(parseLocationCoordinates({ locations: [{ latitude: "1", longitude: "2" }] }), null);
});

test("meeting preview aborts stale lookups, uses coordinates, and falls back after errors", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://edu.example/", pretendToBeVisual: true });
  for (const name of ["window", "document", "HTMLElement", "Element", "Node", "Event"]) globalThis[name] = dom.window[name];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const [{ createElement, act }, { createRoot }, { default: MeetingLocationPreview }] = await Promise.all([
    import("react"), import("react-dom/client"), import(await clientModule("app/meeting-location-preview.tsx")),
  ]);
  const originalFetch = globalThis.fetch;
  const pending = [];
  globalThis.fetch = (url, options) => {
    const request = { url, options };
    pending.push(request);
    if (url.includes("Unknown%20Hall")) return Promise.reject(new Error("offline"));
    return new Promise((resolve) => { request.resolve = resolve; });
  };
  const rootNode = document.getElementById("root");
  const root = createRoot(rootNode);
  const render = (location) => act(async () => root.render(createElement(MeetingLocationPreview, { location })));
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await act(async () => root.unmount());
    dom.window.close();
  });

  await render("North Hall");
  assert.equal(pending[0].url, "/api/locations?q=North%20Hall");
  assert.equal(pending[0].options.method, "GET");
  assert.ok(pending[0].options.signal instanceof AbortSignal);
  assert.match(rootNode.textContent, /Loading map preview/);

  await render("South Hall");
  assert.equal(pending.length, 2);
  assert.equal(pending[0].options.signal.aborted, true, "changing the location aborts the previous request");
  await act(async () => {
    pending[0].resolve(Response.json({ locations: [{ latitude: 12, longitude: 34 }] }));
    pending[1].resolve(Response.json({ locations: [{ latitude: 38.5449, longitude: -121.7405 }] }));
    await flush();
  });
  const iframe = rootNode.querySelector("iframe");
  assert.ok(iframe, "a valid address result renders an OSM map");
  assert.equal(new URL(iframe.src).searchParams.get("marker"), "38.5449,-121.7405", "the stale North Hall result never paints");
  assert.equal(iframe.getAttribute("loading"), "lazy");
  assert.equal(iframe.getAttribute("tabindex"), "-1");
  assert.match(iframe.title, /South Hall/);
  const mapLink = rootNode.querySelector("a.meeting-location-preview");
  assert.equal(new URL(mapLink.href).origin, "https://www.openstreetmap.org");
  assert.equal(mapLink.getAttribute("referrerpolicy"), "no-referrer");

  await render("South Hall");
  assert.equal(pending.length, 2, "cached location results avoid another Photon request");

  await render("Unknown Hall");
  await act(async () => flush());
  assert.match(rootNode.textContent, /Map preview unavailable/, "failed geocoding uses the stable map fallback");

  const twins = (count) => createElement("div", null, ...Array.from({ length: count }, (_, index) => createElement(MeetingLocationPreview, { key: String(index), location: "Twin Wing" })));
  await act(async () => root.render(twins(2)));
  const twinRequests = pending.filter((request) => request.url.includes("Twin%20Wing"));
  assert.equal(twinRequests.length, 1, "duplicate mounted previews share one Photon request");
  await act(async () => root.render(twins(1)));
  assert.equal(twinRequests[0].options.signal.aborted, false, "removing one subscriber keeps a shared request alive for the other");
  await act(async () => {
    twinRequests[0].resolve(Response.json({ locations: [{ latitude: 41, longitude: -72 }] }));
    await flush();
  });
  assert.equal(rootNode.querySelectorAll("iframe").length, 1, "remaining subscribers receive the shared map result");

  await render("Join https://zoom.us/j/123?pwd=secret");
  let labelledLink = rootNode.querySelector("a.meeting-location-preview");
  assert.equal(labelledLink.getAttribute("href"), "https://zoom.us/j/123?pwd=secret");
  assert.equal(labelledLink.querySelector("img").getAttribute("src"), "https://image.thum.io/get/width/600/noanimate/https://zoom.us/");
  await render("Join zoom.us/j/123?pwd=secret");
  labelledLink = rootNode.querySelector("a.meeting-location-preview");
  assert.equal(labelledLink.getAttribute("href"), "https://zoom.us/j/123?pwd=secret");
  assert.equal(pending.length, 4, "labelled URLs never send their meeting token to Photon");
  await render("Join https://10.0.0.1/j/123?pwd=secret");
  assert.equal(pending.length, 4, "unsafe labeled URLs never trigger geocoding");
  await render("Join //localhost/private?token=secret");
  await render("Join //10.0.0.1/j/123?pwd=secret");
  assert.equal(pending.length, 4, "labelled protocol-relative URLs never trigger geocoding");
  assert.match(rootNode.textContent, /Map preview unavailable/);

  const original = "https://courses.example.edu/schedule?token=private#week";
  await render(original);
  const websiteLink = rootNode.querySelector("a.meeting-location-preview");
  const image = websiteLink.querySelector("img");
  assert.equal(websiteLink.getAttribute("href"), original);
  assert.equal(websiteLink.getAttribute("rel"), "noopener noreferrer");
  assert.equal(websiteLink.getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(image.getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(image.getAttribute("src"), "https://image.thum.io/get/width/600/noanimate/https://courses.example.edu/");
  await act(async () => image.dispatchEvent(new dom.window.Event("error")));
  assert.match(rootNode.textContent, /courses\.example\.edu/, "image failures show the website hostname fallback");
  assert.equal(rootNode.querySelector("img"), null);

  await render("file:///private/path");
  assert.equal(pending.length, 4, "unsafe URL-like strings never trigger address geocoding");
  assert.match(rootNode.textContent, /Map preview unavailable/);
  await render("x".repeat(161));
  assert.equal(pending.length, 4, "address searches stay within the existing 160 character bound");
  assert.match(rootNode.textContent, /Map preview unavailable/);
});
