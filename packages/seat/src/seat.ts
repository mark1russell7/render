import type { Optional } from "@render/optional";
import { none } from "@render/optional";

/**
 * A Seat is one segment in a path chain.
 * It points to its current value, and the value back-points to all seats referencing it.
 *
 * Example: path ["farm", "pen", "dog"]
 *   Seat("farm") → value: Farm1
 *   Seat("pen")  → value: Pen1   (resolved through Farm1)
 *   Seat("dog")  → value: Dog1   (resolved through Pen1)
 *
 * When Farm1.pen changes from Pen1 to Pen2, seats downstream of "pen" rewalk.
 */

export type SeatId = string;

export type Seat = {
  readonly segment: string;
  value: Optional<unknown>;
  /** Seats downstream of this one in the same path */
  readonly downstream: Set<Seat>;
  /** The seat upstream of this one (if any) */
  upstream: Seat | undefined;
  /** Listeners notified when this seat's resolved value changes */
  readonly listeners: Set<SeatListener>;
};

export type SeatListener = (seat: Seat) => void;

export const seat = (segment: string): Seat => ({
  segment,
  value: none,
  downstream: new Set(),
  upstream: undefined,
  listeners: new Set(),
});

/** Link two seats: upstream → downstream */
export const link = (up: Seat, down: Seat): void => {
  up.downstream.add(down);
  down.upstream = up;
};
