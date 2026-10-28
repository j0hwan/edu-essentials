export function dashboardSummaryShape({ width, height, split, baseHeight, radius, tab }: {
  width: number;
  height: number;
  split: number;
  baseHeight: number;
  radius: number;
  tab?: { center: number; width: number; height: number; radius: number };
}) {
  if (width <= 1 || height <= 1) return "";
  const left = 0.5;
  const top = 0.5;
  const right = width - 0.5;
  const bottom = height - 0.5;
  const corner = Math.max(0, Math.min(radius, (width - 1) / 2, (height - 1) / 2));
  const base = Math.min(bottom, Math.max(top + corner * 2, baseHeight - 0.5));
  const edge = Math.max(left + corner * 2, Math.min(right - corner * 2, split));
  const tabIsRectangle = split >= right || bottom - base < 0.5;
  const tabBend = tabIsRectangle ? 0 : Math.min(corner, (bottom - base) / 2);
  const tabSegmentLeft = left + corner;
  const tabSegmentRight = tabIsRectangle ? right - corner : edge - tabBend;
  const tabSegmentLength = Math.max(0, tabSegmentRight - tabSegmentLeft);
  if (tab && tab.width > 0 && tab.height > 0 && tabSegmentLength > 0) {
    const isRectangle = tabIsRectangle;
    const bend = tabBend;
    const segmentLeft = tabSegmentLeft;
    const segmentRight = tabSegmentRight;
    const requestedWidth = Math.max(0, tab.width);
    if (tab.height <= 2 * tab.radius && tab.radius > 0) {
      const halfRise = tab.height / 2;
      // Scale the corners to the shallow tab instead of stretching the panel radius across it.
      const arcRadius = Math.min(tab.radius, halfRise);
      const run = Math.sqrt(Math.max(0, 2 * arcRadius * halfRise - halfRise * halfRise));
      const reach = 2 * run;
      const tabWidth = Math.min(requestedWidth, tabSegmentLength);
      if (tabWidth < 2 * reach) return isRectangle
        ? `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${bottom - corner} Q ${right} ${bottom} ${right - corner} ${bottom} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${top + corner} Q ${left} ${top} ${left + corner} ${top} Z`
        : `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${base - corner} Q ${right} ${base} ${right - corner} ${base} H ${edge + bend} Q ${edge} ${base} ${edge} ${base + bend} V ${bottom - bend} Q ${edge} ${bottom} ${edge - bend} ${bottom} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${top + corner} Q ${left} ${top} ${left + corner} ${top} Z`;
      const center = Math.max(segmentLeft + tabWidth / 2,
        Math.min(segmentRight - tabWidth / 2, tab.center));
      const mouthLeft = center - tabWidth / 2;
      const mouthRight = center + tabWidth / 2;
      const middle = bottom + halfRise;
      const tabBottom = bottom + tab.height;
      const shallowContour = `H ${mouthRight} A ${arcRadius} ${arcRadius} 0 0 0 ${mouthRight - run} ${middle} A ${arcRadius} ${arcRadius} 0 0 1 ${mouthRight - 2 * run} ${tabBottom} H ${mouthLeft + 2 * run} A ${arcRadius} ${arcRadius} 0 0 1 ${mouthLeft + run} ${middle} A ${arcRadius} ${arcRadius} 0 0 0 ${mouthLeft} ${bottom}`;
      if (isRectangle) {
        return `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${bottom - corner} Q ${right} ${bottom} ${right - corner} ${bottom} ${shallowContour} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${top + corner} Q ${left} ${top} ${left + corner} ${top} Z`;
      }
      return `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${base - corner} Q ${right} ${base} ${right - corner} ${base} H ${edge + bend} Q ${edge} ${base} ${edge} ${base + bend} V ${bottom - bend} Q ${edge} ${bottom} ${edge - bend} ${bottom} ${shallowContour} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${top + corner} Q ${left} ${top} ${left + corner} ${top} Z`;
    }
    const shoulder = Math.min(tab.height / 2, requestedWidth / 4, tabSegmentLength / 3);
    const availableWidth = Math.max(0, segmentRight - segmentLeft - 2 * shoulder);
    const tabWidth = Math.min(requestedWidth, availableWidth);
    const center = Math.max(segmentLeft + shoulder + tabWidth / 2,
      Math.min(segmentRight - shoulder - tabWidth / 2, tab.center));
    const tabLeft = center - tabWidth / 2;
    const tabRight = center + tabWidth / 2;
    const tabBottom = bottom + tab.height;
    const tabRadius = Math.max(0, Math.min(tab.radius, tab.height / 2, tabWidth / 2));
    const bottomLeft = `H ${tabRight + shoulder} Q ${tabRight} ${bottom} ${tabRight} ${bottom + shoulder} V ${tabBottom - tabRadius} Q ${tabRight} ${tabBottom} ${tabRight - tabRadius} ${tabBottom} H ${tabLeft + tabRadius} Q ${tabLeft} ${tabBottom} ${tabLeft} ${tabBottom - tabRadius} V ${bottom + shoulder} Q ${tabLeft} ${bottom} ${tabLeft - shoulder} ${bottom}`;
    if (isRectangle) {
      return `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${bottom - corner} Q ${right} ${bottom} ${right - corner} ${bottom} ${bottomLeft} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${top + corner} Q ${left} ${top} ${left + corner} ${top} Z`;
    }
    return `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${base - corner} Q ${right} ${base} ${right - corner} ${base} H ${edge + bend} Q ${edge} ${base} ${edge} ${base + bend} V ${bottom - bend} Q ${edge} ${bottom} ${edge - bend} ${bottom} ${bottomLeft} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${top + corner} Q ${left} ${top} ${left + corner} ${top} Z`;
  }
  if (split >= right || bottom - base < 0.5) {
    return `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${bottom - corner} Q ${right} ${bottom} ${right - corner} ${bottom} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${top + corner} Q ${left} ${top} ${left + corner} ${top} Z`;
  }
  const bend = Math.min(corner, (bottom - base) / 2);
  return `M ${left + corner} ${top} H ${right - corner} Q ${right} ${top} ${right} ${top + corner} V ${base - corner} Q ${right} ${base} ${right - corner} ${base} H ${edge + bend} Q ${edge} ${base} ${edge} ${base + bend} V ${bottom - bend} Q ${edge} ${bottom} ${edge - bend} ${bottom} H ${left + corner} Q ${left} ${bottom} ${left} ${bottom - corner} V ${top + corner} Q ${left} ${top} ${left + corner} ${top} Z`;
}
