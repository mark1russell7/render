import type { Optional } from "@render/optional";
import type { Seat } from "./seat.ts";
import { some, none, isSome } from "@render/optional";
import { seat, link } from "./seat.ts";

/**
 * A SeatPath is a chain of seats representing a full path reference.
 * e.g. ["environment", "farm", "pen", "dog"] → 4 linked seats.
 */
export type SeatPath = {
  readonly segments: readonly string[];
  readonly seats: readonly Seat[];
  /** The final seat — its value is the resolved value of the full path */
  readonly tail: Seat;
};

/** Create a seat path from path segments */
export const seatPath = (segments: readonly string[]): SeatPath => {
  const seats = segments.map(seat);
  for (let i = 0; i < seats.length - 1; i++) {
    link(seats[i]!, seats[i + 1]!);
  }
  const tail = seats[seats.length - 1]!;
  return { segments, seats, tail };
};

/** Resolve a path against a root value, populating each seat's value */
export const resolve = (path: SeatPath, root: unknown): Optional<unknown> => {
  let current: unknown = root;
  for (const s of path.seats) {
    if (current == null || typeof current !== "object") {
      invalidate(s);
      return none;
    }
    const obj = current as Record<string, unknown>;
    if (!(s.segment in obj)) {
      invalidate(s);
      return none;
    }
    current = obj[s.segment];
    s.value = some(current);
  }
  return path.tail.value;
};

/**
 * Rewalk from a specific seat index when an upstream value changes.
 * Corecursive: walks the path and the value structure simultaneously.
 */
export const rewalk = (path: SeatPath, fromIndex: number, root: unknown): void => {
  // Walk to the starting point first
  let current: unknown = root;
  for (let i = 0; i < fromIndex; i++) {
    const s = path.seats[i]!;
    if (!isSome(s.value)) return;
    current = s.value.value;
  }

  // Now rewalk from the changed seat onward
  for (let i = fromIndex; i < path.seats.length; i++) {
    const s = path.seats[i]!;
    if (current == null || typeof current !== "object") {
      const changed = isSome(s.value);
      invalidate(s);
      if (changed) notify(s);
      return;
    }
    const obj = current as Record<string, unknown>;
    if (!(s.segment in obj)) {
      const changed = isSome(s.value);
      invalidate(s);
      if (changed) notify(s);
      return;
    }
    const next = obj[s.segment];
    const prev = s.value;
    s.value = some(next);

    // Only notify if value actually changed
    if (!isSome(prev) || prev.value !== next) {
      notify(s);
    }
    current = next;
  }
};

/** Set all seats from this one onward to none */
const invalidate = (from: Seat): void => {
  from.value = none;
  for (const down of from.downstream) {
    invalidate(down);
  }
};

/** Notify all listeners on a seat */
const notify = (s: Seat): void => {
  for (const listener of s.listeners) {
    listener(s);
  }
};
