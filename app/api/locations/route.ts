import { apiError, requireProfile } from "../../../lib/auth";
import { searchLocations, type LocationSuggestion } from "../../../lib/locations";

const rates = new Map<string, { count: number; expires: number }>();
const cache = new Map<string, { locations: LocationSuggestion[]; expires: number }>();
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "private, no-store" } });

export async function GET(request: Request): Promise<Response> {
  try {
    const profile = await requireProfile(false);
    const queries = new URL(request.url).searchParams.getAll("q");
    const query = queries[0]?.trim() ?? "";
    if (queries.length !== 1 || query.length > 160) return json({ error: "Enter a location up to 160 characters." }, 400);
    if (query.length < 3) return json({ locations: [] });
    const now = Date.now();
    for (const [key, entry] of rates) if (entry.expires <= now) rates.delete(key);
    const rate = rates.get(String(profile.id)) ?? { count: 0, expires: now + 60_000 };
    if (rate.count >= 30) return json({ error: "Please wait before searching again. You can still enter a location." }, 429);
    if (rates.size >= 1024 && !rates.has(String(profile.id))) rates.delete(rates.keys().next().value!);
    rates.set(String(profile.id), { ...rate, count: rate.count + 1 });
    const key = query.toLowerCase();
    for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
    const cached = cache.get(key);
    if (cached) return json({ locations: cached.locations });
    try {
      const locations = await searchLocations(query);
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      cache.set(key, { locations, expires: Date.now() + 300_000 });
      return json({ locations });
    } catch {
      return json({ error: "Address search is unavailable. You can enter a location manually." }, 503);
    }
  } catch (error) {
    return apiError(error);
  }
}
