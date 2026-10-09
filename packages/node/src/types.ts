import type { DepPath, Expr, Ops } from "@render/dsl";
import type { Optional } from "@render/optional";

/** The identity of a node in its store. */
export type NodeId = string;

/**
 * A node is the reactive primitive. It is a reactive variable (an expression and its value),
 * a seat (it knows its readers) and a container of named slots.
 *
 * Only the engine changes a node. The one exception is `value`, which the `splash` op writes.
 */
export type Node = {
  readonly id: NodeId;
  /**
   * The expression is the source of truth. The value is a cache of its evaluation.
   * A write changes the expression, thus a later evaluation cannot revert the write.
   */
  readonly expr: Expr;
  /** The value of the expression after the last epoch. `none` is a value: the expression has no result. */
  value: Optional<unknown>;
  /** The free reference paths of `expr`. */
  readonly reads: readonly DepPath[];
  /** The value readers: the nodes whose read path ends on this node. */
  readonly seats: ReadonlySet<NodeId>;
  /** The structural readers: the nodes whose read path goes through a slot of this node. */
  readonly seatsStructural: ReadonlySet<NodeId>;
  /** The nodes that have this node as a reader. Unwiring uses this index. */
  readonly seatedOn: ReadonlySet<NodeId>;
  /** The container that owns this node as a slot. The removal of the owner also removes this node. */
  readonly parent: NodeId | undefined;
  /** The containers that have a slot to this node: the owner and each container that shares the node. */
  readonly heldBy: ReadonlySet<NodeId>;
  /**
   * The named slots of a container. A node with slots is a container: its expression is a `record`
   * form over its slots, thus its value is the record of their values.
   */
  readonly slots: ReadonlyMap<string, NodeId>;
};

/**
 * The reactive semantics of a store. The engine uses these three ops for each write, each epoch and
 * each reference. Biblo layers class methods on top of them (`classNodeOps`).
 */
export type NodeOps = {
  /** This op writes a result to a node. It gives `true` when the value changed. */
  readonly splash: SplashFn;
  /** This op gives the nodes that a change of the target makes dirty. */
  readonly flow: FlowFn;
  /** This op resolves a path from a root node. It goes through slots first, then through the fields of the value. */
  readonly deref: DerefFn;
  /**
   * This op gives the nodes that a path from a root node depends on. The engine seats the reader on them.
   * A custom `deref` gives a matching `targets`, thus the wiring always agrees with the resolution.
   */
  readonly targets: TargetsFn;
};

/** The write op. It gives `true` when the value of the target changed. */
export type SplashFn = (value: Optional<unknown>, target: Node, store: NodeStore) => boolean;

/** The propagation op. It gives the nodes that a change of the target makes dirty. */
export type FlowFn = (target: Node, store: NodeStore) => ReadonlySet<NodeId>;

/** The resolution op. It gives the value at a path from a root node. */
export type DerefFn = (root: Node, path: readonly string[], store: NodeStore) => Optional<unknown>;

/**
 * The nodes that a read path depends on. A change of the value of `terminal` makes the reader dirty.
 * A change of the slots of a node in `through` makes the reader resolve its path again.
 * A path with no terminal reads no value, for example a missing slot of a container.
 */
export type ReadTargets = { readonly through: readonly Node[]; readonly terminal: Node | undefined };

/** The dependency op: the nodes that a path from a root node depends on. It agrees with `deref`. */
export type TargetsFn = (root: Node, path: readonly string[], store: NodeStore) => ReadTargets;

/** The record of one epoch. */
export type EpochStats = {
  /** The nodes that the epoch evaluated. */
  readonly evaluated: ReadonlySet<NodeId>;
  /** The nodes whose value changed in the epoch. */
  readonly changed: ReadonlySet<NodeId>;
  /** The nodes on a dependency cycle. A cycle evaluates again until its values are stable, up to `MAX_CYCLE_ROUNDS` rounds. */
  readonly cyclic: ReadonlySet<NodeId>;
  /** The number of nodes in the store after the epoch. */
  readonly total: number;
};

/** A store of nodes, with the semantics of its reactivity and the op registry of its expressions. */
export type NodeStore = {
  readonly nodes: ReadonlyMap<NodeId, Node>;
  readonly nodeOps: NodeOps;
  readonly ops: Ops;
  /** The record of the last epoch, or `null` before the first epoch. */
  readonly epochStats: EpochStats | null;
};

/** The options of `nodeStore`. */
export type StoreOptions = {
  /** The reactive semantics. The default is `defaultOps`. */
  readonly nodeOps?: NodeOps | undefined;
  /** The op registry of the expressions. The default is an empty registry. */
  readonly ops?: Ops | undefined;
};
