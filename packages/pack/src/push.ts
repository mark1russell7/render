import type { Rect } from "./rect.ts";

/** The options of `pushCascade`. */
export interface PushOptions {
  /** The space between a shoved rectangle and the rectangle that shoves it. The default is 8. */
  gap?: number;
  /** The most shoves. The default is eight for each rectangle. The cascade stops at this limit. */
  maxShoves?: number;
}

/** A direction of a shove: an axis and a sign. */
interface Direction {
  readonly axis: "x" | "y";
  readonly sign: 1 | -1;
}

/** This function gives the overlap of two rectangles on each axis. A value of 0 or less is no overlap. */
function overlapOf(a: Rect, b: Rect): { x: number; y: number } {
  return {
    x: Math.min(a.right(), b.right()) - Math.max(a.position.x, b.position.x),
    y: Math.min(a.bottom(), b.bottom()) - Math.max(a.position.y, b.position.y),
  };
}

/**
 * This function gives the direction of a first shove. The axis has the smaller overlap. The sign points away from the
 * center of the pusher. When that shove crosses 0, the sign is positive.
 */
function firstDirection(pusher: Rect, r: Rect, gap: number): Direction {
  const overlap = overlapOf(pusher, r);
  if (overlap.x < overlap.y) {
    const back = r.position.x + r.size.x / 2 < pusher.position.x + pusher.size.x / 2 && pusher.position.x - r.size.x - gap >= 0;
    return { axis: "x", sign: back ? -1 : 1 };
  }
  const back = r.position.y + r.size.y / 2 < pusher.position.y + pusher.size.y / 2 && pusher.position.y - r.size.y - gap >= 0;
  return { axis: "y", sign: back ? -1 : 1 };
}

/** This function puts a rectangle past the pusher, along a direction. The rectangle does not go past 0. */
function shove(pusher: Rect, r: Rect, direction: Direction, gap: number): void {
  if (direction.axis === "x") {
    const x = direction.sign > 0 ? pusher.right() + gap : pusher.position.x - r.size.x - gap;
    r.position.set(Math.max(0, x), r.position.y);
    return;
  }
  const y = direction.sign > 0 ? pusher.bottom() + gap : pusher.position.y - r.size.y - gap;
  r.position.set(r.position.x, Math.max(0, y));
}

/**
 * This function moves each rectangle that a placed rectangle overlaps, and the rectangles that those overlap in turn.
 * A shove takes the axis of the smaller overlap, away from the pusher. A shoved rectangle keeps the direction of its first
 * shove when it shoves the next one, so the cascade goes outward. The placed rectangle and each locked rectangle stay.
 * The function moves the rectangles in place and gives the rectangles that moved.
 *
 * @example
 * ```ts
 * const moved = pushCascade(dropped, cards, { gap: 8 });
 * ```
 */
export function pushCascade<T>(placed: Rect<T>, rects: readonly Rect<T>[], options: PushOptions = {}): Rect<T>[] {
  const gap = options.gap ?? 8;
  const maxShoves = options.maxShoves ?? rects.length * 8;
  const moved = new Set<Rect<T>>();
  const queue: { pusher: Rect<T>; direction?: Direction }[] = [{ pusher: placed }];
  let shoves = 0;
  while (shoves < maxShoves) {
    const step = queue.shift();
    if (!step) break;
    const { pusher, direction } = step;
    for (const r of rects) {
      if (r === pusher || r === placed || r.locked) continue;
      const overlap = overlapOf(pusher, r);
      if (overlap.x <= 0 || overlap.y <= 0) continue;
      const next = direction ?? firstDirection(pusher, r, gap);
      shove(pusher, r, next, gap);
      moved.add(r);
      queue.push({ pusher: r, direction: next });
      if (++shoves >= maxShoves) break;
    }
  }
  return [...moved];
}
