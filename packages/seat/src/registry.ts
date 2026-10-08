import type { SeatPath } from "./path.ts";
import type { SeatListener } from "./seat.ts";
import type { Optional } from "@render/optional";
import { seatPath, resolve, rewalk } from "./path.ts";

/**
 * A SeatRegistry manages all active seat paths and their root value.
 * When the root or any intermediate value changes, affected paths rewalk.
 */
export type SeatRegistry = {
  root: unknown;
  readonly paths: Map<string, SeatPath>;
};

/** Create a registry with an initial root value */
export const registry = (root: unknown): SeatRegistry => ({
  root,
  paths: new Map(),
});

/** Register a path and resolve it against the current root */
export const register = (reg: SeatRegistry, segments: readonly string[]): SeatPath => {
  const key = segments.join("\0");
  const existing = reg.paths.get(key);
  if (existing) return existing;

  const path = seatPath(segments);
  resolve(path, reg.root);
  reg.paths.set(key, path);
  return path;
};

/** Subscribe to a path's resolved value changes */
export const subscribe = (reg: SeatRegistry, segments: readonly string[], listener: SeatListener): SeatPath => {
  const path = register(reg, segments);
  path.tail.listeners.add(listener);
  return path;
};

/** Unsubscribe from a path */
export const unsubscribe = (path: SeatPath, listener: SeatListener): void => {
  path.tail.listeners.delete(listener);
};

/** Get the current resolved value of a path */
export const peek = (reg: SeatRegistry, segments: readonly string[]): Optional<unknown> => {
  const key = segments.join("\0");
  const path = reg.paths.get(key);
  if (!path) return resolve(seatPath(segments), reg.root);
  return path.tail.value;
};

/**
 * Notify the registry that a value at a specific path has changed.
 * All paths that pass through this point will rewalk from there.
 */
export const touch = (reg: SeatRegistry, changedPath: readonly string[]): void => {
  for (const path of reg.paths.values()) {
    // Check if this path passes through the changed path
    if (changedPath.length > path.segments.length) continue;
    let matches = true;
    for (let i = 0; i < changedPath.length; i++) {
      if (path.segments[i] !== changedPath[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      rewalk(path, changedPath.length - 1, reg.root);
    }
  }
};

/** Replace the root value entirely and rewalk all paths */
export const setRoot = (reg: SeatRegistry, root: unknown): void => {
  reg.root = root;
  for (const path of reg.paths.values()) {
    rewalk(path, 0, root);
  }
};
