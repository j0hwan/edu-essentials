export const widgetSizes = ["small", "medium", "large", "mini", "medium-vertical"] as const;

export type WidgetSize = (typeof widgetSizes)[number];

export type WidgetSizeFootprint = {
  width: number;
  height: number;
};

export type WidgetPlacement = {
  column: number;
  columnSpan: number;
  row: number;
  rowSpan: number;
};

export type WidgetResizePriority = {
  widgetId: string;
  columns: 2 | 4;
  column: number;
  row: number;
};

const widgetSizeFootprints: Record<WidgetSize, WidgetSizeFootprint> = {
  small: { width: 1, height: 1 },
  medium: { width: 2, height: 1 },
  large: { width: 2, height: 2 },
  mini: { width: 1, height: 0.5 },
  "medium-vertical": { width: 1, height: 2 },
};

export const widgetSizeOptions: readonly {
  value: WidgetSize;
  label: string;
  footprint: WidgetSizeFootprint;
}[] = [
  { value: "mini", label: "Mini", footprint: widgetSizeFootprints.mini },
  { value: "small", label: "Small", footprint: widgetSizeFootprints.small },
  { value: "medium", label: "Medium horizontal", footprint: widgetSizeFootprints.medium },
  { value: "medium-vertical", label: "Medium vertical", footprint: widgetSizeFootprints["medium-vertical"] },
  { value: "large", label: "Large", footprint: widgetSizeFootprints.large },
];

export function getWidgetSizeFootprint(size: WidgetSize): WidgetSizeFootprint {
  return widgetSizeFootprints[size];
}

/** Place full small-cell footprints row-major, pairing mini cards in one cell. */
export function calculateWidgetPlacements(
  sizes: readonly string[],
  columns: 2 | 4,
  startsNewMiniBlocks: readonly boolean[] = [],
  priority?: { index: number; column: number; row: number },
): WidgetPlacement[] {
  const widgetCellFootprints: Record<string, { width: number; height: number }> = {
    small: { width: 1, height: 1 },
    medium: { width: 2, height: 1 },
    "medium-vertical": { width: 1, height: 2 },
    large: { width: 2, height: 2 },
  };
  const occupied: boolean[][] = [];
  let pendingMini: { column: number; row: number } | null = null;

  const findFreeCell = (width: number, height: number) => {
    for (let row = 0; ; row += 1) {
      for (let column = 0; column <= columns - width; column += 1) {
        let free = true;
        for (let offsetY = 0; offsetY < height && free; offsetY += 1) {
          for (let offsetX = 0; offsetX < width; offsetX += 1) {
            if (occupied[row + offsetY]?.[column + offsetX]) {
              free = false;
              break;
            }
          }
        }
        if (free) return { column, row };
      }
    }
  };

  const reserve = (column: number, row: number, width: number, height: number) => {
    for (let offsetY = 0; offsetY < height; offsetY += 1) {
      occupied[row + offsetY] ??= Array.from({ length: columns }, () => false);
      for (let offsetX = 0; offsetX < width; offsetX += 1) occupied[row + offsetY][column + offsetX] = true;
    }
  };

  let priorityPlacement: WidgetPlacement | undefined;
  if (priority && Number.isInteger(priority.index) && priority.index >= 0 && priority.index < sizes.length
    && Number.isInteger(priority.column) && Number.isInteger(priority.row) && priority.row >= 1 && priority.row <= 399) {
    const size = sizes[priority.index];
    const footprint = widgetCellFootprints[size] ?? widgetCellFootprints.small;
    const column = Math.max(0, Math.min(columns - footprint.width, priority.column - 1));
    const row = Math.floor((priority.row - 1) / 2);
    reserve(column, row, footprint.width, footprint.height);
    priorityPlacement = { column: column + 1, columnSpan: footprint.width, row: row * 2 + 1, rowSpan: size === "mini" ? 1 : footprint.height * 2 };
    if (size === "mini" && !startsNewMiniBlocks[priority.index]) pendingMini = { column, row };
  }

  return sizes.map((size, index) => {
    if (index === priority?.index && priorityPlacement) {
      if (size === "mini" && startsNewMiniBlocks[index]) pendingMini = { column: priorityPlacement.column - 1, row: (priorityPlacement.row - 1) / 2 };
      return priorityPlacement;
    }
    if (size === "mini") {
      if (pendingMini && !startsNewMiniBlocks[index]) {
        const placement = {
          column: pendingMini.column + 1,
          columnSpan: 1,
          row: pendingMini.row * 2 + 2,
          rowSpan: 1,
        };
        pendingMini = null;
        return placement;
      }

      const cell = findFreeCell(1, 1);
      reserve(cell.column, cell.row, 1, 1);
      pendingMini = cell;
      return {
        column: cell.column + 1,
        columnSpan: 1,
        row: cell.row * 2 + 1,
        rowSpan: 1,
      };
    }

    const footprint = widgetCellFootprints[size] ?? widgetCellFootprints.small;
    const cell = findFreeCell(footprint.width, footprint.height);
    reserve(cell.column, cell.row, footprint.width, footprint.height);
    return {
      column: cell.column + 1,
      columnSpan: footprint.width,
      row: cell.row * 2 + 1,
      rowSpan: footprint.height * 2,
    };
  });
}
