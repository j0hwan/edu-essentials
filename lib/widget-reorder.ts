import { calculateWidgetPlacements } from "./widget-layout";

export type WidgetGridRect = Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom">;

export type WidgetInsertionInput = {
  ids: readonly string[];
  sizes: Readonly<Record<string, string>>;
  draggedId: string;
  columns: 2 | 4;
  gridRect: WidgetGridRect;
  unit: number;
  gap: number;
  pointerX: number;
  pointerY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  previousIndex: number | null;
  miniStarts?: Readonly<Record<string, boolean>>;
  previousStartsNewMiniBlock?: boolean;
  hysteresisPx?: number;
};

export type WidgetInsertionCandidate = {
  index: number;
  startsNewMiniBlock: boolean;
};

/** Return a new ID order with the dragged item at its final zero-based slot. */
export function reorderWidgetIds(ids: readonly string[], draggedId: string, destinationIndex: number): string[] {
  const currentIndex = ids.indexOf(draggedId);
  if (currentIndex < 0) return [...ids];

  const next = [...ids];
  const [dragged] = next.splice(currentIndex, 1);
  const insertionIndex = Math.max(0, Math.min(next.length, Math.trunc(destinationIndex)));
  next.splice(insertionIndex, 0, dragged);
  return next;
}

/**
 * Project the grab-corrected pointer onto the closest hypothetical packed slot
 * and mini-block mode. Candidate geometry uses the same placement function as
 * the rendered grid, including half-height mini pairs.
 */
export function getWidgetInsertionCandidate(input: WidgetInsertionInput): WidgetInsertionCandidate | null {
  const {
    ids,
    sizes,
    draggedId,
    columns,
    gridRect,
    unit,
    gap,
    pointerX,
    pointerY,
    grabOffsetX,
    grabOffsetY,
    previousIndex,
    miniStarts,
    previousStartsNewMiniBlock,
    hysteresisPx = 14,
  } = input;
  if (!ids.includes(draggedId) || ids.length === 0 || unit <= 0 || gap < 0) return null;
  if (pointerX < gridRect.left || pointerX > gridRect.right || pointerY < gridRect.top || pointerY > gridRect.bottom) return null;

  const desiredLeft = pointerX - grabOffsetX;
  const desiredTop = pointerY - grabOffsetY;
  const rowUnit = Math.max(0, (unit - gap) / 2);
  const candidateCount = ids.length;
  const draggedIsMini = sizes[draggedId] === "mini";
  const currentStart = draggedIsMini && (miniStarts?.[draggedId] ?? false);
  const previousStart = draggedIsMini
    ? previousStartsNewMiniBlock ?? currentStart
    : false;
  const candidates: Array<WidgetInsertionCandidate & {
    score: number;
    readingOrderConflicts: number;
    landingSlot: string;
  }> = [];

  for (let destinationIndex = 0; destinationIndex < candidateCount; destinationIndex += 1) {
    const candidateIds = reorderWidgetIds(ids, draggedId, destinationIndex);
    const draggedIndex = candidateIds.indexOf(draggedId);
    const modes = draggedIsMini ? [false, true] : [false];
    for (const startsNewMiniBlock of modes) {
      const starts = candidateIds.map((id) => id === draggedId
        ? startsNewMiniBlock
        : miniStarts?.[id] ?? false);
      const placements = calculateWidgetPlacements(candidateIds.map((id) => sizes[id] ?? "small"), columns, starts);
      const placement = placements[draggedIndex];
      const candidateLeft = gridRect.left + (placement.column - 1) * (unit + gap);
      const candidateTop = gridRect.top + (placement.row - 1) * (rowUnit + gap);
      // Dense packing can give different insertion orders the same landing slot.
      // Prefer visually earlier cards before the dragged card, so dropping below
      // a row also moves it after that row in the saved order.
      const draggedPosition = (placement.row - 1) * columns + placement.column - 1;
      const readingOrderConflicts = placements.reduce((count, neighbor, index) => {
        const position = (neighbor.row - 1) * columns + neighbor.column - 1;
        return count + Number(index < draggedIndex && position > draggedPosition
          || index > draggedIndex && position < draggedPosition);
      }, 0);
      candidates.push({
        index: destinationIndex,
        startsNewMiniBlock,
        score: Math.hypot(candidateLeft - desiredLeft, candidateTop - desiredTop),
        readingOrderConflicts,
        landingSlot: `${placement.column}:${placement.row}`,
      });
    }
  }

  let best = candidates[0];
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.score < best.score - 0.5
      || Math.abs(candidate.score - best.score) <= 0.5
        && candidate.readingOrderConflicts < best.readingOrderConflicts) best = candidate;
  }

  if (previousIndex !== null && previousIndex >= 0 && previousIndex < candidateCount) {
    const previous = candidates.find((candidate) => candidate.index === previousIndex
      && candidate.startsNewMiniBlock === previousStart);
    if (previous && previous.score <= best.score + Math.max(0, hysteresisPx)
      && (previous.index === best.index
        || !(previous.landingSlot === best.landingSlot
          && previous.readingOrderConflicts > best.readingOrderConflicts))) {
      return { index: previous.index, startsNewMiniBlock: previous.startsNewMiniBlock };
    }
  }

  return { index: best.index, startsNewMiniBlock: best.startsNewMiniBlock };
}

export function getWidgetInsertionIndex(input: WidgetInsertionInput): number | null {
  return getWidgetInsertionCandidate(input)?.index ?? null;
}
