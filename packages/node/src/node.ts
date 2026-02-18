import type { Expr, DepPath } from "@render/dsl";
import type { Optional } from "@render/optional";
import { none } from "@render/optional";
import { deps } from "@render/dsl";

export type NodeId = string;

/**
 * A Node is the unified reactive primitive.
 *
 * It IS a reactive variable (value + expression).
 * It IS a seat (back-links: who references me).
 * It IS a graph node (flow propagates through seats).
 *
 * setValue maintains seats automatically.
 * Flow follows seats to fixpoint — no separate scheduler needed.
 */
export type Node = {
  readonly id: NodeId;
  /** The expression that computes this node's value */
  readonly expr: Expr;
  /** Current resolved value */
  value: Optional<unknown>;
  /** Paths this node reads (extracted from expr) */
  readonly reads: readonly DepPath[];
  /** Back-links: nodes that hold a reference to this node's value */
  readonly seats: Set<NodeId>;
  /** Named slots (child nodes owned by this node) */
  readonly slots: Map<string, NodeId>;
};

let nextId = 0;

export const generateNodeId = (): NodeId => `n_${String(nextId++)}`;

export const node = (expr: Expr, id?: NodeId): Node => {
  const nid = id ?? generateNodeId();
  return {
    id: nid,
    expr,
    value: none,
    reads: deps(expr),
    seats: new Set(),
    slots: new Map(),
  };
};
