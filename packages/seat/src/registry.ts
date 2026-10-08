import type { SeatPath } from "./path.ts";
import type { SeatListener } from "./seat.ts";
import type { Optional } from "@render/optional";
import { seatPath, resolve, rewalk } from "./path.ts";

/**
 * A seat registry holds the active seat paths and their root value.
 * When the root or a value inside it changes, the paths through the change walk again.
 */
export type SeatRegistry = {
  root: unknown;
  readonly paths: Map<string, SeatPath>;
};

/** The JSON form of the segments is a key without ambiguity. */
const keyOf = (segments: readonly string[]): string => JSON.stringify(segments);

/** This function makes a registry with a root value. */
export const registry = (root: unknown): SeatRegistry => ({
  root,
  paths: new Map(),
});

/** This function registers a path and resolves it against the root. A second registration gives the same path. */
export const register = (reg: SeatRegistry, segments: readonly string[]): SeatPath => {
  const key = keyOf(segments);
  const existing = reg.paths.get(key);
  if (existing) return existing;
  const path = seatPath(segments);
  resolve(path, reg.root);
  reg.paths.set(key, path);
  return path;
};

/** This function adds a listener of the resolved value of a path. */
export const subscribe = (reg: SeatRegistry, segments: readonly string[], listener: SeatListener): SeatPath => {
  const path = register(reg, segments);
  path.tail.listeners.add(listener);
  return path;
};

/** This function removes a listener of a path. */
export const unsubscribe = (path: SeatPath, listener: SeatListener): void => {
  path.tail.listeners.delete(listener);
};

/** This function gives the current resolved value of a path. It does not register the path. */
export const peek = (reg: SeatRegistry, segments: readonly string[]): Optional<unknown> => {
  const path = reg.paths.get(keyOf(segments));
  return path ? path.tail.value : resolve(seatPath(segments), reg.root);
};

/**
 * This function tells the registry that the value at a path changed. Each registered path that goes
 * through that point walks again from it. An empty path means that the root changed.
 */
export const touch = (reg: SeatRegistry, changedPath: readonly string[]): void => {
  for (const path of reg.paths.values()) {
    if (changedPath.length > path.segments.length) continue;
    let matches = true;
    for (let i = 0; i < changedPath.length; i++) {
      if (path.segments[i] !== changedPath[i]) {
        matches = false;
        break;
      }
    }
    if (matches) rewalk(path, changedPath.length - 1, reg.root);
  }
};

/** This function replaces the root value, and each path walks again. */
export const setRoot = (reg: SeatRegistry, root: unknown): void => {
  reg.root = root;
  for (const path of reg.paths.values()) rewalk(path, 0, root);
};
