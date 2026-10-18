import { describe, expect, it } from "vitest";
import { packingMetrics, pushCascade, Rect } from "@mark1russell7/render-pack";

/** This helper makes a rectangle at a position, with a size. */
const box = (x: number, y: number, w = 100, h = 100): Rect<string> => {
  const r = new Rect<string>();
  r.position.set(x, y);
  r.size.set(w, h);
  return r;
};

/** This helper tells if two rectangles overlap. Two rectangles with a common edge do not overlap. */
const overlaps = (a: Rect, b: Rect): boolean =>
  a.position.x < b.right() && b.position.x < a.right() && a.position.y < b.bottom() && b.position.y < a.bottom();

const noOverlap = (rects: Rect[]): void => {
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!), `${i} and ${j}`).toBe(false);
};

describe("pushCascade", () => {
  it("shoves a rectangle out of the placed one, and the shoved rectangle shoves the next one", () => {
    const placed = box(0, 0);
    const b = box(60, 0);
    const c = box(170, 0);
    const moved = pushCascade(placed, [placed, b, c]);
    expect([placed.position.x, placed.position.y]).toEqual([0, 0]);
    expect(moved).toContain(b);
    expect(moved).toContain(c);
    noOverlap([placed, b, c]);
  });

  it("leaves the rectangles that nothing overlaps, and does not push past 0", () => {
    const placed = box(0, 0);
    const left = box(0, 0, 50, 50);
    const far = box(500, 500);
    const moved = pushCascade(placed, [placed, left, far]);
    expect(moved).not.toContain(far);
    expect(left.position.x).toBeGreaterThanOrEqual(0);
    expect(left.position.y).toBeGreaterThanOrEqual(0);
  });

  it("leaves no overlap after a drop into a grid", () => {
    // A 4 by 3 grid of 90 px rectangles with 10 px gaps, and a 150 px rectangle placed in it
    const placed = box(95, 95, 150, 150);
    const grid = Array.from({ length: 12 }, (_, i) => box((i % 4) * 100, Math.floor(i / 4) * 100, 90, 90));
    pushCascade(placed, [placed, ...grid]);
    expect([placed.position.x, placed.position.y]).toEqual([95, 95]);
    noOverlap([placed, ...grid]);
  });

  it("does not move a locked rectangle", () => {
    const placed = box(0, 0);
    const pinned = box(50, 0);
    pinned.locked = true;
    const moved = pushCascade(placed, [placed, pinned]);
    expect(moved).toEqual([]);
    expect([pinned.position.x, pinned.position.y]).toEqual([50, 0]);
  });

  it("stops at maxShoves", () => {
    const placed = box(0, 0);
    const others = [box(10, 0), box(20, 0), box(30, 0)];
    const moved = pushCascade(placed, [placed, ...others], { maxShoves: 1 });
    expect(moved).toHaveLength(1);
  });
});

describe("packingMetrics", () => {
  it("measures the hull, the rows, the raggedness and the utilization", () => {
    // Two rows: 100 + 100 wide, then 300 wide
    const metrics = packingMetrics([box(0, 0), box(100, 0), box(0, 100, 300, 100)]);
    expect(metrics.count).toBe(3);
    expect(metrics.hull).toEqual({ width: 300, height: 200 });
    expect(metrics.hullAspect).toBe(1.5);
    expect(metrics.rows).toEqual([2, 1]);
    expect(metrics.raggedness).toBe(100);
    expect(metrics.utilization).toBeCloseTo((100 * 100 * 2 + 300 * 100) / (300 * 200));
    expect(metrics.widestOverMedian).toBe(3);
  });

  it("puts tops within the tolerance in one row", () => {
    expect(packingMetrics([box(0, 0), box(100, 30)]).rows).toEqual([2]);
    expect(packingMetrics([box(0, 0), box(100, 30)], { rowTolerance: 10 }).rows).toEqual([1, 1]);
  });

  it("gives zeros for no rectangles, and skips the rectangles without area", () => {
    expect(packingMetrics([])).toEqual({ count: 0, hull: { width: 0, height: 0 }, hullAspect: 0, rows: [], raggedness: 0, utilization: 0, widestOverMedian: 0 });
    expect(packingMetrics([box(0, 0), box(500, 500, 0, 10)]).count).toBe(1);
  });
});
