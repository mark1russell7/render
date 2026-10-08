import type { Optional } from "@render/optional";
import { some, none, isSome } from "@render/optional";
import type { DerefFn, FlowFn, NodeOps, SplashFn } from "./types.ts";
import { valueEquals } from "./equality.ts";

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/**
 * The default write. It keeps the old value when the new result is structurally equal, thus an equal
 * object keeps its old reference. A change from a value to `none`, or from `none` to a value, is a change.
 */
export const defaultSplash: SplashFn = (value, target) => {
  const prev = target.value;
  if (isSome(prev) ? isSome(value) && valueEquals(prev.value, value.value) : !isSome(value)) return false;
  target.value = value;
  return true;
};

/** The default propagation. A change of a node makes its value readers dirty. */
export const defaultFlow: FlowFn = (target) => target.seats;

/**
 * The default resolution. It goes through slots as far as they exist, then through the own fields of the value.
 * A path that ends on a node gives the value of that node. For a container, this value is the record of its slots.
 */
export const defaultDeref: DerefFn = (root, path, store) => {
  let current = root;
  let i = 0;
  while (i < path.length) {
    const slotId = current.slots.get(path[i]!);
    if (slotId === undefined) break;
    const next = store.nodes.get(slotId);
    if (!next) break;
    current = next;
    i++;
  }
  if (!isSome(current.value)) return none;
  let value: unknown = current.value.value;
  for (; i < path.length; i++) {
    const segment = path[i]!;
    if (value === null || typeof value !== "object" || !hasOwn(value, segment)) return none;
    value = (value as Record<string, unknown>)[segment];
  }
  return some(value) as Optional<unknown>;
};

/** The default semantics of a store. */
export const defaultOps: NodeOps = {
  splash: defaultSplash,
  flow: defaultFlow,
  deref: defaultDeref,
};
