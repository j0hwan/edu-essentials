"use client";

import { useEffect, useState } from "react";
import { Globe, MapPin } from "lucide-react";
import { buildOpenStreetMapUrls, classifyMeetingLocation, parseLocationCoordinates } from "../lib/meeting-location-preview";

type Coordinates = { latitude: number; longitude: number };
type LookupResult = { key: string; coordinates: Coordinates | null };

const coordinateCache = new Map<string, Coordinates | null>();
type SharedLookup = { controller: AbortController; promise: Promise<Coordinates | null>; subscribers: number; timeout: ReturnType<typeof setTimeout> };
const inFlightLookups = new Map<string, SharedLookup>();
const MAX_CACHED_LOCATIONS = 64;
const LOOKUP_TIMEOUT_MS = 8_000;

function rememberCoordinates(key: string, coordinates: Coordinates | null) {
  if (coordinateCache.size >= MAX_CACHED_LOCATIONS && !coordinateCache.has(key)) coordinateCache.delete(coordinateCache.keys().next().value!);
  coordinateCache.set(key, coordinates);
}

function subscribeToLocationLookup(key: string, address: string): { promise: Promise<Coordinates | null>; release: () => void } {
  let lookup = inFlightLookups.get(key);
  if (!lookup) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    const shared: SharedLookup = { controller, subscribers: 0, timeout, promise: Promise.resolve(null) };
    shared.promise = fetch(`/api/locations?q=${encodeURIComponent(address)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) throw new Error("Location search unavailable.");
      return response.json();
    }).then((payload: unknown) => {
      if (controller.signal.aborted) return null;
      const coordinates = parseLocationCoordinates(payload);
      rememberCoordinates(key, coordinates);
      return coordinates;
    }).catch(() => null).finally(() => {
      clearTimeout(timeout);
      if (inFlightLookups.get(key) === shared) inFlightLookups.delete(key);
    });
    inFlightLookups.set(key, shared);
    lookup = shared;
  }

  lookup.subscribers++;
  let released = false;
  return {
    promise: lookup.promise,
    release: () => {
      if (released) return;
      released = true;
      lookup!.subscribers--;
      if (!lookup!.subscribers && inFlightLookups.get(key) === lookup) {
        inFlightLookups.delete(key);
        clearTimeout(lookup!.timeout);
        lookup!.controller.abort();
      }
    },
  };
}

function PreviewFallback({ kind, label }: { kind: "map" | "website"; label: string }) {
  const Icon = kind === "website" ? Globe : MapPin;
  return <span className="meeting-location-preview-fallback"><Icon size={18} aria-hidden="true" /><span>{label}</span></span>;
}

export default function MeetingLocationPreview({ location }: { location: string }) {
  const target = classifyMeetingLocation(location);
  const address = target.kind === "address" ? target.address : null;
  const lookupKey = address?.toLowerCase() ?? null;
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [failedScreenshot, setFailedScreenshot] = useState<string | null>(null);

  useEffect(() => {
    if (!address || address.length < 3 || address.length > 160) return;
    const key = address.toLowerCase();
    if (coordinateCache.has(key)) return;
    let active = true;
    const subscription = subscribeToLocationLookup(key, address);
    subscription.promise.then((coordinates) => {
      if (active) setLookup({ key, coordinates });
    });

    return () => {
      active = false;
      subscription.release();
    };
  }, [address]);

  if (target.kind === "empty") return null;
  if (target.kind === "website") {
    const failed = failedScreenshot === target.screenshotUrl;
    return <a className="meeting-location-preview" href={target.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open ${target.hostname}`} title={target.hostname}>
      {failed
        ? <PreviewFallback kind="website" label={target.hostname} />
        // The fixed screenshot provider is loaded in-browser so its image error can use the local fallback.
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={target.screenshotUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedScreenshot(target.screenshotUrl)} />}
    </a>;
  }

  let coordinates: Coordinates | null | undefined;
  if (lookupKey && address && address.length >= 3 && address.length <= 160) {
    if (coordinateCache.has(lookupKey)) coordinates = coordinateCache.get(lookupKey) ?? null;
    else if (lookup?.key === lookupKey) coordinates = lookup.coordinates;
  }
  const map = coordinates ? buildOpenStreetMapUrls(coordinates.latitude, coordinates.longitude) : null;
  if (map && address) {
    return <a className="meeting-location-preview" href={map.mapUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open map for ${address}`}>
      <iframe src={map.embedUrl} title={`Map preview for ${address}`} loading="lazy" tabIndex={-1} referrerPolicy="no-referrer" />
    </a>;
  }

  const waiting = !!address && address.length >= 3 && address.length <= 160 && coordinates === undefined;
  return <div className="meeting-location-preview" aria-label={waiting ? "Loading map preview" : "Map preview unavailable"}>
    <PreviewFallback kind="map" label={waiting ? "Loading map preview…" : "Map preview unavailable"} />
  </div>;
}
