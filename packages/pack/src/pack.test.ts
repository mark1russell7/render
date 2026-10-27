import { describe, it, expect } from "vitest";
import { pack, Rect } from "@mark1russell7/render-pack";

/** Helper: create a Rect with a given size */
const rect = (w: number, h: number): Rect => {
  const r = new Rect();
  r.size.set(w, h);
  return r;
};

/** Check whether two rects overlap (sharing an edge is not overlap) */
const overlaps = (a: Rect, b: Rect): boolean => {
  if (a.position.x >= b.right()) return false;
  if (b.position.x >= a.right()) return false;
  if (a.position.y >= b.bottom()) return false;
  if (b.position.y >= a.bottom()) return false;
  return true;
};

describe("pack", () => {
  it("single rect packs at origin", () => {
    const r = rect(10, 20);
    pack([r]);
    expect(r.wasPacked).toBe(true);
    expect(r.position.x).toBe(0);
    expect(r.position.y).toBe(0);
  });

  it("two small rects fit side by side in a wide outer", () => {
    const a = rect(10, 10);
    const b = rect(10, 10);
    const outer = new Rect();
    outer.size.set(100, 100);
    outer.fixedSize = true;
    pack([a, b], outer);
    expect(a.wasPacked).toBe(true);
    expect(b.wasPacked).toBe(true);
    // They should not be at the same position
    const samePos = a.position.x === b.position.x && a.position.y === b.position.y;
    expect(samePos).toBe(false);
  });

  it("rects wrap to new row when width is exceeded", () => {
    const rects = [rect(60, 10), rect(60, 10)];
    const outer = new Rect();
    outer.size.set(100, 200);
    outer.fixedWidth = true;
    pack(rects, outer);
    // Both should be packed
    expect(rects[0]!.wasPacked).toBe(true);
    expect(rects[1]!.wasPacked).toBe(true);
    // Second rect should be on a different row (different y)
    expect(rects[1]!.position.y).toBeGreaterThan(0);
  });

  it("fixedWidth constrains width", () => {
    const rects = [rect(30, 10), rect(30, 10), rect(30, 10)];
    const outer = new Rect();
    outer.size.set(50, 500);
    outer.fixedWidth = true;
    pack(rects, outer);
    for (const r of rects) {
      expect(r.wasPacked).toBe(true);
      // No rect should extend beyond the outer's width
      expect(r.right()).toBeLessThanOrEqual(outer.size.x);
    }
  });

  it("R-59: a fixed width stays when each rectangle is wider, and the rectangles overflow on their own rows", () => {
    const rects = [rect(20, 5), rect(30, 5)];
    const outer = new Rect();
    outer.size.set(10, 0);
    outer.fixedWidth = true;
    pack(rects, outer);
    expect(outer.size.x).toBe(10);
    expect(rects.every((r) => r.wasPacked && r.position.x === 0)).toBe(true);
    expect(rects[0]!.position.y === rects[1]!.position.y).toBe(false);
  });

  it("empty array returns without error", () => {
    const outer = new Rect();
    expect(() => pack([], outer)).not.toThrow();
  });

  it("packed rects do not overlap", () => {
    const rects = [
      rect(20, 30),
      rect(15, 25),
      rect(30, 10),
      rect(10, 40),
      rect(25, 15),
    ];
    pack(rects);
    const packed = rects.filter((r) => r.wasPacked);
    for (let i = 0; i < packed.length; i++) {
      for (let j = i + 1; j < packed.length; j++) {
        expect(overlaps(packed[i]!, packed[j]!)).toBe(false);
      }
    }
  });

  it("all rects have wasPacked=true after packing", () => {
    const rects = [rect(10, 10), rect(20, 15), rect(5, 30)];
    pack(rects);
    for (const r of rects) {
      expect(r.wasPacked).toBe(true);
    }
  });
});

describe("regressions (docs/REVIEW.md)", () => {
  it("R-26: an outer rect without fixed sizes is at least as wide as the widest rect", () => {
    const wide = rect(500, 10);
    const small = Array.from({ length: 10 }, () => rect(20, 20));
    const outer = pack([wide, ...small]);
    expect(outer.size.x).toBeGreaterThanOrEqual(500);
    for (const r of [wide, ...small]) {
      expect(r.right()).toBeLessThanOrEqual(outer.size.x);
      expect(r.bottom()).toBeLessThanOrEqual(outer.size.y);
    }
  });
});

describe("the sort order input", () => {
  /**
   * This helper tells if the rects read in the order of the array: left to right in a row, and a new row starts at
   * the left edge under all the rects before it.
   */
  const readsInOrder = (rects: Rect[]): boolean =>
    rects.every((r, i) => {
      const prev = rects[i - 1];
      if (prev === undefined) return true;
      if (r.position.y === prev.position.y) return r.position.x >= prev.right();
      return r.position.x === 0 && r.position.y >= Rect.maxBottom(rects.slice(0, i));
    });

  it("keeps the order of ranked rects of different heights, with no overlap and in the bounds", () => {
    const ranked = Array.from({ length: 40 }, (_, i) => rect(10 + ((i * 13) % 37), 5 + ((i * 17) % 41)));
    const outer = new Rect();
    outer.size.set(120, 0);
    outer.fixedWidth = true;
    pack(ranked, outer, { sortOrder: "input" });
    expect(ranked.every((r) => r.wasPacked)).toBe(true);
    expect(readsInOrder(ranked)).toBe(true);
    for (const r of ranked) {
      expect(r.position.x).toBeGreaterThanOrEqual(0);
      expect(r.position.y).toBeGreaterThanOrEqual(0);
      expect(r.right()).toBeLessThanOrEqual(outer.size.x);
      expect(r.bottom()).toBeLessThanOrEqual(outer.size.y);
    }
    for (let i = 0; i < ranked.length; i++)
      for (let j = i + 1; j < ranked.length; j++) expect(overlaps(ranked[i]!, ranked[j]!)).toBe(false);
  });

  it("fills no gap with a later rect, and the default order fills it", () => {
    const make = () => [rect(50, 50), rect(40, 10), rect(40, 10), rect(60, 10)];
    const outerOf100 = () => {
      const outer = new Rect();
      outer.size.set(100, 0);
      outer.fixedWidth = true;
      return outer;
    };
    const kept = make();
    pack(kept, outerOf100(), { sortOrder: "input" });
    expect(kept.map((r) => [r.position.x, r.position.y])).toEqual([
      [0, 0],
      [50, 0],
      [0, 50],
      [40, 50],
    ]);
    const filled = make();
    pack(filled, outerOf100());
    expect([filled[2]!.position.x, filled[2]!.position.y]).toEqual([50, 10]); // in the gap under the second rect
    expect(readsInOrder(filled)).toBe(false);
  });

  it("does not change the array of the caller", () => {
    const rects = [rect(10, 5), rect(10, 30), rect(10, 15)];
    const copy = [...rects];
    pack(rects, undefined, { sortOrder: "input" });
    expect(rects).toEqual(copy);
  });
});
