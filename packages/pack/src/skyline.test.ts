import { describe, it, expect } from "vitest";
import { compareRects, lowestWindow, pack, packRows, packSkyline, Rect, SORT_ORDERS } from "@mark1russell7/render-pack";

/** This helper makes a Rect with a given size. */
const rect = (w: number, h: number): Rect => {
  const r = new Rect();
  r.size.set(w, h);
  return r;
};

/** This helper makes an outer Rect with a given size. */
const outerOf = (w: number, h = 0): Rect => {
  const r = new Rect();
  r.size.set(w, h);
  return r;
};

/** This helper tells if two rects overlap. Two rects with a common edge do not overlap. */
const overlaps = (a: Rect, b: Rect): boolean =>
  a.position.x < b.right() && b.position.x < a.right() && a.position.y < b.bottom() && b.position.y < a.bottom();

/** The search that the deque replaces. For each x, it takes the max of the window. The first smallest max wins. */
function bruteLowest(skyline: number[], rw: number): { x: number; y: number } {
  let best = { x: 0, y: Infinity };
  for (let x = 0; x <= skyline.length - rw; x++) {
    const y = Math.max(...skyline.slice(x, x + rw));
    if (y < best.y) best = { x, y };
  }
  return best;
}

describe("lowestWindow", () => {
  it("gives the same window as the brute-force scan (400 random skylines)", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 400; n++) {
      const width = 1 + Math.floor(rand() * 40);
      const skyline = Array.from({ length: width }, () => Math.floor(rand() * 6) * 10);
      const rw = 1 + Math.floor(rand() * width);
      expect(lowestWindow(skyline, width, rw)).toEqual(bruteLowest(skyline, rw));
    }
  });
});

describe("packSkyline", () => {
  it("packs many rects with no overlap, in the width", () => {
    const outer = outerOf(300);
    const items = Array.from({ length: 60 }, (_, i) => rect(20 + ((i * 37) % 90), 10 + ((i * 53) % 70)));
    packSkyline(items, outer);
    for (let i = 0; i < items.length; i++) {
      expect(items[i]!.wasPacked).toBe(true);
      expect(items[i]!.right()).toBeLessThanOrEqual(300);
      for (let j = i + 1; j < items.length; j++) expect(overlaps(items[i]!, items[j]!)).toBe(false);
    }
    expect(outer.size.x).toBe(300);
    expect(outer.size.y).toBe(Rect.maxBottom(items));
  });

  it("puts a rect wider than the outer rect under every placed rect", () => {
    const short = rect(40, 10);
    const tall = rect(40, 80);
    const wide = rect(150, 20);
    packSkyline([short, tall, wide], outerOf(100));
    for (const r of [short, tall, wide]) expect(r.wasPacked).toBe(true);
    expect(wide.position.x).toBe(0);
    expect(wide.position.y).toBeGreaterThanOrEqual(80);
    expect(overlaps(wide, tall) || overlaps(wide, short)).toBe(false);
  });

  it("packs around a locked rect, and keeps its position", () => {
    const pinned = rect(50, 40);
    pinned.position.set(0, 0);
    pinned.locked = true;
    const others = [rect(50, 30), rect(50, 30), rect(30, 10)];
    packSkyline([pinned, ...others], outerOf(100));
    expect(pinned.position.x).toBe(0);
    expect(pinned.position.y).toBe(0);
    for (const r of others) {
      expect(r.wasPacked).toBe(true);
      expect(overlaps(r, pinned)).toBe(false);
    }
  });

  it("with fixedSize, leaves a rect that does not fit unpacked", () => {
    const outer = outerOf(100, 50);
    outer.fixedSize = true;
    const fits = rect(100, 40);
    const tooTall = rect(100, 20);
    const tooWide = rect(120, 5);
    packSkyline([fits, tooTall, tooWide], outer);
    expect(fits.wasPacked).toBe(true);
    expect(tooTall.wasPacked).toBe(false);
    expect(tooWide.wasPacked).toBe(false);
    expect(outer.size.y).toBe(50);
  });

  it("keeps each rect in a width that is not a whole number", () => {
    const outer = outerOf(100.5);
    const items = [rect(50.25, 10), rect(50.25, 10), rect(100.2, 10)];
    packSkyline(items, outer);
    for (const r of items) {
      expect(r.wasPacked).toBe(true);
      expect(r.right()).toBeLessThanOrEqual(100.5);
    }
  });

  it("places relative to the position of the outer rect", () => {
    const outer = outerOf(100);
    outer.position.set(10, 20);
    const r = rect(30, 30);
    packSkyline([r], outer);
    expect(r.position.x).toBe(10);
    expect(r.position.y).toBe(20);
  });

  it("does nothing for an outer rect without width, and skips an empty rect", () => {
    const r = rect(10, 10);
    packSkyline([r], outerOf(0));
    expect(r.wasPacked).toBe(false);
    const empty = rect(0, 10);
    packSkyline([empty], outerOf(100));
    expect(empty.wasPacked).toBe(false);
  });

  it("keeps the order of the array of the caller, and follows the sort order", () => {
    const a = rect(60, 10);
    const b = rect(60, 50);
    const rects = [a, b];
    packSkyline(rects, outerOf(100));
    expect(rects).toEqual([a, b]);
    expect(b.position.y).toBe(0); // height-desc: the taller rect first
    Rect.resetPacked(rects);
    packSkyline(rects, outerOf(100), { sortOrder: "height-asc" });
    expect(a.position.y).toBe(0);
  });
});

describe("the sort orders", () => {
  it("order the rects as their names tell", () => {
    const a = rect(10, 30); // area 300
    const b = rect(40, 20); // area 800
    const c = rect(30, 10); // area 300
    const sorted = (order: (typeof SORT_ORDERS)[number]) => [a, b, c].toSorted(compareRects(order));
    expect(SORT_ORDERS[0]).toBe("height-desc");
    expect(sorted("height-desc")).toEqual([a, b, c]);
    expect(sorted("height-asc")).toEqual([c, b, a]);
    expect(sorted("width-desc")).toEqual([b, c, a]);
    expect(sorted("area-desc")).toEqual([b, a, c]);
  });
});

describe("packRows and the options of pack", () => {
  it("packRows keeps the position of a locked rect, also when the outer rect grows", () => {
    const pinned = rect(20, 20);
    pinned.position.set(70, 70);
    pinned.locked = true;
    const others = [rect(50, 30), rect(50, 30), rect(50, 30)];
    const outer = outerOf(100, 10);
    outer.fixedWidth = true;
    packRows([pinned, ...others], outer);
    expect(pinned.position.x).toBe(70);
    expect(pinned.position.y).toBe(70);
    for (const r of others) expect(r.wasPacked).toBe(true);
  });

  it("Rect.resetPacked keeps a locked rect placed", () => {
    const pinned = rect(10, 10);
    pinned.locked = true;
    pinned.wasPacked = true;
    const free = rect(10, 10);
    free.wasPacked = true;
    Rect.resetPacked([pinned, free]);
    expect(pinned.wasPacked).toBe(true);
    expect(free.wasPacked).toBe(false);
  });

  it("pack with the skyline strategy sets the size of the outer rect to the content", () => {
    const items = Array.from({ length: 20 }, (_, i) => rect(10 + ((i * 7) % 30), 10 + ((i * 11) % 25)));
    const outer = pack(items, undefined, { strategy: "skyline" });
    for (const r of items) expect(r.wasPacked).toBe(true);
    expect(outer.size.x).toBe(Rect.maxRight(items));
    expect(outer.size.y).toBe(Rect.maxBottom(items));
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) expect(overlaps(items[i]!, items[j]!)).toBe(false);
  });

  it("pack follows the sort order of the options", () => {
    const short = rect(60, 10);
    const tall = rect(60, 50);
    const outer = outerOf(100);
    outer.fixedWidth = true;
    pack([short, tall], outer, { sortOrder: "height-asc" });
    expect(short.position.y).toBe(0);
    expect(tall.position.y).toBe(10);
  });
});
