import type { Rect } from "./rect.ts";

/**
 * An order of the rectangles before the packing. The order changes the layout much. `input` keeps the order of
 * the array of the caller: the row packing then fills no gaps, so its rows read in that order.
 */
export type SortOrder = "height-desc" | "height-asc" | "width-desc" | "area-desc" | "input";

/** This constant lists each sort order. The first one is the default. */
export const SORT_ORDERS: readonly SortOrder[] = ["height-desc", "height-asc", "width-desc", "area-desc", "input"];

/** This function gives the comparator of a sort order. The sort is stable, so `input` keeps the order. */
export function compareRects(order: SortOrder): <T>(a: Rect<T>, b: Rect<T>) => number {
  switch (order) {
    case "height-desc":
      return (a, b) => b.size.y - a.size.y;
    case "height-asc":
      return (a, b) => a.size.y - b.size.y;
    case "width-desc":
      return (a, b) => b.size.x - a.size.x;
    case "area-desc":
      return (a, b) => b.area() - a.area();
    case "input":
      return () => 0;
  }
}
