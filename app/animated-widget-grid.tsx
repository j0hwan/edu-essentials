"use client";

import { Component, createRef, type ReactNode } from "react";

type Props = { layoutKey: string; label: string; children: ReactNode };
type Snapshot = Map<string, DOMRect> | null;

/** FLIP measures the old layout before React changes it, including interrupted motion. */
export default class AnimatedWidgetGrid extends Component<Props, Record<string, never>, Snapshot> {
  private grid = createRef<HTMLDivElement>();
  private animations = new Set<Animation>();

  private reducedMotion() {
    return document.documentElement.dataset.motion === "reduced"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private cards() {
    return this.grid.current?.querySelectorAll<HTMLElement>("[data-widget-id]") ?? [];
  }

  getSnapshotBeforeUpdate(previous: Props): Snapshot {
    if (previous.layoutKey === this.props.layoutKey || this.reducedMotion()) return null;
    return new Map([...this.cards()].map((card) => [card.dataset.widgetId!, card.getBoundingClientRect()]));
  }

  componentDidUpdate(_previous: Props, _state: Record<string, never>, snapshot: Snapshot) {
    if (this.reducedMotion()) { this.cancelAnimations(); return; }
    if (!snapshot) return;
    this.cancelAnimations();
    // Read every destination before animating, so one card cannot affect another's measurement.
    const destinations = [...this.cards()].map((card) => ({ card, rect: card.getBoundingClientRect() }));
    for (const { card, rect } of destinations) {
      const old = snapshot.get(card.dataset.widgetId!);
      if (!old || !rect.width || !rect.height || !old.width || !old.height || typeof card.animate !== "function") continue;
      const x = old.left - rect.left, y = old.top - rect.top;
      const sx = old.width / rect.width, sy = old.height / rect.height;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(old.width - rect.width) < 0.5 && Math.abs(old.height - rect.height) < 0.5) continue;
      const animation = card.animate([
        { transform: `translate(${x}px, ${y}px) scale(${sx}, ${sy})`, transformOrigin: "top left" },
        { transform: "none", transformOrigin: "top left" },
      ], { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      this.animations.add(animation);
      animation.onfinish = animation.oncancel = () => this.animations.delete(animation);
    }
  }

  private cancelAnimations() {
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
  }

  componentWillUnmount() { this.cancelAnimations(); }

  render() {
    return <div ref={this.grid} className="widget-grid" aria-label={this.props.label}>{this.props.children}</div>;
  }
}
