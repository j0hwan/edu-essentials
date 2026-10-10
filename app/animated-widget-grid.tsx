"use client";

import { Component, createRef, type ReactNode, type CSSProperties } from "react";
import { calculateWidgetPlacements } from "../lib/widget-layout";

export { calculateWidgetPlacements };
export type { WidgetPlacement } from "../lib/widget-layout";

type Props = { layoutKey: string; reflowKey?: string; label: string; children: ReactNode; style?: CSSProperties; className?: string; animateLayout?: boolean; resizeMotion?: boolean };
type Snapshot = Map<string, DOMRect> | null;

export type WidgetUnitInput = {
  gridWidth: number;
  gap: number;
  columns: 2 | 4;
};

/** The base cell is square and uses the exact available width after column gaps. */
export function calculateWidgetUnit({ gridWidth, gap, columns }: WidgetUnitInput): number {
  return Math.max(0, (gridWidth - gap * (columns - 1)) / columns);
}

/** FLIP measures the old layout before React changes it, including interrupted motion. */
export default class AnimatedWidgetGrid extends Component<Props, Record<string, never>, Snapshot> {
  private grid = createRef<HTMLDivElement>();
  private animations = new Set<Animation>();
  private layoutObserver: ResizeObserver | null = null;
  private observedLayoutTargets = new Set<Element>();
  private measurementFrame: number | null = null;

  private updateBoardUnit = () => {
    const grid = this.grid.current;
    if (!grid) return;

    const gridStyle = window.getComputedStyle(grid);
    const configuredColumns = Number.parseInt(gridStyle.getPropertyValue("--widget-columns"), 10);
    const columns: 2 | 4 = configuredColumns === 2 || configuredColumns === 4
      ? configuredColumns
      : window.innerWidth <= 600 ? 2 : 4;
    const computedGap = Number.parseFloat(gridStyle.columnGap);
    const gap = Number.isFinite(computedGap) ? computedGap : 16;
    const isPreview = grid.classList.contains("wa-preview-cards");
    const computedWidth = Number.parseFloat(gridStyle.width);
    const rectWidth = grid.getBoundingClientRect().width;
    // DeviceStage scales preview frames with transform. Computed width stays in
    // the frame's CSS pixels, while the rectangle is correct for the live board.
    const gridWidth = isPreview && computedWidth > 0
      ? computedWidth
      : rectWidth || grid.clientWidth;
    const unit = calculateWidgetUnit({
      gridWidth,
      gap,
      columns,
    });
    const value = `${unit}px`;
    if (grid.style.getPropertyValue("--widget-unit") !== value) grid.style.setProperty("--widget-unit", value);
  };

  private scheduleBoardUnitUpdate = () => {
    if (this.measurementFrame !== null) return;
    this.measurementFrame = window.requestAnimationFrame(() => {
      this.measurementFrame = null;
      this.updateBoardLayout();
    });
  };

  private handleResize = () => {
    this.observeLayout();
    this.scheduleBoardUnitUpdate();
  };

  private observeLayout = () => {
    const grid = this.grid.current;
    if (!grid) return;
    const targets = new Set<Element>([grid]);
    if (targets.size === this.observedLayoutTargets.size && [...targets].every((target) => this.observedLayoutTargets.has(target))) return;
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    this.observedLayoutTargets = targets;
    if (typeof ResizeObserver === "undefined") return;
    this.layoutObserver = new ResizeObserver(this.scheduleBoardUnitUpdate);
    for (const target of targets) this.layoutObserver.observe(target);
  };

  private reducedMotion() {
    return document.documentElement.dataset.motion === "reduced"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private cards() {
    return this.grid.current?.querySelectorAll<HTMLElement>("[data-widget-id]") ?? [];
  }

  private updateCardPlacements() {
    const grid = this.grid.current;
    if (!grid) return;

    const gridStyle = window.getComputedStyle(grid);
    const configuredColumns = Number.parseInt(gridStyle.getPropertyValue("--widget-columns"), 10);
    const columns: 2 | 4 = configuredColumns === 2 || configuredColumns === 4
      ? configuredColumns
      : window.innerWidth <= 600 ? 2 : 4;
    const cards = (Array.from(grid.children) as HTMLElement[]).filter((card) =>
      card.hasAttribute("data-widget-id") || card.classList.contains("wa-preview-card"),
    );
    const placements = calculateWidgetPlacements(cards.map((card) => card.dataset.size ?? "small"), columns,
      cards.map((card) => card.dataset.miniStart === "true"));

    cards.forEach((card, index) => {
      const placement = placements[index];
      card.style.gridColumn = `${placement.column} / span ${placement.columnSpan}`;
      card.style.gridRow = `${placement.row} / span ${placement.rowSpan}`;
    });
  }

  private updateBoardLayout = () => {
    this.updateBoardUnit();
    this.updateCardPlacements();
  };

  getSnapshotBeforeUpdate(previous: Props): Snapshot {
    if (previous.reflowKey !== this.props.reflowKey
      || this.props.animateLayout === false
      || previous.layoutKey === this.props.layoutKey
      || this.reducedMotion()) return null;
    return new Map([...this.cards()].map((card) => [card.dataset.widgetId!, card.getBoundingClientRect()]));
  }

  componentDidUpdate(previous: Props, _state: Record<string, never>, snapshot: Snapshot) {
    this.updateBoardLayout();
    this.observeLayout();
    const reflowChanged = previous.reflowKey !== this.props.reflowKey;
    if (reflowChanged) this.cancelAnimations();
    if (this.props.animateLayout === false || this.reducedMotion()) { this.cancelAnimations(); return; }
    if (reflowChanged || !snapshot) return;
    this.cancelAnimations();
    // Read every destination before animating, so one card cannot affect another's measurement.
    const destinations = [...this.cards()].map((card) => ({ card, rect: card.getBoundingClientRect() }));
    for (const { card, rect } of destinations) {
      const old = snapshot.get(card.dataset.widgetId!);
      if (!old || !rect.width || !rect.height || !old.width || !old.height || typeof card.animate !== "function") continue;
      const configuredDuration = Number.parseFloat(window.getComputedStyle(card).getPropertyValue("--wa-transition-ms"));
      const resizeMotion = this.props.resizeMotion || previous.resizeMotion;
      const configuredTiming = Number.isFinite(configuredDuration) ? configuredDuration : 280;
      const duration = resizeMotion ? Math.min(configuredTiming, 260) : configuredTiming;
      if (duration <= 0) continue;
      const x = old.left - rect.left, y = old.top - rect.top;
      const sx = old.width / rect.width, sy = old.height / rect.height;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(old.width - rect.width) < 0.5 && Math.abs(old.height - rect.height) < 0.5) continue;
      const animation = card.animate([
        { transform: `translate(${x}px, ${y}px) scale(${sx}, ${sy})`, transformOrigin: "top left" },
        { transform: "none", transformOrigin: "top left" },
      ], { duration, easing: resizeMotion ? "cubic-bezier(0.22, 1.18, 0.36, 1)" : "cubic-bezier(0.22, 1, 0.36, 1)" });
      this.animations.add(animation);
      animation.onfinish = animation.oncancel = () => this.animations.delete(animation);
    }
  }

  private cancelAnimations() {
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
  }

  componentDidMount() {
    this.updateBoardLayout();
    this.observeLayout();
    window.addEventListener("resize", this.handleResize);
  }

  componentWillUnmount() {
    this.cancelAnimations();
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    this.observedLayoutTargets.clear();
    if (this.measurementFrame !== null) window.cancelAnimationFrame(this.measurementFrame);
    this.measurementFrame = null;
    window.removeEventListener("resize", this.handleResize);
  }

  render() {
    const className = this.props.className ? `widget-grid ${this.props.className}` : "widget-grid";
    return <div ref={this.grid} className={className} style={this.props.style} aria-label={this.props.label}>{this.props.children}</div>;
  }
}
