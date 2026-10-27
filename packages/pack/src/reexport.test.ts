import { describe, it, expect } from "vitest";
import * as packing from "@mark1russell7/packing";
import * as renderPack from "./index.ts";

describe("render-pack", () => {
  it("re-exports each value of @mark1russell7/packing", () => {
    expect(Object.keys(renderPack).toSorted()).toEqual(Object.keys(packing).toSorted());
    expect(renderPack.Rect).toBe(packing.Rect);
    expect(renderPack.Vector).toBe(packing.Vector);
    expect(renderPack.pack).toBe(packing.pack);
    expect(renderPack.packRows).toBe(packing.packRows);
    expect(renderPack.packShelf).toBe(packing.packShelf);
    expect(renderPack.packSkyline).toBe(packing.packSkyline);
    expect(renderPack.pushCascade).toBe(packing.pushCascade);
    expect(renderPack.packingMetrics).toBe(packing.packingMetrics);
  });

  it("packs with the sort order input", () => {
    const rects = [30, 10, 20].map((h) => {
      const r = new renderPack.Rect();
      r.size.set(40, h);
      return r;
    });
    const outer = new renderPack.Rect();
    outer.size.set(100, 0);
    outer.fixedWidth = true;
    renderPack.pack(rects, outer, { sortOrder: "input" });
    expect(rects.map((r) => [r.position.x, r.position.y])).toEqual([
      [0, 0],
      [40, 0],
      [0, 30],
    ]);
  });
});

// The full tests of these defects moved to `@mark1russell7/packing`. These tests keep them through the re-export.
describe("regressions (docs/REVIEW.md)", () => {
  const rect = (w: number, h: number): packing.Rect => {
    const r = new renderPack.Rect();
    r.size.set(w, h);
    return r;
  };

  it("R-26: an outer rect without fixed sizes is at least as wide as the widest rect", () => {
    const wide = rect(500, 10);
    const small = Array.from({ length: 10 }, () => rect(20, 20));
    const outer = renderPack.pack([wide, ...small]);
    expect(outer.size.x).toBeGreaterThanOrEqual(500);
    for (const r of [wide, ...small]) {
      expect(r.right()).toBeLessThanOrEqual(outer.size.x);
      expect(r.bottom()).toBeLessThanOrEqual(outer.size.y);
    }
  });

  it("R-59: a fixed width stays when each rectangle is wider, and the rectangles overflow on their own rows", () => {
    const rects = [rect(20, 5), rect(30, 5)];
    const outer = new renderPack.Rect();
    outer.size.set(10, 0);
    outer.fixedWidth = true;
    renderPack.pack(rects, outer);
    expect(outer.size.x).toBe(10);
    expect(rects.every((r) => r.wasPacked && r.position.x === 0)).toBe(true);
    expect(rects[0]!.position.y === rects[1]!.position.y).toBe(false);
  });
});
