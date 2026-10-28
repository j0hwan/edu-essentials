"use client";
/* eslint-disable @next/next/no-img-element -- website snapshots are supplied by an external screenshot service. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type SyntheticEvent } from "react";
import { Globe, MapPin } from "lucide-react";
import { buildMeetingMapUrls, classifyMeetingLocation, parseLocationCoordinates } from "../lib/meeting-location-preview";
import { CoursePreviewPlaceholder, useCoursePreviewReveal, useMapPreviewPlaceholder } from "./course-preview-reveal";

type Coordinates = { latitude: number; longitude: number };
type LookupResult = { key: string; coordinates: Coordinates | null };

const coordinateCache = new Map<string, Coordinates | null>();
type SharedLookup = { controller: AbortController; promise: Promise<Coordinates | null>; subscribers: number; timeout: ReturnType<typeof setTimeout> };
const inFlightLookups = new Map<string, SharedLookup>();
const MAX_CACHED_LOCATIONS = 64;
const LOOKUP_TIMEOUT_MS = 8_000;
const PREVIEW_SETTLE_TIMEOUT_MS = 12_000;

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

export default function MeetingLocationPreview({ location, ref, previewKey }: { location: string; ref?: Ref<HTMLElement>; previewKey?: string }) {
  const attachRef = (element: HTMLElement | null) => {
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  };
  const target = classifyMeetingLocation(location);
  const screenshotUrl = target.kind === "website" ? target.screenshotUrl : null;
  const address = target.kind === "address" ? target.address : null;
  const lookupKey = address?.toLowerCase() ?? null;
  const { revealed, settle, coordinated } = useCoursePreviewReveal(previewKey);
  const mapPlaceholderSrc = useMapPreviewPlaceholder(coordinated);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [failedScreenshot, setFailedScreenshot] = useState<string | null>(null);
  const [loadedScreenshot, setLoadedScreenshot] = useState<string | null>(null);
  const [failedMapFrame, setFailedMapFrame] = useState<string | null>(null);
  const [loadedMapFrame, setLoadedMapFrame] = useState<string | null>(null);
  const validAddress = !!address && address.length >= 3 && address.length <= 160;
  const previewIdentity = JSON.stringify([previewKey ?? null, location]);
  const frameIdentity = target.kind === "address" && lookupKey && address && validAddress
    ? JSON.stringify([previewIdentity, lookupKey, lookup?.key === lookupKey ? lookup.coordinates : coordinateCache.get(lookupKey) ?? null])
    : null;
  const activePreviewRef = useRef({ previewIdentity, frameIdentity });

  useLayoutEffect(() => {
    activePreviewRef.current = { previewIdentity, frameIdentity };
  }, [previewIdentity, frameIdentity]);

  const settlePreview = useCallback(() => {
    if (activePreviewRef.current.previewIdentity === previewIdentity) settle();
  }, [previewIdentity, settle]);

  const isCurrentMapFrame = useCallback((expectedFrameIdentity: string) => (
    activePreviewRef.current.previewIdentity === previewIdentity && activePreviewRef.current.frameIdentity === expectedFrameIdentity
  ), [previewIdentity]);

  const settleMapFrame = useCallback((expectedFrameIdentity: string) => {
    if (isCurrentMapFrame(expectedFrameIdentity)) settle();
  }, [isCurrentMapFrame, settle]);

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

  useEffect(() => {
    if (!coordinated || !screenshotUrl || failedScreenshot === screenshotUrl || loadedScreenshot === previewIdentity) return;
    const timeout = setTimeout(() => {
      if (activePreviewRef.current.previewIdentity !== previewIdentity) return;
      setFailedScreenshot(screenshotUrl);
      settlePreview();
    }, PREVIEW_SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [coordinated, failedScreenshot, loadedScreenshot, previewIdentity, screenshotUrl, settlePreview]);

  const coordinates = (() => {
    if (!lookupKey || !address || !validAddress) return undefined;
    if (coordinateCache.has(lookupKey)) return coordinateCache.get(lookupKey) ?? null;
    if (lookup?.key === lookupKey) return lookup.coordinates;
    return undefined;
  })();
  const map = coordinates ? buildMeetingMapUrls(coordinates.latitude, coordinates.longitude) : null;
  const mapEmbedUrl = map?.embedUrl ?? null;
  const waiting = validAddress && coordinates === undefined;
  const mapUnavailable = target.kind === "address" && !map && !waiting;
  const unavailableContent = target.kind === "empty" || target.kind === "unsupported" || mapUnavailable || (!!screenshotUrl && failedScreenshot === screenshotUrl);

  useEffect(() => {
    if (coordinated && unavailableContent) settlePreview();
  }, [coordinated, settlePreview, unavailableContent]);

  useEffect(() => {
    if (!coordinated || !mapEmbedUrl || !frameIdentity || failedMapFrame === frameIdentity || loadedMapFrame === frameIdentity) return;
    const timeout = setTimeout(() => {
      if (activePreviewRef.current.previewIdentity !== previewIdentity || activePreviewRef.current.frameIdentity !== frameIdentity) return;
      setFailedMapFrame(frameIdentity);
      settleMapFrame(frameIdentity);
    }, PREVIEW_SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [coordinated, failedMapFrame, frameIdentity, loadedMapFrame, mapEmbedUrl, previewIdentity, settleMapFrame]);

  const withCoordinatedSurface = (content: ReactNode) => coordinated
    ? <><div className={`course-preview-content private-class-image-fade${revealed ? " is-ready" : ""}`} aria-hidden={!revealed}>{content}</div><CoursePreviewPlaceholder kind="map" src={mapPlaceholderSrc} /></>
    : content;

  const handleScreenshotLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    if (!coordinated || activePreviewRef.current.previewIdentity !== previewIdentity) return;
    const image = event.currentTarget;
    const finish = () => {
      if (activePreviewRef.current.previewIdentity !== previewIdentity) return;
      setLoadedScreenshot(previewIdentity);
      settlePreview();
    };
    const fail = () => {
      if (activePreviewRef.current.previewIdentity !== previewIdentity) return;
      setFailedScreenshot(target.kind === "website" ? target.screenshotUrl : null);
      settlePreview();
    };
    if (typeof image.decode !== "function") finish();
    else void image.decode().then(finish, fail);
  };

  const handleScreenshotError = () => {
    if (coordinated && activePreviewRef.current.previewIdentity !== previewIdentity) return;
    if (target.kind === "website") setFailedScreenshot(target.screenshotUrl);
    settlePreview();
  };

  if (target.kind === "empty") return null;
  if (target.kind === "website") {
    const failed = failedScreenshot === target.screenshotUrl;
    const className = `meeting-location-preview${coordinated ? ` course-preview-surface${revealed ? " is-revealed" : ""}` : ""}`;
    return <a ref={attachRef} className={className} href={target.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open ${target.hostname}`} title={target.hostname}>
      {withCoordinatedSurface(failed
        ? <PreviewFallback kind="website" label={target.hostname} />
        // The fixed screenshot provider is loaded in-browser so its image error can use the local fallback.
        : <img key={coordinated ? previewIdentity : undefined} src={target.screenshotUrl} alt="" loading={coordinated ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onLoad={coordinated ? handleScreenshotLoad : undefined} onError={handleScreenshotError} />)}
    </a>;
  }

  if (map && address) {
    const failed = coordinated && failedMapFrame === frameIdentity;
    const className = `meeting-location-preview${coordinated ? ` course-preview-surface${revealed ? " is-revealed" : ""}` : ""}`;
    return <a ref={attachRef} className={className} href={map.mapUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open Google Maps for ${address}`}>
      {withCoordinatedSurface(failed
        ? <PreviewFallback kind="map" label="Map preview unavailable" />
        : <iframe key={coordinated ? frameIdentity ?? undefined : undefined} src={map.embedUrl} title={`Map preview for ${address}`} loading={coordinated ? "eager" : "lazy"} tabIndex={-1} referrerPolicy="no-referrer" onLoad={coordinated ? () => { if (frameIdentity && isCurrentMapFrame(frameIdentity)) { setLoadedMapFrame(frameIdentity); settleMapFrame(frameIdentity); } } : undefined} onError={coordinated ? () => { if (frameIdentity && isCurrentMapFrame(frameIdentity)) { setFailedMapFrame(frameIdentity); settleMapFrame(frameIdentity); } } : undefined} />)}
    </a>;
  }

  const className = `meeting-location-preview${coordinated ? ` course-preview-surface${revealed ? " is-revealed" : ""}` : ""}`;
  return <div ref={attachRef} className={className} aria-label={waiting ? "Loading map preview" : "Map preview unavailable"}>
    {withCoordinatedSurface(<PreviewFallback kind="map" label={waiting ? "Loading map preview…" : "Map preview unavailable"} />)}
  </div>;
}
/* eslint-enable @next/next/no-img-element */
