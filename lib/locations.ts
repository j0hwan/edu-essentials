export type LocationSuggestion = { id: string; address: string; latitude?: number; longitude?: number };

export function parsePhotonLocations(payload: unknown): LocationSuggestion[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { features?: unknown }).features)) throw new Error("Invalid location search response.");
  const suggestions: LocationSuggestion[] = [];
  const seen = new Set<string>();
  for (const feature of (payload as { features: unknown[] }).features.slice(0, 8)) {
    if (!feature || typeof feature !== "object") continue;
    const properties = (feature as { properties?: Record<string, unknown> }).properties;
    if (!properties || typeof properties !== "object") continue;
    const coordinates = (feature as { geometry?: { coordinates?: unknown } }).geometry?.coordinates;
    const longitude = Array.isArray(coordinates) && typeof coordinates[0] === "number" ? coordinates[0] : undefined;
    const latitude = Array.isArray(coordinates) && typeof coordinates[1] === "number" ? coordinates[1] : undefined;
    const part = (key: string) => typeof properties[key] === "string" ? properties[key].trim().replace(/\s+/g, " ") : "";
    const street = [part("housenumber"), part("street")].filter(Boolean).join(" ");
    const address = [part("name"), street, part("city") || part("town") || part("village"), part("state"), part("postcode"), part("country")].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(", ");
    if (!address || address.length > 160 || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    const suggestion: LocationSuggestion = { id: `location-${suggestions.length}`, address };
    if (latitude !== undefined && longitude !== undefined && Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
      suggestion.latitude = latitude;
      suggestion.longitude = longitude;
    }
    suggestions.push(suggestion);
  }
  return suggestions;
}

export async function searchLocations(query: string): Promise<LocationSuggestion[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Location search unavailable.");
  return parsePhotonLocations(await response.json());
}
