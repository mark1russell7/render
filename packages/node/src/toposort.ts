import type { NodeId } from "./node.ts";
import type { NodeStore } from "./ops.ts";
import { readTargets } from "./paths.ts";

/**
 * Kahn's algorithm — topological sort of nodes by dependency order.
 *
 * Dependency edges come from resolving each node's read paths through
 * slots (same walk the seat wiring uses): a reader depends on the path's
 * terminal node AND on every node the path walks through — so a cell
 * node always sorts before a reader of ref(instanceId, cellName), not
 * just before readers of the instance root.
 *
 * Returns node IDs in evaluation order: dependencies before dependents.
 * Nodes involved in cycles are omitted from the result. Edges from
 * roots missing in the store are ignored (dangling refs don't block).
 */
export const toposort = (store: NodeStore): NodeId[] => {
  // Build dependedBy: nodeId -> set of nodes that depend on it
  const dependedBy = new Map<NodeId, Set<NodeId>>();
  for (const [id, n] of store.nodes) {
    if (!dependedBy.has(id)) dependedBy.set(id, new Set());
    for (const path of n.reads) {
      for (const target of readTargets(store, path)) {
        if (target.id === id) continue;
        if (!dependedBy.has(target.id)) dependedBy.set(target.id, new Set());
        dependedBy.get(target.id)!.add(id);
      }
    }
  }

  // Compute in-degree for each node
  const inDegree = new Map<NodeId, number>();
  for (const id of store.nodes.keys()) {
    inDegree.set(id, 0);
  }
  for (const [, deps] of dependedBy) {
    for (const depId of deps) {
      inDegree.set(depId, (inDegree.get(depId) ?? 0) + 1);
    }
  }

  // Seed queue with zero-degree nodes
  const queue: NodeId[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  // BFS by dependency order
  const order: NodeId[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const deps = dependedBy.get(id);
    if (!deps) continue;
    for (const depId of deps) {
      const d = (inDegree.get(depId) ?? 1) - 1;
      inDegree.set(depId, d);
      if (d === 0) queue.push(depId);
    }
  }

  return order;
};
