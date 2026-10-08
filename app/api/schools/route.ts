import { apiError, requireProfile } from "../../../lib/auth";
import { SchoolSearchUnavailableError, searchPhotonSchools, type SchoolSuggestion, type SchoolType } from "../../../lib/schools";

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_LIMIT = 128;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const RATE_PROFILE_LIMIT = 1_024;
const UNAVAILABLE_MESSAGE = "School search is unavailable. You can enter your school.";

const cache = new Map<string, { expiresAt: number; schools: SchoolSuggestion[] }>();
const profileRates = new Map<string, { expiresAt: number; count: number }>();

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
}

function getCached(key: string, now: number): SchoolSuggestion[] | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return entry.schools;
}

function cacheSchools(key: string, schools: SchoolSuggestion[], now: number): void {
  for (const [cachedKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(cachedKey);
  }
  while (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, schools });
}

function allowProfileRequest(profileId: string, now: number): boolean {
  let entry = profileRates.get(profileId);
  if (entry && entry.expiresAt <= now) {
    profileRates.delete(profileId);
    entry = undefined;
  }
  if (!entry) {
    for (const [id, bucket] of profileRates) {
      if (bucket.expiresAt <= now) profileRates.delete(id);
    }
    while (profileRates.size >= RATE_PROFILE_LIMIT) {
      const oldest = profileRates.keys().next().value;
      if (oldest === undefined) break;
      profileRates.delete(oldest);
    }
    entry = { expiresAt: now + RATE_WINDOW_MS, count: 0 };
    profileRates.set(profileId, entry);
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

function parseQuery(request: Request): { query: string; type: SchoolType } | null {
  const params = new URL(request.url).searchParams;
  const queries = params.getAll("q");
  const types = params.getAll("type");
  if (queries.length !== 1 || types.length !== 1) return null;

  const query = queries[0].trim();
  const rawType = types[0];
  if (query.length > 120 || (rawType !== "high-school" && rawType !== "college")) return null;
  return { query, type: rawType };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const profile = await requireProfile(false);
    const parsed = parseQuery(request);
    if (!parsed) return json({ error: "Enter a school search and choose a valid school type." }, 400);
    if (parsed.query.length < 2) return json({ schools: [] });

    const now = Date.now();
    if (!allowProfileRequest(String(profile.id), now)) {
      return json({ error: "Please wait before searching for another school." }, 429);
    }

    const cacheKey = `${parsed.type}\u0000${parsed.query.toLowerCase()}`;
    const cached = getCached(cacheKey, now);
    if (cached) return json({ schools: cached });

    const schools = await searchPhotonSchools(parsed.query, parsed.type);
    cacheSchools(cacheKey, schools, Date.now());
    return json({ schools });
  } catch (error) {
    if (error instanceof SchoolSearchUnavailableError) return json({ error: UNAVAILABLE_MESSAGE }, 503);
    return apiError(error);
  }
}
