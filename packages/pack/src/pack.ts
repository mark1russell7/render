import { Rect } from "./rect.js";
import { Vector } from "./vector.js";

const sum = <T>(arr: T[], fn: (item: T) => number): number =>
  arr.reduce((acc, item) => acc + fn(item), 0);

function packInto<T>(rects: Rect<T>[], region: Rect<T>, offset: Vector): void {
  const unpacked = Rect.unpacked(rects);
  pack(unpacked, region);
  for (const r of Rect.packed(unpacked)) r.translateBy(offset);
}

function packRow<T>(rects: Rect<T>[], outer: Rect<T>): boolean {
  const row: Rect<T>[] = [];
  // Sort a copy — don't reorder the caller's array
  const byHeight = [...rects].sort((a, b) => b.size.y - a.size.y);

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
      packInto(rects, outerLeft, outer.position);

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
      packInto(rects, outerLeft, outer.position);
    }
  }
  return true;
}

export function pack<T>(rects: Rect<T>[], outer: Rect<T> = new Rect()): Rect<T> {
  const min = Vector.min(rects.map((r) => r.size));
  const totalArea = sum(rects, (r) => r.area());

  const idealWidth = outer.fixedWidth
    ? outer.size.x
    : Math.min(1.5 * Math.sqrt(totalArea), outer.size.x || Infinity);

  const ideal = Vector.of(idealWidth).clamp(min, Vector.Infinity);

  if (!outer.fixedSize) outer.size.setTo(ideal);
  while (!packRow(rects, outer));

  if (!outer.fixedSize) {
    const contentRight = Rect.maxRight(rects);
    if (!outer.size.x) outer.size.x = contentRight;
    else if (!outer.fixedWidth) outer.size.x = Math.min(contentRight, outer.size.x);
    outer.size.y = Rect.maxBottom(rects);
  }

  return outer;
}
