import type { NodeId } from "./node.js";
import type { NodeStore } from "./ops.js";

/**
 * Kahn's algorithm — topological sort of nodes by dependency order.
 *
 * Uses each node's `reads` (first segment = dependency root) to build
 * a reverse-edge map (dependedBy), then sorts by in-degree.
 *
 * Returns node IDs in evaluation order: dependencies before dependents.
 * Nodes involved in cycles are omitted from the result.
 */
export const toposort = (store: NodeStore): NodeId[] => {
  // Build dependedBy: nodeId -> set of nodes that depend on it
  const dependedBy = new Map<NodeId, Set<NodeId>>();
  for (const [id, n] of store.nodes) {
    if (!dependedBy.has(id)) dependedBy.set(id, new Set());
    for (const path of n.reads) {
      const root = path[0];
      // Skip self-edges and dangling roots — an edge from a node that isn't
      // in the store would add in-degree that never gets decremented,
      // silently dropping the reader from the order as if it were cyclic.
      if (root === undefined || root === id || !store.nodes.has(root)) continue;
      if (!dependedBy.has(root)) dependedBy.set(root, new Set());
      dependedBy.get(root)!.add(id);
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
