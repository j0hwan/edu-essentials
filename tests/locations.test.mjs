import assert from "node:assert/strict";
import test from "node:test";
import { clientModule } from "./helpers/client-modules.mjs";

const { parsePhotonLocations, searchLocations } = await import(await clientModule("lib/locations.ts"));
const feature = (properties) => ({ properties });

test("address suggestions format public map results, deduplicate, and reject invalid data", () => {
  const school = feature({ name: "Science Hall", housenumber: "10", street: "College Ave", city: "Davis", state: "California", postcode: "95616", country: "United States" });
  assert.deepEqual(parsePhotonLocations({ features: [school, school, null, feature({}), feature({ name: "x".repeat(161) })] }), [{ id: "location-0", address: "Science Hall, 10 College Ave, Davis, California, 95616, United States" }]);
  assert.throws(() => parsePhotonLocations({ error: "Unavailable" }));
  assert.deepEqual(parsePhotonLocations({ features: [feature({ street: "Main St", town: "Springfield" })] }).map((item) => item.address), ["Main St, Springfield"]);
});

test("address search uses a fixed provider, encoded query, bounded results, and timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url.origin, "https://photon.komoot.io");
    assert.equal(url.searchParams.get("q"), "10 Main & College");
    assert.equal(url.searchParams.get("limit"), "8");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ features: [feature({ housenumber: "10", street: "Main St" })] });
  };
  try {
    assert.equal((await searchLocations("10 Main & College"))[0].address, "10 Main St");
    globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
    await assert.rejects(searchLocations("10 Main"));
  } finally { globalThis.fetch = originalFetch; }
});
