import { some, none, isSome } from "@render/optional";
import type { DerefFn, FlowFn, Node, NodeOps, SplashFn, TargetsFn } from "./types.ts";
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
 * A path that stops at a container before its end reads a missing slot, thus it gives `none`.
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
  if (i < path.length && current.slots.size > 0) return none;
  if (!isSome(current.value)) return none;
  let value: unknown = current.value.value;
  for (; i < path.length; i++) {
    const segment = path[i]!;
    if (value === null || typeof value !== "object" || !hasOwn(value, segment)) return none;
    value = (value as Record<string, unknown>)[segment];
  }
  return some(value);
};

/**
 * The default dependencies of a path, which agree with `defaultDeref`. The nodes that the path goes through are
 * structural targets, and the node where it ends is the terminal. A path that stops at a container before its end
 * reads a missing slot: it has no terminal, and the container is a structural target.
 */
export const defaultTargets: TargetsFn = (root, path, store) => {
  const through: Node[] = [];
  let current = root;
  let i = 0;
  for (; i < path.length; i++) {
    const slotId = current.slots.get(path[i]!);
    const next = slotId === undefined ? undefined : store.nodes.get(slotId);
    if (!next) break;
    through.push(current);
    current = next;
  }
  if (i < path.length && current.slots.size > 0) return { through: [...through, current], terminal: undefined };
  return { through, terminal: current };
};

/** The default semantics of a store. */
export const defaultOps: NodeOps = {
  splash: defaultSplash,
  flow: defaultFlow,
  deref: defaultDeref,
  targets: defaultTargets,
};
