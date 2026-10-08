import { describe, it, expect } from "vitest";
import { pack, Rect } from "@render/pack";

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
