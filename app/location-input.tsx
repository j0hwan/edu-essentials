"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LocationSuggestion } from "../lib/locations";
import "./location-input.css";

export default function LocationInput({ value, onChange, label = "Location", placeholder = "Search an address or enter a room" }: { value: string; onChange: (value: string) => void; label?: string; placeholder?: string }) {
  const id = useId();
  const [results, setResults] = useState<LocationSuggestion[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const focused = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    if (query === null || query.trim().length < 3) return;
    const controller = new AbortController();
    const version = generation.current;
    const timeout = setTimeout(async () => {
      if (controller.signal.aborted || version !== generation.current) return;
      setLoading(true);
      try {
        const response = await fetch(`/api/locations?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search unavailable");
        const data = await response.json() as { locations?: unknown };
        if (controller.signal.aborted || version !== generation.current) return;
        if (!Array.isArray(data.locations)) throw new Error("Invalid search response");
        const locations = data.locations.filter((item): item is LocationSuggestion => !!item && typeof item === "object" && typeof item.id === "string" && typeof item.address === "string" && item.address.length <= 160).slice(0, 8);
        setLoading(false);
        setResults(locations);
        setOpen(focused.current && locations.length > 0);
        setMessage(locations.length ? "" : "No addresses found. You can enter a location manually.");
      } catch {
        if (!controller.signal.aborted && version === generation.current) {
          setLoading(false);
          setMessage("Address search is unavailable. You can enter a location manually.");
        }
      }
    }, 400);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [query]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, id, open]);
  const select = (suggestion: LocationSuggestion) => {
    generation.current++;
    onChange(suggestion.address);
    setQuery(null); setResults([]); setOpen(false); setActive(-1); setMessage(""); setLoading(false);
  };
  return <div className="location-field">
    <label htmlFor={id} data-loading={loading ? "true" : "false"}>{label}<span className="location-spinner-slot" aria-hidden="true"><span className="location-loading-spinner" /></span></label>
    <div className="location-input-control">
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-results`} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined} aria-busy={loading || undefined} autoComplete="off" maxLength={160} placeholder={placeholder} value={value} onChange={(event) => {
      generation.current++; setLoading(false); onChange(event.target.value); setQuery(event.target.value); setResults([]); setOpen(false); setActive(-1); setMessage("");
    }} onFocus={() => { focused.current = true; if (results.length) setOpen(true); }} onBlur={() => { focused.current = false; setOpen(false); setActive(-1); }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
        event.preventDefault(); setOpen(true); setActive((index) => event.key === "ArrowDown" ? (index + 1) % results.length : (index <= 0 ? results.length : index) - 1);
      }
      if (event.key === "Enter" && open) { event.preventDefault(); if (active >= 0) select(results[active]); }
    }} />
    <div id={`${id}-results`} role="listbox" aria-label="Address suggestions" hidden={!open}>{results.map((suggestion, index) => <button type="button" tabIndex={-1} id={`${id}-option-${index}`} key={suggestion.id} role="option" aria-selected={active === index} onMouseDown={(event) => event.preventDefault()} onClick={() => select(suggestion)}>{suggestion.address}</button>)}</div>
    </div>
    <small role="status">{message}</small>
    <span className="location-sr-only" role="status" aria-live="polite" aria-atomic="true">{loading ? "Searching addresses…" : ""}</span>
  </div>;
}
