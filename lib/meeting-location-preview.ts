export type MeetingLocationTarget =
  | { kind: "empty" }
  | { kind: "address"; address: string }
  | { kind: "website"; href: string; hostname: string; screenshotUrl: string }
  | { kind: "unsupported" };

const RESERVED_SUFFIXES = [
  ".localhost", ".local", ".localdomain", ".internal", ".intranet", ".test", ".example", ".invalid", ".onion", ".arpa", ".lan",
];

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || RESERVED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return false;
  // Keep external previews on public DNS names. This excludes private, reserved, and
  // alternate numeric IP spellings without needing to resolve or fetch the host.
  if (normalized.startsWith("[") || /^[\d.]+$/.test(normalized)) return false;
  const labels = normalized.split(".");
  if (labels.length < 2 || labels.some((label) => !label || label.length > 63 || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))) return false;
  return !/^\d+$/.test(labels.at(-1) ?? "");
}

export function buildMeetingWebsiteScreenshotUrl(url: URL): string {
  return `https://image.thum.io/get/width/600/noanimate/${url.origin}/`;
}

function websiteTarget(input: string, candidate: string): MeetingLocationTarget {
  try {
    const url = new URL(candidate);
    const authority = candidate.match(/^https?:\/\/([^/?#]*)/i)?.[1] ?? "";
    if ((url.protocol !== "https:" && url.protocol !== "http:") || authority.includes("@") || url.username || url.password || !isPublicHostname(url.hostname)) return { kind: "unsupported" };
    return { kind: "website", href: input, hostname: url.hostname.replace(/^\[|\]$/g, ""), screenshotUrl: buildMeetingWebsiteScreenshotUrl(url) };
  } catch {
    return { kind: "unsupported" };
  }
}

function isUrlLikeWithoutScheme(value: string): boolean {
  if (/^\/\//.test(value)) return true;
  if (/^www(?:\.|$)/i.test(value)) return true;
  if (/\s/.test(value)) return false;
  const authority = value.split(/[/?#]/, 1)[0];
  const dottedLabels = authority.split(".").filter(Boolean).length;
  return dottedLabels >= 2 || /^[\d.]+$/.test(authority) || /[/:@?#]/.test(value);
}

function embeddedUrlTarget(value: string): MeetingLocationTarget | null {
  if (/(?:^|\s)\/\/\S/.test(value)) return { kind: "unsupported" };
  const schemes = [...value.matchAll(/\b([a-z][a-z\d+.-]*):(?=\S)/gi)];
  if (schemes.length) {
    if (schemes.length !== 1) return { kind: "unsupported" };
    const match = schemes[0];
    const scheme = match[1].toLowerCase();
    const token = value.slice(match.index ?? 0).split(/[\s<>"']/)[0];
    if ((scheme !== "http" && scheme !== "https") || !/^https?:\/\//i.test(token)) return { kind: "unsupported" };
    return websiteTarget(token, token);
  }

  const domains = [...value.matchAll(/(?:^|[^a-z\d.-])((?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+(?:xn--[a-z\d-]{2,}|[a-z]{2,})(?::\d+)?(?:[/?#][^\s<>"']*)?)/gi)];
  if (domains.length) {
    if (domains.length !== 1) return { kind: "unsupported" };
    const match = domains[0];
    const token = match[1];
    const tokenStart = (match.index ?? 0) + match[0].indexOf(token);
    if (value.slice(0, tokenStart).endsWith("@")) return { kind: "unsupported" };
    return websiteTarget(`https://${token}`, `https://${token}`);
  }

  // Keep malformed dotted hostnames out of the address search as well.
  if (/(?:^|\s)[a-z\d-]+(?:\.[a-z\d-]*){2,}(?:[/?#][^\s]*)?/i.test(value)) return { kind: "unsupported" };
  return null;
}

export function classifyMeetingLocation(value: string): MeetingLocationTarget {
  const input = value.trim();
  if (!input) return { kind: "empty" };
  const scheme = input.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme) {
    if ((scheme !== "http" && scheme !== "https") || !/^https?:\/\//i.test(input)) return { kind: "unsupported" };
    return websiteTarget(input, input);
  }
  if (isUrlLikeWithoutScheme(input)) {
    if (input.startsWith("//")) return { kind: "unsupported" };
    return websiteTarget(`https://${input}`, `https://${input}`);
  }
  const embedded = embeddedUrlTarget(input);
  if (embedded) return embedded;
  return { kind: "address", address: input };
}

export function buildMeetingMapUrls(latitude: number, longitude: number): { embedUrl: string; mapUrl: string } | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const embed = new URL("https://maps.google.com/maps");
  embed.searchParams.set("q", `${latitude},${longitude}`);
  embed.searchParams.set("z", "14");
  embed.searchParams.set("output", "embed");
  const map = new URL("https://www.google.com/maps/search/");
  map.searchParams.set("api", "1");
  map.searchParams.set("query", `${latitude},${longitude}`);
  return { embedUrl: embed.href, mapUrl: map.href };
}

export function parseLocationCoordinates(payload: unknown): { latitude: number; longitude: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const locations = (payload as { locations?: unknown }).locations;
  if (!Array.isArray(locations)) return null;
  for (const location of locations) {
    if (!location || typeof location !== "object") continue;
    const { latitude, longitude } = location as { latitude?: unknown; longitude?: unknown };
    if (typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
      return { latitude, longitude };
    }
  }
  return null;
}
