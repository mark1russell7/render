import type { Optional } from "@render/optional";
import type { Seat } from "./seat.ts";
import { some, none, isSome } from "@render/optional";
import { seat, link } from "./seat.ts";

/**
 * A seat path is a chain of seats for a full path reference.
 * For example, `["environment", "farm", "pen", "dog"]` gives 4 linked seats.
 */
export type SeatPath = {
  readonly segments: readonly string[];
  readonly seats: readonly Seat[];
  /** The last seat. Its value is the resolved value of the full path. */
  readonly tail: Seat;
};

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** This function makes a seat path. A path needs one segment or more, thus an empty path throws a `RangeError`. */
export const seatPath = (segments: readonly string[]): SeatPath => {
  if (segments.length === 0) throw new RangeError("A seat path needs one segment or more.");
  const seats = segments.map(seat);
  for (let i = 0; i < seats.length - 1; i++) link(seats[i]!, seats[i + 1]!);
  return { segments, seats, tail: seats[seats.length - 1]! };
};

/** This function gives the own field of a value, or `none`. */
const field = (current: unknown, segment: string): Optional<unknown> =>
  current !== null && typeof current === "object" && hasOwn(current, segment)
    ? some((current as Record<string, unknown>)[segment])
    : none;

/** This function sets a seat and each seat after it to `none`. */
const invalidate = (from: Seat): void => {
  from.value = none;
  for (const down of from.downstream) invalidate(down);
};

/** This function notifies each listener of a seat. */
const notify = (s: Seat): void => {
  for (const listener of s.listeners) listener(s);
};

/** This function resolves a path against a root value. It sets the value of each seat, and it reads only own fields. */
export const resolve = (path: SeatPath, root: unknown): Optional<unknown> => {
  let current: unknown = root;
  for (const s of path.seats) {
    const next = field(current, s.segment);
    if (!isSome(next)) {
      invalidate(s);
      return none;
    }
    current = next.value;
    s.value = next;
  }
  return path.tail.value;
};

/**
 * This function walks a path again from a seat index, after a change of a value before that seat.
 * It notifies a seat only when its value changes (by reference), or when its value becomes `none`.
 */
export const rewalk = (path: SeatPath, fromIndex: number, root: unknown): void => {
  const start = Math.max(0, fromIndex);
  let current: unknown = root;
  for (let i = 0; i < start; i++) {
    const s = path.seats[i];
    if (!s || !isSome(s.value)) return;
    current = s.value.value;
  }

  for (let i = start; i < path.seats.length; i++) {
    const s = path.seats[i]!;
    const next = field(current, s.segment);
    if (!isSome(next)) {
      const changed = isSome(s.value);
      invalidate(s);
      if (changed) notify(s);
      return;
    }
    const prev = s.value;
    s.value = next;
    if (!isSome(prev) || prev.value !== next.value) notify(s);
    current = next.value;
  }
};
