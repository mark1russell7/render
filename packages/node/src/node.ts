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
  /**
   * The expression that computes this node's value — THE source of truth.
   * Writes (setValue/setExpr) rewrite it; evaluation derives value from it.
   * expr and value can never durably disagree.
   */
  expr: Expr;
  /** Current resolved value (a cache of evaluating expr) */
  value: Optional<unknown>;
  /** Paths this node reads (derived from expr; kept in sync by setExpr) */
  reads: readonly DepPath[];
  /** Value back-links: nodes whose read paths TERMINATE here — they must
   * re-evaluate when this node's value changes */
  readonly seats: Set<NodeId>;
  /** Structural back-links: nodes whose read paths WALK THROUGH here —
   * they must re-resolve/rewire when this node's slots change */
  readonly seatsStructural: Set<NodeId>;
  /** Reverse index: every node this node is currently seated on
   * (value or structural) — makes unwiring O(own wires) */
  readonly seatedOn: Set<NodeId>;
  /** Slot parent: the node that owns this node as a slot (if any).
   * Changed values bubble to ancestors' seats — a whole-object reader
   * of an ancestor sees a different materialized object when a
   * descendant slot changes. */
  parent: NodeId | undefined;
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
    seatsStructural: new Set(),
    seatedOn: new Set(),
    parent: undefined,
    slots: new Map(),
  };
};
