import { compareRects, type SortOrder } from "./order.ts";
import type { Rect } from "./rect.ts";

/**
 * This function finds the lowest window of width `rw` on a skyline. For each `x` in `[0, width - rw]`, the height
 * of the window is the largest value of `skyline[x, x + rw)`. The first `x` with the smallest height wins. A
 * monotonic deque makes the search O(width) for one rectangle.
 */
export function lowestWindow(skyline: ArrayLike<number>, width: number, rw: number): { x: number; y: number } {
  const deque = new Int32Array(width);
  let head = 0;
  let tail = 0;
  let bestX = 0;
  let bestY = Infinity;
  for (let i = 0; i < width; i++) {
    while (tail > head && skyline[deque[tail - 1]!]! <= skyline[i]!) tail--;
    deque[tail++] = i;
    if (deque[head]! <= i - rw) head++;
    if (i >= rw - 1) {
      const max = skyline[deque[head]!]!;
      if (max < bestY) {
        bestY = max;
        bestX = i - rw + 1;
      }
    }
  }
  return { x: bestX, y: bestY };
}

/**
 * This function packs rectangles into an outer rectangle with a skyline. It puts each rectangle in the lowest place
 * where it fits, and it does not change the width of the outer rectangle.
 *
 * - A `locked` rectangle keeps its position. The skyline starts at its bottom edge across its width, thus the other
 *   rectangles go under it. The space above it stays empty, because a skyline has no holes.
 * - The skyline has a cell for each whole unit of the width. A rectangle that needs more cells than the outer
 *   rectangle has goes under all other rectangles, at the left edge.
 * - Without `fixedSize`, the height of the outer rectangle grows to the content. With `fixedSize`, a rectangle that
 *   does not fit is not packed: its `wasPacked` stays `false`.
 * - The default sort order is `height-desc`. The order of the array of the caller stays.
 */
export function packSkyline<T>(rects: Rect<T>[], outer: Rect<T>, options: { sortOrder?: SortOrder } = {}): Rect<T> {
  // a cell for each whole unit of the width: a rectangle never goes past the right edge
  const width = Math.floor(outer.size.x);
  if (width <= 0) return outer;
  const skyline = new Float64Array(width);

  for (const rect of rects) {
    if (!rect.locked) continue;
    rect.wasPacked = true;
    const x0 = Math.max(0, Math.floor(rect.position.x - outer.position.x));
    const x1 = Math.min(width, Math.ceil(rect.position.x - outer.position.x + rect.size.x));
    const bottom = rect.position.y - outer.position.y + rect.size.y;
    for (let i = x0; i < x1; i++) skyline[i] = Math.max(skyline[i]!, bottom);
    if (!outer.fixedSize) outer.size.y = Math.max(outer.size.y, bottom);
  }

  for (const rect of rects.toSorted(compareRects(options.sortOrder ?? "height-desc"))) {
    if (rect.wasPacked) continue;
    const rw = Math.ceil(rect.size.x);
    const rh = rect.size.y;
    if (rw <= 0 || rh <= 0) continue;

    let x: number;
    let y: number;
    if (rw > width) {
      if (outer.fixedSize) continue;
      x = 0;
      y = 0;
      for (let i = 0; i < width; i++) if (skyline[i]! > y) y = skyline[i]!;
    } else {
      ({ x, y } = lowestWindow(skyline, width, rw));
      if (outer.fixedSize && y + rh > outer.size.y) continue;
    }

    rect.position.set(x + outer.position.x, y + outer.position.y);
    rect.wasPacked = true;
    const top = y + rh;
    for (let i = x; i < Math.min(width, x + rw); i++) skyline[i] = top;
    if (!outer.fixedSize) outer.size.y = Math.max(outer.size.y, top);
  }
  return outer;
}
