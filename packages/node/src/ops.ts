import type { Node, NodeId } from "./node.js";
import type { Optional } from "@render/optional";
import { some, isSome } from "@render/optional";

/**
 * Pluggable operations — the simple system uses defaults.
 * A future layer can override them.
 */
export type NodeOps = {
  /** Write a value to a node, maintain seats, return affected seat ids */
  readonly splash: SplashFn;
  /** Given a node that was just written, determine which nodes to flow next */
  readonly flow: FlowFn;
  /** Resolve a path starting from a node */
  readonly deref: DerefFn;
};

export type SplashFn = (value: unknown, target: Node, store: NodeStore) => Set<NodeId>;
export type FlowFn = (node: Node, filled: ReadonlySet<NodeId>, store: NodeStore) => Set<NodeId>;
export type DerefFn = (root: Node, path: readonly string[], store: NodeStore) => Optional<unknown>;

/** The node store — all nodes keyed by id */
export type NodeStore = {
  readonly nodes: Map<NodeId, Node>;
};

export const nodeStore = (): NodeStore => ({
  nodes: new Map(),
});

export const addNode = (store: NodeStore, n: Node): void => {
  store.nodes.set(n.id, n);
};

export const getNode = (store: NodeStore, id: NodeId): Node | undefined =>
  store.nodes.get(id);

// === Default operations (simple system) ===

/**
 * Default splash: set value, maintain seats, return seats.
 *
 * When a node's value changes:
 * 1. Remove this node from old value's seats (if old value was a node)
 * 2. Write the new value
 * 3. Add this node to new value's seats (if new value is a node)
 * 4. Return this node's seats — they need to re-flow
 */
export const defaultSplash: SplashFn = (value, target, _store) => {
  const prev = target.value;

  // Skip if value hasn't changed
  if (isSome(prev) && isSome(some(value)) && prev.value === value) {
    return new Set();
  }

  target.value = some(value);

  // Return seats — nodes referencing this node need to re-evaluate
  return new Set(target.seats);
};

/**
 * Default flow: collect form-shape pairs from the node's expression,
 * return seats of affected nodes.
 */
export const defaultFlow: FlowFn = (n, _filled, _store) => {
  // The node's seats are the frontier for the next epoch
  return new Set(n.seats);
};

/**
 * Default deref: walk slots by path segments.
 */
export const defaultDeref: DerefFn = (root, path, store) => {
  let current: Node | undefined = root;
  for (const segment of path) {
    if (!current) return { tag: "none" };
    const slotId = current.slots.get(segment);
    if (slotId === undefined) return { tag: "none" };
    current = store.nodes.get(slotId);
  }
  return current ? current.value : { tag: "none" };
};

/** Default ops bundle */
export const defaultOps: NodeOps = {
  splash: defaultSplash,
  flow: defaultFlow,
  deref: defaultDeref,
};
