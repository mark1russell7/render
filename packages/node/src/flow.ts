import type { Node, NodeId } from "./node.js";
import type { NodeOps, NodeStore } from "./ops.js";
import type { Expr, Ops } from "@render/dsl";
import { evaluate, deps, lit } from "@render/dsl";
import { isSome } from "@render/optional";

/**
 * Wire one node: add it to the seats of every node its reads target.
 * (Seat granularity: the read path's root node.)
 */
export const wireNode = (store: NodeStore, n: Node): void => {
  for (const path of n.reads) {
    const rootId = path[0];
    if (rootId === undefined) continue;
    const rootNode = store.nodes.get(rootId);
    if (rootNode) rootNode.seats.add(n.id);
  }
};

/** Unwire one node: remove it from the seats its reads had it on. */
export const unwireNode = (store: NodeStore, n: Node): void => {
  for (const path of n.reads) {
    const rootId = path[0];
    if (rootId === undefined) continue;
    store.nodes.get(rootId)?.seats.delete(n.id);
  }
};

/**
 * Wire seats for every node in the store.
 * Idempotent (seats are sets); call after bulk node creation.
 */
export const wireSeats = (store: NodeStore): void => {
  for (const [, n] of store.nodes) wireNode(store, n);
};

/**
 * setExpr: the fundamental write operation.
 *
 * Rewrites the node's expression (the source of truth), rewires its
 * read seats, re-evaluates it, and propagates to fixpoint. Because the
 * expr itself changes, later re-resolution (resolveAll, epochs) can
 * never revert the write.
 */
export const setExpr = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  targetId: NodeId,
  expr: Expr,
): void => {
  const target = store.nodes.get(targetId);
  if (!target) return;

  unwireNode(store, target);
  target.expr = expr;
  target.reads = deps(expr);
  wireNode(store, target);

  const ctx = buildContext(target, store, nodeOps);
  const result = evaluate(expr, ctx, dslOps);
  if (!isSome(result)) {
    // Unresolvable (missing deps) — value untouched, nothing to propagate yet
    store.epochStats = { evaluated: new Set(), total: store.nodes.size };
    return;
  }

  const prev = target.value;
  const changed = !isSome(prev) || prev.value !== result.value;
  const affected = nodeOps.splash(result.value, target, store);

  if (!changed) {
    // No-op write: empty epoch
    store.epochStats = { evaluated: new Set(), total: store.nodes.size };
    return;
  }

  if (affected.size === 0) {
    store.epochStats = { evaluated: new Set([targetId]), total: store.nodes.size };
    return;
  }

  flowEpoch(store, nodeOps, dslOps, affected);

  // Include the written node in the epoch stats
  if (store.epochStats) {
    const evaluated = new Set(store.epochStats.evaluated);
    evaluated.add(targetId);
    store.epochStats = { evaluated, total: store.epochStats.total };
  }
};

/**
 * setValue: write a literal value — shorthand for setExpr(lit(value)).
 * Writing to a derived node converts it to an input node (AD-2):
 * the editor semantic of typing over a computed cell.
 */
export const setValue = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  targetId: NodeId,
  value: unknown,
): void => {
  setExpr(store, nodeOps, dslOps, targetId, lit(value));
};

/**
 * resolve: evaluate a node's expression and set its value via splash.
 * Returns true if the value changed.
 * Does NOT propagate to dependents — use setValue/setExpr/flowEpoch for that.
 */
export const resolve = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  nodeId: NodeId,
): boolean => {
  const n = store.nodes.get(nodeId);
  if (!n) return false;

  const ctx = buildContext(n, store, nodeOps);
  const result = evaluate(n.expr, ctx, dslOps);
  if (!isSome(result)) return false;

  const prev = n.value;
  const changed = !isSome(prev) || prev.value !== result.value;
  nodeOps.splash(result.value, n, store);
  return changed;
};

/**
 * fillMany: batch-write multiple values, then flow to fixpoint.
 * All writes happen first (each rewrites its node's expr, like setValue),
 * then a single flow epoch propagates. This is the consistency primitive.
 */
export const fillMany = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  writes: ReadonlyMap<NodeId, unknown>,
): void => {
  const allAffected = new Set<NodeId>();
  const written = new Set<NodeId>();

  // Phase 1: all writes (expr rewrites, same semantics as setValue)
  for (const [targetId, value] of writes) {
    const target = store.nodes.get(targetId);
    if (!target) continue;
    unwireNode(store, target);
    target.expr = lit(value);
    target.reads = [];
    const prev = target.value;
    const changed = !isSome(prev) || prev.value !== value;
    const affected = nodeOps.splash(value, target, store);
    if (changed) written.add(targetId);
    for (const id of affected) allAffected.add(id);
  }

  // Phase 2: flow to fixpoint
  if (allAffected.size > 0) {
    flowEpoch(store, nodeOps, dslOps, allAffected);
  } else {
    store.epochStats = { evaluated: new Set(), total: store.nodes.size };
  }

  // Written nodes count as part of the epoch
  if (store.epochStats) {
    const evaluated = new Set(store.epochStats.evaluated);
    for (const id of written) evaluated.add(id);
    store.epochStats = { evaluated, total: store.nodes.size };
  }
};

/**
 * resolveAll: evaluate all nodes to fixpoint. Writes go through splash.
 * Safe to call at any time: every node's value is derived from its expr,
 * so this can only converge toward consistency, never destroy state.
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
          nodeOps.splash(result.value, n, store);
          changed = true;
        }
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

      const n = store.nodes.get(nodeId);
      if (!n) continue; // ghost id (stale seat) — not part of the epoch
      visited.add(nodeId);

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
  if (isSome(n.value) && typeof n.value.value === "object" && n.value.value !== null) {
    Object.assign(obj, n.value.value);
  }
  for (const [name, slotId] of n.slots) {
    const slotNode = store.nodes.get(slotId);
    if (slotNode) {
      obj[name] = buildNestedValue(slotNode, store);
    }
  }
  return obj;
};
