import { describe, it, expect } from "vitest";
import { pack, Rect } from "@mark1russell7/packing";

// The packer moved to `@mark1russell7/packing`, which has the full tests. The viewer uses it, so these tests keep the
// defects of the packer in the review of this repository.
describe("regressions of the packer (docs/REVIEW.md)", () => {
  const rect = (w: number, h: number): Rect => {
    const r = new Rect();
    r.size.set(w, h);
    return r;
  };

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
});
