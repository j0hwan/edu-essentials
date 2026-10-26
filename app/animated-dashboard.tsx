import { Component, type ReactNode } from "react";

const targets = ".dashboard-study-brief, .class-grid > .class-card, .dashboard-classes > .assignment-table, .dashboard-upcoming";
const fixedBriefElements = ".dashboard-focus-counts, .dashboard-focus-item .status-badge, .dashboard-focus-item > svg, .dashboard-focus-pagination > .dashboard-focus-page-button:last-child";
const legendLabels = ".dashboard-focus-counts > span";

type Rect = { left: number; top: number; width: number; height: number };
type Plan = { element: Element; from: Rect; to: Rect };
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
    this.root.querySelectorAll(`${targets}, .dashboard-study-brief :is(${fixedBriefElements}, ${legendLabels})`).forEach((element) => {
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
    if (duration <= 0 || typeof window.Element.prototype.animate !== "function") return;
    const plans: Plan[] = [];
    root.querySelectorAll(targets).forEach((element) => {
      const from = snapshot.get(element);
      if (!from) return;
      const rect = element.getBoundingClientRect();
      const to = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      if (!from.width || !from.height || !to.width || !to.height) return;
      if (Math.abs(from.left - to.left) < 0.5 && Math.abs(from.top - to.top) < 0.5 && Math.abs(from.width - to.width) < 0.5 && Math.abs(from.height - to.height) < 0.5) return;
      plans.push({ element, from, to });
    });
    const briefPlan = plans.find(({ element }) => element.matches(".dashboard-study-brief"));
    const anchoredPlans: Plan[] = [];
    const labelPlans: Plan[] = [];
    if (briefPlan) {
      briefPlan.element.querySelectorAll(`${fixedBriefElements}, ${legendLabels}`).forEach((element) => {
        const from = snapshot.get(element);
        if (!from) return;
        const rect = element.getBoundingClientRect();
        const to = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        if (!from.width || !from.height || !to.width || !to.height) return;
        (element.matches(legendLabels) ? labelPlans : anchoredPlans).push({ element, from, to });
      });
    }
    this.animations = plans.map(({ element, from, to }) => {
      const deltaX = from.left - to.left;
      const deltaY = from.top - to.top;
      const scaleX = from.width / to.width;
      const scaleY = from.height / to.height;
      return element.animate([
        { translate: `${deltaX}px ${deltaY}px`, scale: `${scaleX} ${scaleY}`, transformOrigin: "top left" },
        { translate: "0px 0px", scale: "1 1", transformOrigin: "top left" },
      ], { duration, easing });
    });
    if (briefPlan) {
      const samples = easingSamples(easing, 40);
      const { from: shellFrom, to: shellTo } = briefPlan;
      const sx = shellFrom.width / shellTo.width;
      const sy = shellFrom.height / shellTo.height;
      const dx = shellFrom.left - shellTo.left;
      const dy = shellFrom.top - shellTo.top;
      for (const { element, from, to } of anchoredPlans) {
        const isLegend = element.matches(".dashboard-focus-counts");
        const frames = samples.map(({ offset, progress }) => {
          const scaleX = sx + (1 - sx) * progress;
          const scaleY = sy + (1 - sy) * progress;
          const parentX = dx * (1 - progress) + (to.left - shellTo.left) * (scaleX - 1);
          const parentY = dy * (1 - progress) + (to.top - shellTo.top) * (scaleY - 1);
          const anchoredLeft = isLegend ? from.left + from.width - to.width : from.left;
          const childX = (anchoredLeft - to.left - parentX) / scaleX;
          const childY = (from.top - to.top - parentY) / scaleY;
          return { offset, translate: `${childX}px ${childY}px`, scale: `${(isLegend ? 1 : from.width / to.width) / scaleX} ${(isLegend ? 1 : from.height / to.height) / scaleY}`, transformOrigin: "top left", easing: "linear" };
        });
        this.animations.push(element.animate(frames, { duration, easing: "linear" }));
      }
      const legendPlan = anchoredPlans.find(({ element }) => element.matches(".dashboard-focus-counts"));
      if (legendPlan) {
        for (const { element, from, to } of labelPlans) {
          const deltaX = (from.left - legendPlan.from.left - legendPlan.from.width) - (to.left - legendPlan.to.left - legendPlan.to.width);
          const deltaY = (from.top - legendPlan.from.top) - (to.top - legendPlan.to.top);
          const scale = from.height / to.height;
          this.animations.push(element.animate([
            { translate: `${deltaX}px ${deltaY}px`, scale: `${scale} ${scale}`, transformOrigin: "top left" },
            { translate: "0px 0px", scale: "1 1", transformOrigin: "top left" },
          ], { duration, easing }));
        }
      }
    }
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

function easingSamples(easing: string, count: number) {
  const normalized = ({ ease: "cubic-bezier(0.25,0.1,0.25,1)", "ease-in": "cubic-bezier(0.42,0,1,1)", "ease-out": "cubic-bezier(0,0,0.58,1)", "ease-in-out": "cubic-bezier(0.42,0,0.58,1)" } as Record<string, string>)[easing] ?? easing;
  const match = normalized.match(/^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/i);
  if (!match) return Array.from({ length: count + 1 }, (_, index) => ({ offset: index / count, progress: index / count }));
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  const bezier = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  return Array.from({ length: count + 1 }, (_, index) => {
    const offset = index / count;
    if (index === 0 || index === count) return { offset, progress: offset };
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const middle = (low + high) / 2;
      if (bezier(middle, x1, x2) < offset) low = middle;
      else high = middle;
    }
    return { offset, progress: bezier((low + high) / 2, y1, y2) };
  });
}
