export type SchoolType = "high-school" | "college";

export interface SchoolSuggestion {
  id: string;
  name: string;
  location: string;
}

const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
const HIGH_SCHOOL_AMENITIES = new Set(["school"]);
const COLLEGE_AMENITIES = new Set(["college", "university"]);

export class SchoolSearchUnavailableError extends Error {
  constructor() {
    super("School search is unavailable.");
    this.name = "SchoolSearchUnavailableError";
  }
}

export function photonSearchUrl(query: string, type: SchoolType): URL {
  const url = new URL(PHOTON_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set(
    "include",
    type === "high-school"
      ? "osm.amenity.school"
      : "osm.amenity.college,osm.amenity.university",
  );
  return url;
}

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function matchesInstitution(properties: Record<string, unknown>, type: SchoolType): boolean {
  const rawKey = properties.osm_key;
  const rawValue = properties.osm_value;
  const key = normalizedText(rawKey).toLowerCase();
  const value = normalizedText(rawValue).toLowerCase();
  const hasKey = typeof rawKey === "string" && rawKey.trim().length > 0;
  const hasValue = typeof rawValue === "string" && rawValue.trim().length > 0;

  // Photon is queried with an OSM amenity include filter. When it also sends
  // the principal OSM tag, enforce it so an unrelated feature cannot become a
  // school suggestion.
  if (hasKey && key !== "amenity") return false;
  if (hasValue) {
    const allowed = type === "high-school" ? HIGH_SCHOOL_AMENITIES : COLLEGE_AMENITIES;
    if (!allowed.has(value)) return false;
  }
  return true;
}

function locationPart(value: unknown): string {
  const text = normalizedText(value);
  return text.length > 0 && text.length <= 80 ? text : "";
}

function osmId(properties: Record<string, unknown>): string | null {
  const rawType = normalizedText(properties.osm_type).toLowerCase();
  const rawId = properties.osm_id;
  const types: Record<string, string> = {
    n: "node", node: "node",
    w: "way", way: "way",
    r: "relation", relation: "relation",
  };
  const type = types[rawType];
  const id = typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0
    ? String(rawId)
    : typeof rawId === "string" && /^\d{1,20}$/.test(rawId)
      ? rawId
      : "";
  return type && id ? `${type}-${id}` : null;
}

function fallbackId(name: string, location: string): string {
  const value = `${name.toLowerCase()}\u0000${location.toLowerCase()}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return `school-${(hash >>> 0).toString(36)}`;
}

export function parsePhotonSchools(payload: unknown, type: SchoolType): SchoolSuggestion[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { features?: unknown }).features)) {
    throw new SchoolSearchUnavailableError();
  }

  const features = (payload as { features: unknown[] }).features;
  const schools: SchoolSuggestion[] = [];
  const seen = new Set<string>();
  const seenOsmIds = new Set<string>();

  for (const feature of features.slice(0, 8)) {
    if (!feature || typeof feature !== "object") continue;
    const properties = (feature as { properties?: unknown }).properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) continue;
    const record = properties as Record<string, unknown>;
    const name = normalizedText(record.name);
    if (!name || name.length > 160 || !matchesInstitution(record, type)) continue;

    const location = [record.city, record.state, record.country]
      .map(locationPart)
      .filter(Boolean)
      .filter((part, index, parts) => parts.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index)
      .join(", ");
    const dedupeKey = `${name.toLowerCase()}\u0000${location.toLowerCase()}`;
    const externalId = osmId(record);
    if (seen.has(dedupeKey) || (externalId && seenOsmIds.has(externalId))) continue;
    seen.add(dedupeKey);
    if (externalId) seenOsmIds.add(externalId);

    schools.push({ id: externalId ?? fallbackId(name, location), name, location });
    if (schools.length === 8) break;
  }

  return schools;
}

export async function searchPhotonSchools(query: string, type: SchoolType): Promise<SchoolSuggestion[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(photonSearchUrl(query, type), {
      method: "GET",
      headers: { accept: "application/geo+json, application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new SchoolSearchUnavailableError();
    return parsePhotonSchools(await response.json(), type);
  } catch {
    throw new SchoolSearchUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}
