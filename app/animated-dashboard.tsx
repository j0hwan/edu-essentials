import { Component, type ReactNode } from "react";

const targets = ".dashboard-study-brief, .dashboard-classes-heading, .class-grid > .class-card, .dashboard-classes > .assignment-table, .dashboard-upcoming";

type Rect = { left: number; top: number; width: number; height: number };
type Props = { reflowKey: string; reducedMotion?: boolean; children: ReactNode };
type State = Record<string, never>;

export default class AnimatedDashboard extends Component<Props, State> {
  private root: HTMLDivElement | null = null;
  private animations: Animation[] = [];
  private motionPreference: MediaQueryList | null = null;
  private resizeHandler = () => this.cancelAnimations();
  private motionHandler = () => {
    if (this.motionDisabled()) this.cancelAnimations();
  };

  getSnapshotBeforeUpdate(previous: Props) {
    if (previous.reflowKey === this.props.reflowKey || !this.root) return null;
    const rects = new Map<Element, Rect>();
    this.root.querySelectorAll(targets).forEach((element) => {
      const rect = element.getBoundingClientRect();
      rects.set(element, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    });
    return rects;
  }

  componentDidMount() {
    window.addEventListener("resize", this.resizeHandler);
    this.motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.motionPreference?.addEventListener?.("change", this.motionHandler);
  }

  componentDidUpdate(_previous: Props, _state: State, snapshot: Map<Element, Rect> | null) {
    if (this.motionDisabled()) {
      this.cancelAnimations();
      return;
    }
    if (!snapshot) return;
    this.cancelAnimations();
    const root = this.root;
    if (!root) return;
    const style = window.getComputedStyle(root);
    const duration = this.parseDuration(style.getPropertyValue("--shell-reflow-duration")) ?? 320;
    const easing = style.getPropertyValue("--shell-reflow-easing").trim() || "cubic-bezier(.22,1,.36,1.06)";
    if (duration <= 0 || typeof window.HTMLElement.prototype.animate !== "function") return;
    const plans: { element: Element; from: Rect; to: Rect }[] = [];
    root.querySelectorAll(targets).forEach((element) => {
      const from = snapshot.get(element);
      if (!from) return;
      const rect = element.getBoundingClientRect();
      const to = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      if (!from.width || !from.height || !to.width || !to.height) return;
      if (Math.abs(from.left - to.left) < 0.5 && Math.abs(from.top - to.top) < 0.5 && Math.abs(from.width - to.width) < 0.5 && Math.abs(from.height - to.height) < 0.5) return;
      plans.push({ element, from, to });
    });
    this.animations = plans.map(({ element, from, to }) => {
      const deltaX = from.left - to.left;
      const deltaY = from.top - to.top;
      const scaleX = from.width / to.width;
      const scaleY = from.height / to.height;
      return (element as HTMLElement).animate([
        { translate: `${deltaX}px ${deltaY}px`, scale: `${scaleX} ${scaleY}`, transformOrigin: "top left" },
        { translate: "0px 0px", scale: "1 1", transformOrigin: "top left" },
      ], { duration, easing });
    });
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.resizeHandler);
    this.motionPreference?.removeEventListener?.("change", this.motionHandler);
    this.cancelAnimations();
  }

  private motionDisabled() {
    return this.props.reducedMotion === true || document.documentElement.dataset.motion === "reduced" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  private parseDuration(value: string) {
    const match = value.trim().match(/^([\d.]+)\s*(ms|s)$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    return Number.isFinite(amount) ? amount * (match[2].toLowerCase() === "s" ? 1000 : 1) : null;
  }

  private cancelAnimations() {
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
  }

  render() {
    return <div ref={(node) => { this.root = node; }} className="page dashboard-page dashboard-reflow">{this.props.children}</div>;
  }
}
