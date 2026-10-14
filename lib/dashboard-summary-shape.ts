export function dashboardSummaryShape({ width, height, split, baseHeight, radius }: {
  width: number;
  height: number;
  split: number;
  baseHeight: number;
  radius: number;
}) {
  if (width <= 1 || height <= 1) return "";
  const left = 0.5;
  const top = 0.5;
  const right = width - 0.5;
  const bottom = height - 0.5;
  const corner = Math.max(0, Math.min(radius, (width - 1) / 2, (height - 1) / 2));
  const base = Math.min(bottom, Math.max(top + corner * 2, baseHeight - 0.5));
  const edge = Math.max(left + corner * 2, Math.min(right - corner * 2, split));
  if (split >= right || bottom - base < 0.5) {
    return `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${bottom - corner} Q ${right} ${bottom} ${right - corner} ${bottom} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${top + corner} Q ${left} ${top} ${left + corner} ${top} Z`;
  }
  const bend = Math.min(corner, (bottom - base) / 2);
  return `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${base - corner} Q ${right} ${base} ${right - corner} ${base} H ${edge + bend} Q ${edge} ${base} ${edge} ${base + bend} V ${bottom - bend} Q ${edge} ${bottom} ${edge - bend} ${bottom} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${top + corner} Q ${left} ${top} ${left + corner} ${top} Z`;
}
