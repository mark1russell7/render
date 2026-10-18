import { compareRects, type SortOrder } from "./order.ts";
import { Rect } from "./rect.ts";
import { packSkyline } from "./skyline.ts";
import { Vector } from "./vector.ts";

/** The options of `pack` and `packRows` */
export interface PackOptions {
  /** The order of the rectangles before the packing. The default is `height-desc`. */
  sortOrder?: SortOrder;
}

/** The options of `pack` */
export interface PackLayoutOptions extends PackOptions {
  /** The packing: `rows` (the default) or `skyline`. Use `skyline` to pack around locked rectangles. */
  strategy?: "rows" | "skyline";
}

function packInto<T>(rects: Rect<T>[], region: Rect<T>, offset: Vector, order: SortOrder): void {
  const unpacked = Rect.unpacked(rects);
  pack(unpacked, region, { sortOrder: order });
  for (const r of Rect.packed(unpacked)) r.translateBy(offset);
}

function packRow<T>(rects: Rect<T>[], outer: Rect<T>, order: SortOrder): boolean {
  const row: Rect<T>[] = [];
  // toSorted gives a sorted copy, thus the order of the array of the caller stays
  const byHeight = rects.toSorted(compareRects(order));

  const rowRect = new Rect<T>();
  rowRect.size.set(outer.size.x, 0);

  for (const rect of byHeight) {
    if (rect.wasPacked) continue;

    if (rect.size.x > rowRect.size.x) {
      if (outer.fixedSize && rect.size.x > outer.size.x) continue;

      const outerLeft = new Rect<T>();
      outerLeft.position.setTo(rowRect.position);
      outerLeft.size.set(outer.size.x - rowRect.position.x, rowRect.size.y);
      outerLeft.fixedSize = true;
      packInto(rects, outerLeft, outer.position, order);

      rowRect.position.set(0, rowRect.bottom());
      rowRect.size.set(outer.size.x, 0);
      row.length = 0;
    }

    if (rowRect.position.y + rect.size.y > outer.size.y) {
      if (outer.fixedSize) continue;
      outer.size.y += rect.size.y;
      if (!outer.fixedWidth && !outer.size.x) outer.size.x = rect.size.x;
      Rect.resetPacked(rects);
      return false;
    }

    row.push(rect);
    rect.position.setTo(rowRect.position.add(outer.position));
    rowRect.shrinkLeft(rect.size.x);
    rect.wasPacked = true;

    if (rect.size.y > rowRect.size.y) rowRect.size.y = rect.size.y;

    if (row.length > 1) {
      const rectInRow = row[row.length - 1]!;
      const outerLeft = new Rect<T>();
      outerLeft.position.set(rectInRow.position.x, rectInRow.bottom());
      outerLeft.size.set(rectInRow.size.x, rowRect.size.y - rectInRow.size.y);
      outerLeft.fixedWidth = true;
      outerLeft.fixedSize = true;
      packInto(rects, outerLeft, outer.position, order);
    }
  }
  return true;
}

/**
 * This function packs rectangles into an outer rectangle of a given width with a guillotine row packing. It does
 * not change the width. Without `fixedSize`, the height grows until all rectangles fit. A `locked` rectangle keeps
 * its position, but the rows do not go around it. `pack` sets the width first and then uses this function.
 */
export function packRows<T>(rects: Rect<T>[], outer: Rect<T>, options: PackOptions = {}): Rect<T> {
  const order = options.sortOrder ?? "height-desc";
  for (const r of rects) if (r.locked) r.wasPacked = true;
  while (!packRow(rects, outer, order));
  return outer;
}

/**
 * This function packs rectangles into an outer rectangle with a guillotine row packing. It sets the position
 * of each rectangle and the size of the outer rectangle, and it gives the outer rectangle.
 *
 * - Without fixed sizes, the outer rectangle starts with a width of 1.5 times the square root of the total area.
 *   This width is not less than the width of the widest rectangle. The height grows until all rectangles fit.
 * - With `fixedWidth`, the width stays. A rectangle wider than that width goes on its own row and overflows.
 * - With `fixedSize`, a rectangle that does not fit is not packed: its `wasPacked` stays `false`.
 * - `options.strategy` selects `packRows` (the default) or `packSkyline` after the width is set.
 */
export function pack<T>(rects: Rect<T>[], outer: Rect<T> = new Rect(), options: PackLayoutOptions = {}): Rect<T> {
  let totalArea = 0;
  let widest = 0;
  let minX = rects.length > 0 ? Infinity : 0;
  let minY = rects.length > 0 ? Infinity : 0;
  for (const r of rects) {
    totalArea += r.area();
    widest = Math.max(widest, r.size.x);
    minX = Math.min(minX, r.size.x);
    minY = Math.min(minY, r.size.y);
  }

  const idealWidth = outer.fixedWidth
    ? outer.size.x
    : Math.max(widest, Math.min(1.5 * Math.sqrt(totalArea), outer.size.x || Infinity));

  const ideal = Vector.of(idealWidth).clamp(new Vector(minX, minY), Vector.Infinity);

  // A fixed width stays, also when a rectangle is wider: that rectangle overflows
  if (!outer.fixedSize) outer.size.setTo(outer.fixedWidth ? new Vector(outer.size.x, ideal.y) : ideal);
  if (options.strategy === "skyline") packSkyline(rects, outer, options);
  else packRows(rects, outer, options);

  if (!outer.fixedSize) {
    const contentRight = Rect.maxRight(rects);
    if (!outer.size.x) outer.size.x = contentRight;
    else if (!outer.fixedWidth) outer.size.x = Math.min(contentRight, outer.size.x);
    outer.size.y = Rect.maxBottom(rects);
  }

  return outer;
}
