import { describe, it, expect } from "vitest";
import * as packing from "@mark1russell7/packing";
import * as renderPack from "./index.ts";

describe("render-pack", () => {
  it("re-exports each value of @mark1russell7/packing", () => {
    expect(Object.keys(renderPack).sort()).toEqual(Object.keys(packing).sort());
    for (const name of ["Rect", "Vector", "pack", "packRows", "packSkyline", "pushCascade", "packingMetrics"] as const)
      expect(renderPack[name]).toBe(packing[name]);
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
