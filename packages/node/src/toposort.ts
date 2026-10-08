import type { NodeId, NodeStore } from "./types.ts";
import { readTargets } from "./engine.ts";

/**
 * This function sorts the nodes of a store by their static dependencies (Kahn's algorithm).
 *
 * The edges come from the read paths of each node, resolved through slots like the seat wiring: a reader
 * depends on the terminal of each path and on each node that the path goes through. A path to a node that
 * is not in the store adds no edge. The result has the dependencies before their readers. A node on a cycle
 * is not in the result. The epochs of the engine use the edges of `flow` instead, and this function is a
 * tool for analysis.
 */
export const toposort = (store: NodeStore): NodeId[] => {
  const dependedBy = new Map<NodeId, Set<NodeId>>();
  const inDegree = new Map<NodeId, number>();
  for (const id of store.nodes.keys()) {
    dependedBy.set(id, new Set());
    inDegree.set(id, 0);
  }
  for (const [id, n] of store.nodes) {
    for (const path of n.reads) {
      for (const target of readTargets(store.nodes, path)) {
        const readers = dependedBy.get(target.id)!;
        if (target.id === id || readers.has(id)) continue;
        readers.add(id);
        inDegree.set(id, inDegree.get(id)! + 1);
      }
    }
  }

  const order: NodeId[] = [];
  for (const [id, d] of inDegree) if (d === 0) order.push(id);
  for (let head = 0; head < order.length; head++) {
    for (const readerId of dependedBy.get(order[head]!)!) {
      const d = inDegree.get(readerId)! - 1;
      inDegree.set(readerId, d);
      if (d === 0) order.push(readerId);
    }
  }
  return order;
};
