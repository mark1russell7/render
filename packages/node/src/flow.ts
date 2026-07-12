import type { Node, NodeId } from "./node.js";
import type { NodeOps, NodeStore } from "./ops.js";
import type { Expr, Ops, Resolver } from "@render/dsl";
import { evaluate, deps, lit } from "@render/dsl";
import { none, some, isSome } from "@render/optional";
import { node } from "./node.js";
import { addNode } from "./ops.js";
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
 * setSlot: re-point (or delete) a named slot — the STRUCTURAL write.
 *
 * This is the path semantic ported from @render/seat:
 * every reader whose path walks THROUGH the parent (structural seats)
 * or dead-ended AT it (value seats) rewires — its path may now resolve
 * deeper, shallower, or elsewhere — and re-evaluates, with the change
 * propagating onward through a normal flow epoch (rewalk + notify).
 */
export const setSlot = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  parentId: NodeId,
  name: string,
  childId: NodeId | undefined,
): void => {
  const parent = store.nodes.get(parentId);
  if (!parent) return;

  const previous = parent.slots.get(name);
  if (previous === childId) return;

  if (childId === undefined) {
    parent.slots.delete(name);
  } else {
    parent.slots.set(name, childId);
    const child = store.nodes.get(childId);
    if (child) child.parent = parentId;
  }

  // Readers that traverse or terminate on the parent re-resolve their
  // paths against the new structure...
  const affected = new Set<NodeId>();
  for (const id of parent.seatsStructural) affected.add(id);
  for (const id of parent.seats) affected.add(id);
  for (const id of affected) {
    const reader = store.nodes.get(id);
    if (!reader) continue;
    unwireNode(store, reader);
    wireNode(store, reader);
  }

  // ...and re-evaluate, propagating onward.
  if (affected.size > 0) {
    flowEpoch(store, nodeOps, dslOps, affected);
  } else {
    store.epochStats = { evaluated: new Set(), total: store.nodes.size };
  }
};

/**
 * expandNode: materialize a node's plain-object value as
 * SUB-SLOTS — one child node per field, recursively. Paths that used
 * to dead-end at this node and walk into its value now resolve through
 * real nodes, so leaf edits get leaf-accurate reactivity.
 *
 * After expansion, slots are authoritative: deref merges the base value
 * with slot values (slots shadow fields), so editing a sub-slot is
 * visible to whole-object readers even though the base value object is
 * untouched.
 */
export const expandNode = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  nodeId: NodeId,
): void => {
  const n = store.nodes.get(nodeId);
  if (!n) return;
  const value = isSome(n.value) ? n.value.value : undefined;
  if (value === null || typeof value !== "object") return;

  for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    if (n.slots.has(key)) continue; // already materialized
    const subId = `${nodeId}.${key}`;
    const sub = node(lit(fieldValue), subId);
    sub.parent = nodeId;
    sub.value = some(fieldValue);
    addNode(store, sub);
    n.slots.set(key, subId);
    if (fieldValue !== null && typeof fieldValue === "object") {
      expandNode(store, nodeOps, dslOps, subId);
    }
  }

  // Readers that dead-ended at this node may now resolve deeper — rewalk.
  const affected = new Set<NodeId>([...n.seats, ...n.seatsStructural]);
  for (const id of affected) {
    const reader = store.nodes.get(id);
    if (!reader) continue;
    unwireNode(store, reader);
    wireNode(store, reader);
  }
  if (affected.size > 0) {
    flowEpoch(store, nodeOps, dslOps, affected);
  }
};

/**
 * Remove a node from the store, maintaining seat invariants:
 * - unwire its own reads (it disappears from others' seat sets)
 * - clear it from the reverse index of everyone seated ON it
 * (Readers that referenced it now dangle — they evaluate to none.)
 */
export const removeNode = (store: NodeStore, nodeId: NodeId): void => {
  const n = store.nodes.get(nodeId);
  if (!n) return;
  unwireNode(store, n);
  for (const readerId of n.seats) store.nodes.get(readerId)?.seatedOn.delete(n.id);
  for (const readerId of n.seatsStructural) store.nodes.get(readerId)?.seatedOn.delete(n.id);
  n.seats.clear();
  n.seatsStructural.clear();
  store.nodes.delete(nodeId);
};

/**
 * Ref resolution for node evaluation: path[0] is a node id, the rest
 * resolves through nodeOps.deref (slots first, then value fields).
 * This is the ONE seam between the expression language and the store.
 */
export const storeResolver = (store: NodeStore, nodeOps: NodeOps): Resolver => (path) => {
  const rootId = path[0];
  if (rootId === undefined) return none;
  const root = store.nodes.get(rootId);
  if (!root) return none;
  return nodeOps.deref(root, path.slice(1), store);
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

  const result = evaluate(expr, storeResolver(store, nodeOps), dslOps);
  if (!isSome(result)) {
    // Unresolvable (missing deps) — value untouched, nothing to propagate yet
    store.epochStats = { evaluated: new Set(), total: store.nodes.size };
    return;
  }

  const changed = nodeOps.splash(result.value, target, store);
  if (!changed) {
    // No-op write: empty epoch
    store.epochStats = { evaluated: new Set(), total: store.nodes.size };
    return;
  }

  const frontier = nodeOps.flow(target, store);
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

  const result = evaluate(n.expr, storeResolver(store, nodeOps), dslOps);
  if (!isSome(result)) return false;

  return nodeOps.splash(result.value, n, store);
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
    const changed = nodeOps.splash(value, target, store);
    if (changed) {
      written.add(targetId);
      for (const id of nodeOps.flow(target, store)) allFrontier.add(id);
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
 * Ordered pass (dependencies before dependents), then a convergence
 * loop that covers cycle members and whole-object readers whose
 * materialized value depends on a slot subtree the path-based order
 * can't see. After the ordered pass this typically verifies in a
 * single no-change sweep. Writes go through splash. Safe at any time:
 * values are derived from exprs, so this converges toward consistency,
 * never destroys state.
 */
export const resolveAll = (
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
): void => {
  for (const id of toposort(store)) {
    resolve(store, nodeOps, dslOps, id);
  }

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
 * The affected closure (forward reachability from the frontier via
 * nodeOps.flow) is evaluated in TOPOLOGICAL order — every node sees
 * fully-settled upstream values, so uneven diamond shapes cannot
 * produce stale reads (each node evaluates at most once per epoch).
 * Nodes are skipped unless something upstream of them actually changed
 * (pruning). Cycle members are appended after the ordered part
 * and evaluated once.
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
      s = nodeOps.flow(n, store);
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
  const resolver = storeResolver(store, nodeOps);
  const dirty = new Set<NodeId>(frontier);
  const evaluated = new Set<NodeId>();
  for (const id of order) {
    if (!dirty.has(id)) continue;
    const n = store.nodes.get(id);
    if (!n) continue;
    evaluated.add(id);

    const result = evaluate(n.expr, resolver, dslOps);
    if (!isSome(result)) continue;

    if (nodeOps.splash(result.value, n, store)) {
      for (const r of succOf(n)) dirty.add(r);
    }
  }

  store.epochStats = { evaluated, total: store.nodes.size };
};
