import type { Node, NodeId } from "./node.js";
import type { NodeOps, NodeStore } from "./ops.js";
import type { Ops } from "@render/dsl";
import { evaluate } from "@render/dsl";
import { isSome } from "@render/optional";

/**
 * setValue: the fundamental write operation.
 * Sets a node's value via splash, then propagates via flow to fixpoint.
 */
export const setValue = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  targetId: NodeId,
  value: unknown,
): void => {
  const target = store.nodes.get(targetId);
  if (!target) return;

  const affected = nodeOps.splash(value, target, store);

  if (affected.size === 0) {
    // No dependents — just record the single write
    store.epochStats = { evaluated: new Set([targetId]), total: store.nodes.size };
    return;
  }

  // Propagate: flow the affected seats
  flowEpoch(store, nodeOps, dslOps, affected);

  // Include the written node in the epoch stats
  if (store.epochStats) {
    const evaluated = new Set(store.epochStats.evaluated);
    evaluated.add(targetId);
    store.epochStats = { evaluated, total: store.epochStats.total };
  }
};

/**
 * resolve: evaluate a node's expression and set its value.
 * Reads dependencies from the store, evaluates the expr, writes via splash.
 */
export const resolve = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  nodeId: NodeId,
): void => {
  const n = store.nodes.get(nodeId);
  if (!n) return;

  const ctx = buildContext(n, store, nodeOps);
  const result = evaluate(n.expr, ctx, dslOps);
  if (isSome(result)) {
    nodeOps.splash(result.value, n, store);
  }
};

/**
 * fillMany: batch-write multiple values, then flow to fixpoint.
 * All writes happen first, then a single flow epoch propagates.
 * This is the consistency primitive — avoids intermediate states.
 */
export const fillMany = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  writes: ReadonlyMap<NodeId, unknown>,
): void => {
  const allAffected = new Set<NodeId>();

  // Phase 1: all writes
  for (const [targetId, value] of writes) {
    const target = store.nodes.get(targetId);
    if (!target) continue;
    const affected = nodeOps.splash(value, target, store);
    for (const id of affected) allAffected.add(id);
  }

  if (allAffected.size === 0) return;

  // Phase 2: flow to fixpoint
  flowEpoch(store, nodeOps, dslOps, allAffected);
};

/**
 * resolveAll: evaluate all nodes. Simple brute-force —
 * iterates until no more values change (fixpoint).
 */
export const resolveAll = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
): void => {
  let changed = true;
  let iterations = 0;
  const maxIterations = store.nodes.size * 2;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const [, n] of store.nodes) {
      const ctx = buildContext(n, store, nodeOps);
      const result = evaluate(n.expr, ctx, dslOps);
      if (isSome(result)) {
        const prev = n.value;
        if (!isSome(prev) || prev.value !== result.value) {
          n.value = result;
          changed = true;
        }
      }
    }
  }
};

/**
 * Wire seats: for each node, add its id to the seats of every node it reads.
 * Call this after adding nodes to establish the back-links.
 */
export const wireSeats = (store: NodeStore): void => {
  for (const [id, n] of store.nodes) {
    for (const path of n.reads) {
      // The first segment of the path is the root node id
      const rootId = path[0];
      if (rootId === undefined) continue;
      const rootNode = store.nodes.get(rootId);
      if (rootNode) {
        rootNode.seats.add(id);
      }
    }
  }
};

// === Internal ===

/**
 * Flow epoch: given a set of affected node ids (seats that were touched),
 * re-evaluate each, collect new affected seats, repeat to fixpoint.
 */
const flowEpoch = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  frontier: ReadonlySet<NodeId>,
): void => {
  const visited = new Set<NodeId>();
  let current = new Set(frontier);

  while (current.size > 0) {
    const next = new Set<NodeId>();

    for (const nodeId of current) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const n = store.nodes.get(nodeId);
      if (!n) continue;

      // Re-evaluate this node
      const ctx = buildContext(n, store, nodeOps);
      const result = evaluate(n.expr, ctx, dslOps);

      if (isSome(result)) {
        const prev = n.value;
        // Only propagate if value actually changed
        if (!isSome(prev) || prev.value !== result.value) {
          const affected = nodeOps.splash(result.value, n, store);
          for (const id of affected) {
            if (!visited.has(id)) next.add(id);
          }
        }
      }
    }

    current = next;
  }

  store.epochStats = { evaluated: new Set(visited), total: store.nodes.size };
};

/** Build evaluation context for a node from its reads */
const buildContext = (
  n: Node,
  store: NodeStore,
  _nodeOps: NodeOps,
): Record<string, unknown> => {
  const ctx: Record<string, unknown> = {};
  for (const path of n.reads) {
    const rootId = path[0];
    if (rootId === undefined) continue;
    if (rootId in ctx) continue;
    const rootNode = store.nodes.get(rootId);
    if (rootNode) {
      // Build a nested object that deref can walk
      ctx[rootId] = buildNestedValue(rootNode, store);
    }
  }
  return ctx;
};

/** Build a nested object from a node's slots for context resolution */
const buildNestedValue = (
  n: Node,
  store: NodeStore,
): unknown => {
  if (n.slots.size === 0) {
    return isSome(n.value) ? n.value.value : undefined;
  }
  const obj: Record<string, unknown> = {};
  if (isSome(n.value)) {
    Object.assign(obj, typeof n.value.value === "object" && n.value.value !== null ? n.value.value : {});
  }
  for (const [name, slotId] of n.slots) {
    const slotNode = store.nodes.get(slotId);
    if (slotNode) {
      obj[name] = buildNestedValue(slotNode, store);
    }
  }
  return obj;
};
