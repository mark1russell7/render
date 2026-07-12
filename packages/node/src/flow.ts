import type { Node, NodeId } from "./node.js";
import type { NodeOps, NodeStore } from "./ops.js";
import type { Expr, Ops } from "@render/dsl";
import { evaluate, deps, lit } from "@render/dsl";
import { isSome } from "@render/optional";
import { valueEquals } from "./equality.js";
import { readTargets } from "./paths.js";
import { toposort } from "./toposort.js";

/**
 * Wire one node: resolve each read path through slots and seat this node
 * - on the path's TERMINAL node as a value dependent (seats), and
 * - on every walked-through node as a structural dependent (seatsStructural).
 * The reverse index (seatedOn) records every placement for cheap unwiring.
 */
export const wireNode = (store: NodeStore, n: Node): void => {
  for (const path of n.reads) {
    const targets = readTargets(store, path);
    if (targets.length === 0) continue;
    const terminal = targets[targets.length - 1]!;
    for (let i = 0; i < targets.length - 1; i++) {
      const t = targets[i]!;
      if (t.id === n.id) continue;
      t.seatsStructural.add(n.id);
      n.seatedOn.add(t.id);
    }
    if (terminal.id !== n.id) {
      terminal.seats.add(n.id);
      n.seatedOn.add(terminal.id);
    }
  }
};

/** Unwire one node from everything it is seated on (value + structural). */
export const unwireNode = (store: NodeStore, n: Node): void => {
  for (const otherId of n.seatedOn) {
    const other = store.nodes.get(otherId);
    if (other) {
      other.seats.delete(n.id);
      other.seatsStructural.delete(n.id);
    }
  }
  n.seatedOn.clear();
};

/**
 * (Re)wire seats for every node in the store. Unwires first, so paths
 * that can now resolve deeper (structure grew) re-seat precisely.
 */
export const wireSeats = (store: NodeStore): void => {
  for (const [, n] of store.nodes) unwireNode(store, n);
  for (const [, n] of store.nodes) wireNode(store, n);
};

/**
 * The frontier a change to `n` dirties: n's own value dependents, plus
 * the value dependents of every slot-ancestor (whole-object readers of
 * an ancestor see a different materialized object when a descendant
 * changes).
 */
const frontierFor = (store: NodeStore, n: Node): Set<NodeId> => {
  const out = new Set<NodeId>(n.seats);
  let current = n;
  const guard = new Set<NodeId>([n.id]);
  while (current.parent !== undefined && !guard.has(current.parent)) {
    guard.add(current.parent);
    const p = store.nodes.get(current.parent);
    if (!p) break;
    for (const id of p.seats) out.add(id);
    current = p;
  }
  out.delete(n.id);
  return out;
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
  const changed = !isSome(prev) || !valueEquals(prev.value, result.value);
  nodeOps.splash(result.value, target, store);

  if (!changed) {
    // No-op write: empty epoch
    store.epochStats = { evaluated: new Set(), total: store.nodes.size };
    return;
  }

  const frontier = frontierFor(store, target);
  if (frontier.size === 0) {
    store.epochStats = { evaluated: new Set([targetId]), total: store.nodes.size };
    return;
  }

  flowEpoch(store, nodeOps, dslOps, frontier);

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
  const changed = !isSome(prev) || !valueEquals(prev.value, result.value);
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
  const allFrontier = new Set<NodeId>();
  const written = new Set<NodeId>();

  // Phase 1: all writes (expr rewrites, same semantics as setValue)
  for (const [targetId, value] of writes) {
    const target = store.nodes.get(targetId);
    if (!target) continue;
    unwireNode(store, target);
    target.expr = lit(value);
    target.reads = [];
    const prev = target.value;
    const changed = !isSome(prev) || !valueEquals(prev.value, value);
    nodeOps.splash(value, target, store);
    if (changed) {
      written.add(targetId);
      for (const id of frontierFor(store, target)) allFrontier.add(id);
    }
  }
  for (const id of written) allFrontier.delete(id);

  // Phase 2: flow to fixpoint
  if (allFrontier.size > 0) {
    flowEpoch(store, nodeOps, dslOps, allFrontier);
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
 * resolveAll: bring every node's value in line with its expr.
 *
 * Single topologically-ordered pass (dependencies before dependents);
 * nodes toposort omits (cycle members) get a bounded iterative fallback.
 * Writes go through splash. Safe at any time: values are derived from
 * exprs, so this converges toward consistency, never destroys state.
 */
export const resolveAll = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
): void => {
  // Ordered pass: dependencies before dependents
  for (const id of toposort(store)) {
    resolve(store, nodeOps, dslOps, id);
  }

  // Convergence loop: covers cycle members (omitted from the order) and
  // whole-object readers whose materialized value depends on a slot
  // SUBTREE the path-based order can't see. After the ordered pass this
  // typically verifies in a single no-change sweep.
  let changed = true;
  let iterations = 0;
  const maxIterations = store.nodes.size * 2;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const id of store.nodes.keys()) {
      if (resolve(store, nodeOps, dslOps, id)) changed = true;
    }
  }
};

// === Internal ===

/**
 * Flow epoch: propagate a change through the graph.
 *
 * The affected closure (forward reachability from the frontier) is
 * evaluated in TOPOLOGICAL order — every node sees fully-settled
 * upstream values, so uneven diamond shapes cannot produce stale reads
 * (each node evaluates at most once per epoch). Nodes are skipped
 * unless something upstream of them actually changed (pruning).
 * Cycle members are appended after the ordered part and evaluated once.
 */
const flowEpoch = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  frontier: ReadonlySet<NodeId>,
): void => {
  // Per-epoch memo of each node's dirty-successor set
  const successors = new Map<NodeId, ReadonlySet<NodeId>>();
  const succOf = (n: Node): ReadonlySet<NodeId> => {
    let s = successors.get(n.id);
    if (!s) {
      s = frontierFor(store, n);
      successors.set(n.id, s);
    }
    return s;
  };

  // 1. Affected closure: forward reachability from the frontier
  const closure = new Set<NodeId>();
  const queue: NodeId[] = [...frontier];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (closure.has(id)) continue;
    const n = store.nodes.get(id);
    if (!n) continue; // ghost id (stale seat)
    closure.add(id);
    for (const r of succOf(n)) if (!closure.has(r)) queue.push(r);
  }

  // 2. Topological order of the closure subgraph
  const inDegree = new Map<NodeId, number>();
  for (const id of closure) inDegree.set(id, 0);
  for (const id of closure) {
    const n = store.nodes.get(id)!;
    for (const r of succOf(n)) {
      if (closure.has(r)) inDegree.set(r, (inDegree.get(r) ?? 0) + 1);
    }
  }
  const order: NodeId[] = [];
  const ready: NodeId[] = [];
  for (const [id, d] of inDegree) if (d === 0) ready.push(id);
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    const n = store.nodes.get(id)!;
    for (const r of succOf(n)) {
      if (!closure.has(r)) continue;
      const d = (inDegree.get(r) ?? 1) - 1;
      inDegree.set(r, d);
      if (d === 0) ready.push(r);
    }
  }
  if (order.length < closure.size) {
    const placed = new Set(order);
    for (const id of closure) if (!placed.has(id)) order.push(id);
  }

  // 3. Evaluate in order; only nodes something upstream actually dirtied
  const dirty = new Set<NodeId>(frontier);
  const evaluated = new Set<NodeId>();
  for (const id of order) {
    if (!dirty.has(id)) continue;
    const n = store.nodes.get(id);
    if (!n) continue;
    evaluated.add(id);

    const ctx = buildContext(n, store, nodeOps);
    const result = evaluate(n.expr, ctx, dslOps);
    if (!isSome(result)) continue;

    const prev = n.value;
    if (!isSome(prev) || !valueEquals(prev.value, result.value)) {
      nodeOps.splash(result.value, n, store);
      for (const r of succOf(n)) dirty.add(r);
    }
  }

  store.epochStats = { evaluated, total: store.nodes.size };
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
      // Build a nested object that ref resolution can walk
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
