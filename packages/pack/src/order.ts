import type { Rect } from "./rect.ts";

/** An order of the rectangles before the packing. The order changes the layout much. */
export type SortOrder = "height-desc" | "height-asc" | "width-desc" | "area-desc";

/** This constant lists each sort order. The first one is the default. */
export const SORT_ORDERS: readonly SortOrder[] = ["height-desc", "height-asc", "width-desc", "area-desc"];

/** This function gives the comparator of a sort order. */
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
  }
}
