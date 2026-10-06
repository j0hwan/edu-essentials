"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Clock3, Columns3, Maximize2, Minimize2, Monitor, RotateCcw, RotateCw, Smartphone, Tablet, X } from "lucide-react";
import {
  appearancePresets,
  defaultWidgetAppearance,
  resolveWidgetAppearance,
  validateWidgetAppearanceState,
  widgetAppearanceStyle,
  type WidgetAppearance,
  type WidgetAppearanceState,
} from "../lib/widget-appearance";
import type { WidgetSize } from "../lib/widget-layout";
import AnimatedWidgetGrid from "./animated-widget-grid";
import "./widget-customization.css";

type WidgetOption = { instanceId: string; title: string; size: WidgetSize };
type Props = {
  value: WidgetAppearanceState | undefined;
  widgets: WidgetOption[];
  onApply: (state: WidgetAppearanceState) => boolean | void;
  onClose: () => void;
};

type AppearanceKey = keyof WidgetAppearance;
type Choice = { value: string | number; label: string };
type Control =
  | { key: AppearanceKey; label: string; kind: "range"; min: number; max: number; step?: number; unit?: string; format?: (value: number) => string }
  | { key: AppearanceKey; label: string; kind: "color" }
  | { key: AppearanceKey; label: string; kind: "select"; choices: Choice[] }
  | { key: AppearanceKey; label: string; kind: "toggle"; hint?: string };

const BASIC_CONTROLS: Control[] = [
  { key: "surface", label: "Card surface", kind: "color" },
  { key: "surfaceOpacity", label: "Surface opacity", kind: "range", min: 40, max: 100, unit: "%" },
  { key: "accent", label: "Accent color", kind: "color" },
  { key: "radius", label: "Corner radius", kind: "range", min: 0, max: 28, unit: "px" },
  { key: "padding", label: "Card padding", kind: "range", min: 10, max: 28, unit: "px" },
  { key: "fontSize", label: "Body text size", kind: "range", min: 12, max: 18, unit: "px" },
  { key: "titleSize", label: "Title size", kind: "range", min: 12, max: 20, unit: "px" },
  { key: "showIcons", label: "Show widget icons", kind: "toggle", hint: "Keep a visual cue beside each widget title." },
];

const ADVANCED_GROUPS: { title: string; description: string; controls: Control[]; boardOnly?: boolean }[] = [
  {
    title: "Board layout",
    description: "Fit four small square widgets across on desktop and tablet, or two on phones. Larger sizes derive from the square base cell; adjust their spacing below.",
    boardOnly: true,
    controls: [
      { key: "gap", label: "Space between cards", kind: "range", min: 8, max: 32, unit: "px" },
    ],
  },
  {
    title: "Edges and depth",
    description: "Tune borders and the card shadow.",
    controls: [
      { key: "borderColor", label: "Border color", kind: "color" },
      { key: "borderWidth", label: "Border width", kind: "range", min: 0, max: 3, unit: "px" },
      { key: "borderStyle", label: "Border style", kind: "select", choices: [
        { value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "none", label: "None" },
      ] },
      { key: "shadow", label: "Shadow", kind: "select", choices: [
        { value: "none", label: "None" }, { value: "soft", label: "Soft" }, { value: "lifted", label: "Lifted" }, { value: "crisp", label: "Crisp" },
      ] },
    ],
  },
  {
    title: "Surface details",
    description: "Add subtle texture, color wash, and background depth.",
    controls: [
      { key: "blur", label: "Background blur", kind: "range", min: 0, max: 20, unit: "px" },
      { key: "texture", label: "Texture", kind: "select", choices: [
        { value: "none", label: "None" }, { value: "dots", label: "Soft dots" }, { value: "grid", label: "Fine grid" },
      ] },
      { key: "gradient", label: "Color wash", kind: "select", choices: [
        { value: "none", label: "None" }, { value: "subtle", label: "Subtle" }, { value: "duotone", label: "Duotone" },
      ] },
      { key: "gradientAngle", label: "Color wash angle", kind: "range", min: 0, max: 360, step: 5, unit: "°" },
    ],
  },
  {
    title: "Typography",
    description: "Adjust contrast, weight, spacing, and alignment.",
    controls: [
      { key: "textColor", label: "Main text", kind: "color" },
      { key: "mutedColor", label: "Secondary text", kind: "color" },
      { key: "titleWeight", label: "Title weight", kind: "select", choices: [
        { value: 500, label: "Medium" }, { value: 600, label: "Semibold" }, { value: 700, label: "Bold" },
      ] },
      { key: "lineHeight", label: "Line spacing", kind: "range", min: 1.3, max: 1.8, step: 0.1, format: (n) => n.toFixed(1) },
      { key: "letterSpacing", label: "Letter spacing", kind: "range", min: -0.02, max: 0.04, step: 0.01, format: (n) => `${n.toFixed(2)} em` },
      { key: "titleAlign", label: "Title alignment", kind: "select", choices: [
        { value: "left", label: "Left" }, { value: "center", label: "Centered" },
      ] },
    ],
  },
  {
    title: "Widget headers",
    description: "Shape the title area and its icon.",
    controls: [
      { key: "headerDivider", label: "Header divider", kind: "toggle", hint: "Separate the title from widget content." },
      { key: "accentEdge", label: "Accent edge", kind: "select", choices: [
        { value: "none", label: "None" }, { value: "top", label: "Top edge" }, { value: "left", label: "Left edge" },
      ] },
      { key: "iconStyle", label: "Icon treatment", kind: "select", choices: [
        { value: "filled", label: "Filled" }, { value: "outline", label: "Outline" }, { value: "minimal", label: "Minimal" },
      ] },
      { key: "iconSize", label: "Icon size", kind: "range", min: 24, max: 40, unit: "px" },
    ],
  },
  {
    title: "Motion and interaction",
    description: "Set hover feedback, transition timing, and content behavior.",
    controls: [
      { key: "hover", label: "Hover effect", kind: "select", choices: [
        { value: "none", label: "None" }, { value: "lift", label: "Lift" }, { value: "glow", label: "Glow" },
      ] },
      { key: "transitionMs", label: "Transition duration", kind: "range", min: 0, max: 350, step: 10, unit: "ms" },
    ],
  },
];

const DEVICE_WIDTHS = { desktop: 860, tablet: 580, phone: 390 } as const;
type Device = keyof typeof DEVICE_WIDTHS;
type DemoCard = { id?: string; title: string; kind: "schedule" | "focus" | "progress"; size: WidgetSize };

const PREVIEW_SIZE_GALLERY: readonly WidgetSize[] = ["mini", "mini", "small", "medium", "medium-vertical", "large"];
const PREVIEW_TITLES = ["Next up", "Focus session", "Weekly progress"] as const;

function initialState(value: WidgetAppearanceState | undefined) {
  try {
    return validateWidgetAppearanceState(value ?? { defaults: defaultWidgetAppearance, overrides: {} });
  } catch {
    return validateWidgetAppearanceState({ defaults: defaultWidgetAppearance, overrides: {} });
  }
}

function formatValue(control: Extract<Control, { kind: "range" }>, raw: number) {
  if (control.format) return control.format(raw);
  return `${raw}${control.unit ? ` ${control.unit}` : ""}`;
}

function WidgetIcon({ kind }: { kind: DemoCard["kind"] }) {
  if (kind === "schedule") return <span aria-hidden="true">◷</span>;
  if (kind === "focus") return <span aria-hidden="true">◉</span>;
  return <span aria-hidden="true">↗</span>;
}

function PreviewCard({ card, appearance }: { card: DemoCard; appearance: WidgetAppearance }) {
  const style = widgetAppearanceStyle(appearance);
  delete style["--wa-min-width"];
  delete style["--wa-min-height"];
  delete style["--wa-gap"];
  return (
    <article
      className="wa-preview-card"
      style={style as CSSProperties}
      data-size={card.size}
      data-wa-texture={appearance.texture}
      data-wa-gradient={appearance.gradient}
      data-wa-icon-style={appearance.iconStyle}
      data-wa-show-icons={String(appearance.showIcons)}
      data-wa-header-divider={String(appearance.headerDivider)}
      data-wa-accent-edge={appearance.accentEdge}
      data-wa-hover={appearance.hover}
      data-wa-title-align={appearance.titleAlign}
    >
      <div className="wa-preview-frame">
      <div className="wa-preview-card__header">
        <span className="wa-preview-card__icon"><WidgetIcon kind={card.kind} /></span>
        <h4>{card.title}</h4>
        <span className="wa-preview-card__menu" aria-hidden="true">•••</span>
      </div>
      {card.kind === "schedule" && <div className="wa-preview-card__body"><strong>Biology · Lecture</strong><p>Today, 10:30 AM <span>·</span> Room 204</p><span className="wa-preview-card__tag">Up next</span><div className="wa-preview-card__more"><span>Lab prep <time>1:15 PM</time></span><span>Read chapter 8 <time>3:00 PM</time></span><span>Study group <time>4:30 PM</time></span></div></div>}
      {card.kind === "focus" && <div className="wa-preview-card__body wa-preview-card__focus"><strong>50:00</strong><p>Deep work block</p><div className="wa-preview-card__progress" role="img" aria-label="Focus session is 62 percent complete"><span /></div><small>Break in 17 minutes</small><div className="wa-preview-card__more"><span>Review lecture notes</span><span>Finish problem set</span><span>Plan tomorrow</span></div></div>}
      {card.kind === "progress" && <div className="wa-preview-card__body"><div className="wa-preview-card__metric"><strong>12.5 hrs</strong><span>This week</span></div><div className="wa-preview-card__bars" role="img" aria-label="Study time across five days"><i /><i /><i /><i /><i /></div><p>Study goal · 16 hours</p><div className="wa-preview-card__more"><span>3 assignments finished</span><span>4-day study streak</span><span>Goal is on track</span></div></div>}
      </div>
    </article>
  );
}

function DeviceStage({ device, label, children }: { device: Device; label: string; children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [measurement, setMeasurement] = useState({ width: 0, height: 0 });
  const deviceWidth = DEVICE_WIDTHS[device];

  useEffect(() => {
    const host = hostRef.current;
    const frame = frameRef.current;
    if (!host || !frame) return;
    const measure = () => setMeasurement({ width: host.clientWidth, height: frame.scrollHeight });
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [device]);

  const availableWidth = measurement.width || 440;
  const rawHeight = measurement.height || 900;
  const scale = Math.min(1, availableWidth / deviceWidth);
  const scaledWidth = deviceWidth * scale;
  const scaledHeight = rawHeight * scale;
  return (
    <section className="wa-device-stage" aria-label={`${label} ${device} preview`}>
      <div className="wa-device-viewport" ref={hostRef} style={{ height: `${scaledHeight}px` }}>
        <div className="wa-device-scale-box" style={{ width: `${scaledWidth}px`, height: `${scaledHeight}px` }}>
          <div className={`wa-device-frame wa-device-frame--${device}`} ref={frameRef} style={{ width: `${deviceWidth}px`, transform: `scale(${scale})` }}>
            <div className="wa-device-frame__bar" aria-hidden="true"><span /><span /><span /></div>
            <div className="wa-device-frame__content">
              <div className="wa-device-frame__heading"><span>{label}</span><small>{device === "phone" ? "390 px" : `${device === "tablet" ? "Tablet" : "Desktop"} · ${deviceWidth} px`}</small></div>
              {children}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function WidgetCustomization({ value, widgets, onApply, onClose }: Props) {
  const [initial] = useState(() => initialState(value));
  const [saved, setSaved] = useState<WidgetAppearanceState>(initial);
  const [draft, setDraft] = useState<WidgetAppearanceState>(initial);
  const [undoStack, setUndoStack] = useState<WidgetAppearanceState[]>([]);
  const [redoStack, setRedoStack] = useState<WidgetAppearanceState[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [mode, setMode] = useState<"basic" | "advanced">("basic");
  const [device, setDevice] = useState<Device>("desktop");
  const [compare, setCompare] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      activeElement?.focus({ preventScroll: true });
    };
  }, []);

  const selectedWidget = widgets.find((widget) => widget.instanceId === targetId);
  const editableAppearance = targetId
    ? resolveWidgetAppearance(draft, targetId)
    : draft.defaults;

  const changeState = (next: WidgetAppearanceState) => {
    if (JSON.stringify(next) === JSON.stringify(draft)) return;
    setUndoStack((history) => [...history, draft].slice(-30));
    setRedoStack([]);
    setDraft(next);
    setMessage("");
  };

  const changeAppearance = (patch: Partial<WidgetAppearance>) => {
    if (!targetId) {
      changeState({ ...draft, defaults: { ...draft.defaults, ...patch } });
      return;
    }
    changeState({
      ...draft,
      overrides: { ...draft.overrides, [targetId]: { ...draft.overrides[targetId], ...patch } },
    });
  };

  const applyPreset = (appearance: WidgetAppearance) => {
    if (!targetId) changeState({ ...draft, defaults: { ...appearance } });
    else changeState({ ...draft, overrides: { ...draft.overrides, [targetId]: { ...appearance } } });
  };

  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((history) => history.slice(0, -1));
    setRedoStack((history) => [...history, draft].slice(-30));
    setDraft(previous);
    setMessage("");
  };

  const redo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((history) => history.slice(0, -1));
    setUndoStack((history) => [...history, draft].slice(-30));
    setDraft(next);
    setMessage("");
  };

  const resetScope = () => {
    if (!targetId) changeState({ defaults: { ...defaultWidgetAppearance }, overrides: {} });
    else {
      const overrides = { ...draft.overrides };
      delete overrides[targetId];
      changeState({ ...draft, overrides });
    }
  };

  const handleApply = () => {
    try {
      const normalized = validateWidgetAppearanceState(draft);
      const result = onApply(normalized);
      if (result === false) {
        setMessage("Unable to apply. Review the workspace save status, then try again.");
        return;
      }
      setSaved(normalized);
      setDraft(normalized);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review the appearance settings and try again.");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) { event.preventDefault(); dialogRef.current.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.key === "Home" ? "basic" : event.key === "End" ? "advanced" : mode === "basic" ? "advanced" : "basic";
    setMode(nextMode);
    document.getElementById(`wa-tab-${nextMode}`)?.focus();
  };

  let demoCards: DemoCard[];
  if (!targetId) {
    const unusedWidgets = [...widgets];
    demoCards = PREVIEW_SIZE_GALLERY.map((size, index) => {
      const widgetIndex = unusedWidgets.findIndex((widget) => widget.size === size);
      const widget = widgetIndex === -1 ? undefined : unusedWidgets.splice(widgetIndex, 1)[0];
      return {
        id: widget?.instanceId,
        title: widget?.title ?? PREVIEW_TITLES[index % PREVIEW_TITLES.length],
        kind: (["schedule", "focus", "progress"] as const)[index % 3],
        size,
      };
    });
  } else {
    demoCards = widgets.slice(0, 3).map((widget, index) => ({
      id: widget.instanceId,
      title: widget.title,
      kind: (["schedule", "focus", "progress"] as const)[index % 3],
      size: widget.size,
    }));
    if (!demoCards.some((card) => card.id === targetId) && selectedWidget) {
      const targetCard: DemoCard = { id: selectedWidget.instanceId, title: selectedWidget.title, kind: "schedule", size: selectedWidget.size };
      demoCards = demoCards.length >= 3 ? [...demoCards.slice(0, 2), targetCard] : [...demoCards, targetCard];
    }
    if (demoCards.length === 0) {
      demoCards = PREVIEW_SIZE_GALLERY.slice(0, 3).map((size, index) => ({
        title: PREVIEW_TITLES[index],
        kind: (["schedule", "focus", "progress"] as const)[index],
        size,
      }));
    }
  }

  const appearanceFor = (state: WidgetAppearanceState, card: DemoCard) => resolveWidgetAppearance(state, card.id);
  const renderPreviewCards = (state: WidgetAppearanceState, prefix: string) => (
    <AnimatedWidgetGrid
      className="wa-preview-cards"
      animateLayout={false}
      layoutKey={`${prefix}:${JSON.stringify(state)}`}
      label={`${prefix === "saved" ? "Saved" : "Draft"} widget appearance preview`}
      style={widgetAppearanceStyle(state.defaults) as CSSProperties}
    >
      {demoCards.map((card, index) => (
        <PreviewCard key={`${prefix}-${card.id ?? card.title}-${index}`} card={card} appearance={appearanceFor(state, card)} />
      ))}
    </AnimatedWidgetGrid>
  );

  const renderControl = (control: Control, index: number, disabled = false) => {
    const id = `wa-${control.key}-${index}`;
    const currentValue = editableAppearance[control.key];
    const update = (next: string | number | boolean) => changeAppearance({ [control.key]: next } as Partial<WidgetAppearance>);
    return (
      <div className={`wa-control wa-control--${control.kind}`} key={control.key}>
        <label className="wa-control__label" htmlFor={id}>{control.label}</label>
        {control.kind === "range" && <>
          <input id={id} type="range" min={control.min} max={control.max} step={control.step ?? 1} value={Number(currentValue)} disabled={disabled}
            aria-valuetext={formatValue(control, Number(currentValue))} onChange={(event) => update(Number(event.currentTarget.value))} />
          <output htmlFor={id}>{formatValue(control, Number(currentValue))}</output>
        </>}
        {control.kind === "color" && <div className="wa-color-control">
          <input id={id} type="color" value={String(currentValue)} disabled={disabled} onChange={(event) => update(event.currentTarget.value)} />
          <span aria-hidden="true">{String(currentValue).toUpperCase()}</span>
        </div>}
        {control.kind === "select" && <select id={id} value={String(currentValue)} disabled={disabled} onChange={(event) => {
          const choice = control.choices.find((item) => String(item.value) === event.currentTarget.value);
          if (choice) update(choice.value);
        }}>{control.choices.map((choice) => <option value={String(choice.value)} key={choice.value}>{choice.label}</option>)}</select>}
        {control.kind === "toggle" && <label className="wa-switch" htmlFor={id}>
          <input id={id} type="checkbox" checked={Boolean(currentValue)} disabled={disabled} onChange={(event) => update(event.currentTarget.checked)} />
          <span className="wa-switch__track" aria-hidden="true"><span /></span>
          {control.hint && <small>{control.hint}</small>}
        </label>}
      </div>
    );
  };

  return (
    <div className="wa-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {/* The dialog itself receives Escape/Tab so keyboard focus stays inside the modal. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div className={`wa-dialog${previewExpanded ? " is-preview-expanded" : ""}`} role="dialog" aria-modal="true" aria-labelledby="wa-title" aria-describedby="wa-description" ref={dialogRef} tabIndex={-1} onKeyDown={handleKeyDown}>
        <header className="wa-header">
          <div className="wa-header__icon" aria-hidden="true"><Columns3 size={20} /></div>
          <div className="wa-header__copy">
            <span className="wa-eyebrow">WORKSPACE DESIGN</span>
            <h2 id="wa-title">Widget appearance</h2>
            <p id="wa-description">Make your board feel like yours. Changes stay in this draft until you apply them.</p>
          </div>
          <div className="wa-history" aria-label="Draft history">
            <button type="button" aria-label="Undo appearance change" title="Undo" disabled={!undoStack.length} onClick={undo}><RotateCcw size={17} /></button>
            <button type="button" aria-label="Redo appearance change" title="Redo" disabled={!redoStack.length} onClick={redo}><RotateCw size={17} /></button>
          </div>
          <button type="button" className="wa-close" aria-label="Close appearance studio" onClick={onClose}><X size={19} /></button>
        </header>

        <div className="wa-studio-body">
          <section className="wa-preview-panel" aria-label="Live appearance preview">
            <div className="wa-panel-heading">
              <div><span className="wa-eyebrow">LIVE PREVIEW</span><h3>See it in context</h3></div>
              <span className="wa-live-indicator"><i /> Live</span>
            </div>
            <div className="wa-preview-tools">
              <div className="wa-device-switch" role="group" aria-label="Preview device width">
                <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} aria-label="Desktop preview"><Monitor size={16} /><span>Desktop</span></button>
                <button type="button" aria-pressed={device === "tablet"} onClick={() => setDevice("tablet")} aria-label="Tablet preview"><Tablet size={16} /><span>Tablet</span></button>
                <button type="button" aria-pressed={device === "phone"} onClick={() => setDevice("phone")} aria-label="Phone preview"><Smartphone size={16} /><span>Phone</span></button>
              </div>
              <div className="wa-preview-actions">
              <button type="button" className={`wa-compare-button${compare ? " is-active" : ""}`} aria-pressed={compare} onClick={() => setCompare((current) => !current)}>
                {compare ? <Check size={15} /> : <Columns3 size={15} />}{compare ? "Comparing" : "Compare"}
              </button>
              <button type="button" className="wa-expand-button" aria-label={previewExpanded ? "Show appearance controls" : "Enlarge preview"} title={previewExpanded ? "Show controls" : "Enlarge preview"} aria-pressed={previewExpanded} aria-controls="wa-settings" onClick={() => setPreviewExpanded((current) => !current)}>
                {previewExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              </div>
            </div>
            {compare ? <div className="wa-compare-view">
              <DeviceStage device={device} label="Saved look">{renderPreviewCards(saved, "saved")}</DeviceStage>
              <DeviceStage device={device} label="Draft look">{renderPreviewCards(draft, "draft")}</DeviceStage>
            </div> : <DeviceStage device={device} label="Draft look">{renderPreviewCards(draft, "draft")}</DeviceStage>}
            <p className="wa-preview-note"><Clock3 size={14} /> Sample content stays inside each fixed-size block.</p>
          </section>

          <section className="wa-controls-panel" id="wa-settings" aria-label="Appearance controls" hidden={previewExpanded}>
            <div className="wa-controls-toolbar">
              <div className="wa-scope-control">
                <label htmlFor="wa-scope">Apply changes to</label>
                <select id="wa-scope" value={targetId ?? ""} onChange={(event) => { setTargetId(event.currentTarget.value || null); setMessage(""); }}>
                  <option value="">All widgets</option>
                  {widgets.map((widget) => <option value={widget.instanceId} key={widget.instanceId}>{widget.title}</option>)}
                </select>
              </div>
              {targetId && <p className="wa-scope-note">This widget will keep its own appearance settings.</p>}
            </div>

            <div className="wa-mode-tabs" role="tablist" aria-label="Appearance control detail" tabIndex={-1} onKeyDown={handleTabKeyDown}>
              <button type="button" role="tab" id="wa-tab-basic" aria-selected={mode === "basic"} tabIndex={mode === "basic" ? 0 : -1} aria-controls="wa-panel-basic" onClick={() => setMode("basic")} data-initial-focus>Basic</button>
              <button type="button" role="tab" id="wa-tab-advanced" aria-selected={mode === "advanced"} tabIndex={mode === "advanced" ? 0 : -1} aria-controls="wa-panel-advanced" onClick={() => setMode("advanced")}>Advanced</button>
              <span>29 appearance controls</span>
            </div>

            {mode === "basic" ? <div id="wa-panel-basic" role="tabpanel" aria-labelledby="wa-tab-basic" className="wa-controls-content">
              <div className="wa-section-heading"><div><h3>Start with a look</h3><p>Choose a direction, then fine-tune the details below.</p></div></div>
              <div className="wa-preset-grid" aria-label="Appearance presets">
                {appearancePresets.slice(0, 6).map((preset) => (
                  <button type="button" className="wa-preset" key={preset.id} onClick={() => applyPreset(preset.appearance)} aria-label={`Apply ${preset.name} preset`}>
                    <span className="wa-preset__art" style={widgetAppearanceStyle(preset.appearance) as CSSProperties} aria-hidden="true">
                      <i /><i /><i />
                    </span>
                    <span className="wa-preset__copy"><strong>{preset.name}</strong><small>{preset.description}</small></span>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div className="wa-section-heading wa-section-heading--compact"><div><h3>Quick adjustments</h3><p>Preview updates as you make each change.</p></div></div>
              <div className="wa-control-grid">{BASIC_CONTROLS.map((control, index) => renderControl(control, index))}</div>
            </div> : <div id="wa-panel-advanced" role="tabpanel" aria-labelledby="wa-tab-advanced" className="wa-controls-content wa-advanced-content">
              <div className="wa-section-heading"><div><h3>Advanced controls</h3><p>Fine-tune spacing, detail, typography, and motion.</p></div></div>
              {ADVANCED_GROUPS.map((group, groupIndex) => {
                const disabled = Boolean(group.boardOnly && targetId);
                return <details className={`wa-control-group${disabled ? " is-disabled" : ""}`} key={group.title} open={groupIndex === 0 || undefined}>
                  <summary><span><strong>{group.title}</strong><small>{disabled ? "Select All widgets to change the layout" : group.description}</small></span><ChevronDown size={17} aria-hidden="true" /></summary>
                  <div className="wa-control-grid">{group.controls.map((control, index) => renderControl(control, groupIndex * 10 + index, disabled))}</div>
                </details>;
              })}
            </div>}
          </section>
        </div>

        <footer className="wa-footer">
          <button type="button" className="wa-reset" onClick={resetScope}><RotateCcw size={15} /> Reset {targetId ? "this widget" : "all widgets"}</button>
          <div className="wa-footer__right">
            <span className="wa-status" role="status" aria-live="polite">{message}</span>
            <button type="button" className="wa-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="wa-apply" onClick={handleApply}><Check size={16} /> Apply appearance</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
