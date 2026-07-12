import type { Node, NodeId } from "./node.js";
import type { Optional } from "@render/optional";
import { some, none, isSome } from "@render/optional";
import { valueEquals } from "./equality.js";

/**
 * Pluggable operations — the reactive semantics of the store.
 *
 * The engine (flow.ts) consults these for every write, frontier
 * computation, and ref resolution, so overriding them actually changes
 * behavior. Layer them: engine defaults here, per-class methods via
 * biblo's classNodeOps, custom systems beneath or above.
 */
export type NodeOps = {
  /** Write a value to a node. Returns true if the value changed. */
  readonly splash: SplashFn;
  /** Given a node whose value just changed, which nodes are dirtied? */
  readonly flow: FlowFn;
  /** Resolve a path starting from a node (slots first, then value fields). */
  readonly deref: DerefFn;
};

export type SplashFn = (value: unknown, target: Node, store: NodeStore) => boolean;
export type FlowFn = (target: Node, store: NodeStore) => Set<NodeId>;
export type DerefFn = (root: Node, path: readonly string[], store: NodeStore) => Optional<unknown>;

/** Stats from the last flowEpoch — which nodes were re-evaluated */
export type EpochStats = {
  readonly evaluated: ReadonlySet<NodeId>;
  readonly total: number;
};

/** The node store — all nodes keyed by id */
export type NodeStore = {
  readonly nodes: Map<NodeId, Node>;
  epochStats: EpochStats | null;
};

export const nodeStore = (): NodeStore => ({
  nodes: new Map(),
  epochStats: null,
});

export const addNode = (store: NodeStore, n: Node): void => {
  store.nodes.set(n.id, n);
};

export const getNode = (store: NodeStore, id: NodeId): Node | undefined =>
  store.nodes.get(id);

// === Default operations ===

/**
 * Default splash: write the value if it differs from the current one
 * (structural equality — an equal value keeps the old reference) and
 * report whether anything changed.
 */
export const defaultSplash: SplashFn = (value, target, _store) => {
  const prev = target.value;
  if (isSome(prev) && valueEquals(prev.value, value)) {
    return false;
  }
  target.value = some(value);
  return true;
};

/**
 * Default flow: the frontier a change to `target` dirties — its own
 * value dependents (seats), plus the value dependents of every
 * slot-ancestor. Whole-object readers of an ancestor see a different
 * materialized object when a descendant slot's value changes.
 */
export const defaultFlow: FlowFn = (target, store) => {
  const out = new Set<NodeId>(target.seats);
  let current = target;
  const guard = new Set<NodeId>([target.id]);
  while (current.parent !== undefined && !guard.has(current.parent)) {
    guard.add(current.parent);
    const p = store.nodes.get(current.parent);
    if (!p) break;
    for (const id of p.seats) out.add(id);
    current = p;
  }
  out.delete(target.id);
  return out;
};

/**
 * Materialize a node's subtree as a plain object: the node's own object
 * value (if any) with slot values layered on top (slots shadow fields).
 * Used only when a path terminates ON a slotted node — not for building
 * whole evaluation contexts.
 */
export const materializeNode = (n: Node, store: NodeStore): unknown => {
  if (n.slots.size === 0) {
    return isSome(n.value) ? n.value.value : undefined;
  }
  const obj: Record<string, unknown> = {};
  if (isSome(n.value) && typeof n.value.value === "object" && n.value.value !== null) {
    Object.assign(obj, n.value.value);
  }
  for (const [name, slotId] of n.slots) {
    const slotNode = store.nodes.get(slotId);
    if (slotNode) {
      obj[name] = materializeNode(slotNode, store);
    }
  }
  return obj;
};

/**
 * Default deref: walk slots as far as they exist, then continue through
 * plain value fields. A path terminating on a slotted node materializes
 * that node's subtree (whole-object read).
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

  if (i === path.length) {
    // Path terminates on a node
    if (current.slots.size > 0) return some(materializeNode(current, store));
    return current.value;
  }

  // Remaining segments walk into the node's value (plain data)
  let value: unknown;
  if (current.slots.size > 0) {
    value = materializeNode(current, store);
  } else if (isSome(current.value)) {
    value = current.value.value;
  } else {
    return none;
  }

  for (; i < path.length; i++) {
    if (value == null || typeof value !== "object") return none;
    const obj = value as Record<string, unknown>;
    const segment = path[i]!;
    if (!(segment in obj)) return none;
    value = obj[segment];
  }
  return some(value);
};

/** Default ops bundle */
export const defaultOps: NodeOps = {
  splash: defaultSplash,
  flow: defaultFlow,
  deref: defaultDeref,
};
