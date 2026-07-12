import type { DepPath } from "@render/dsl";
import type { Node } from "./node.js";
import type { NodeStore } from "./ops.js";

/**
 * Resolve a read path to the chain of nodes it walks through.
 *
 * Starting at the root (path[0], a node id), follow slots segment by
 * segment as far as slots exist. The LAST node in the result is the
 * terminal — the node whose VALUE the path reads (any remaining path
 * segments continue into that value's plain-object fields). All earlier
 * nodes are the structural prefix the path walks through.
 *
 * Returns [] when the root is not in the store (dangling ref).
 */
export const readTargets = (store: NodeStore, path: DepPath): Node[] => {
  const rootId = path[0];
  if (rootId === undefined) return [];
  const root = store.nodes.get(rootId);
  if (!root) return [];

  const out: Node[] = [root];
  let current = root;
  for (let i = 1; i < path.length; i++) {
    const segment = path[i]!;
    const slotId = current.slots.get(segment);
    if (slotId === undefined) break;
    const next = store.nodes.get(slotId);
    if (!next) break;
    current = next;
    out.push(current);
  }
  return out;
};
