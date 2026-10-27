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
