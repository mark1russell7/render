import type { Optional } from "@render/optional";
import { none } from "@render/optional";

/**
 * A seat is one segment of a path chain. It holds the value that the path resolves to at this segment.
 *
 * For the path `["farm", "pen", "dog"]`, the seat `farm` holds the farm, the seat `pen` holds the pen of
 * that farm, and the seat `dog` holds the dog of that pen. When the farm gets a new pen, the seats after
 * `farm` walk the path again (rewalk).
 */
export type Seat = {
  readonly segment: string;
  value: Optional<unknown>;
  /** The seats after this seat in the same path. */
  readonly downstream: Set<Seat>;
  /** The seat before this seat, if there is one. */
  upstream: Seat | undefined;
  /** The listeners. The registry calls them when the resolved value of this seat changes. */
  readonly listeners: Set<SeatListener>;
};

/** The identity of a seat in a registry. */
export type SeatId = string;

/** A listener of a seat. */
export type SeatListener = (seat: Seat) => void;

/** This function makes a seat for one segment. */
export const seat = (segment: string): Seat => ({
  segment,
  value: none,
  downstream: new Set(),
  upstream: undefined,
  listeners: new Set(),
});

/** This function links two seats: `up` comes before `down`. */
export const link = (up: Seat, down: Seat): void => {
  up.downstream.add(down);
  down.upstream = up;
};
