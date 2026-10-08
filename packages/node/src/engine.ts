/**
 * The internal state of a store and the epoch machine. The public operations are in `writes.ts`.
 *
 * Each write changes the structure at once and marks the nodes that it touched. A flush then rewires
 * the touched nodes and runs one epoch over them. Outside a batch, each write flushes at its end.
 */
import type { DepPath, Expr, Ops, Resolver } from "@render/dsl";
import { deps, evaluate, lit, ref } from "@render/dsl";
import type { Optional } from "@render/optional";
import { none } from "@render/optional";
import type { EpochStats, Node, NodeId, NodeOps, NodeStore } from "./types.ts";

/** The mutable form of a node. Only the engine sees it. */
export type MutableNode = {
  readonly id: NodeId;
  expr: Expr;
  value: Optional<unknown>;
  reads: readonly DepPath[];
  readonly seats: Set<NodeId>;
  readonly seatsStructural: Set<NodeId>;
  readonly seatedOn: Set<NodeId>;
  parent: NodeId | undefined;
  readonly slots: Map<string, NodeId>;
  /** True when a read of this node waits in `dangling`. */
  dangles: boolean;
  // The scratch fields of the epoch machine. They are valid only when `mark` is the current epoch.
  mark: number;
  dirty: number;
  indegree: number;
  next: MutableNode[] | null;
};

/** The work that the next flush does. */
type Pending = {
  /** The nodes to rewire and to evaluate. */
  readonly touched: Set<NodeId>;
  /** The containers whose record expression to make again from their slots. */
  readonly records: Set<NodeId>;
};

/** The full state of a store. `nodeStore` makes it, and the public type `NodeStore` shows a part of it. */
export type StoreState = {
  readonly nodes: Map<NodeId, MutableNode>;
  readonly nodeOps: NodeOps;
  readonly ops: Ops;
  epochStats: EpochStats | null;
  nextId: number;
  /** For each node ID that is not in the store: the readers whose path starts at it. */
  readonly dangling: Map<NodeId, Set<NodeId>>;
  pending: Pending | null;
  batchDepth: number;
  /** The counter of epochs. The scratch fields of a node use it as a stamp. */
  epoch: number;
};

/** This function gives the internal state of a store. All stores come from `makeState`. */
export const state = (store: NodeStore): StoreState => store as unknown as StoreState;

/** This function gives the public view of a state. */
export const publicStore = (s: StoreState): NodeStore => s as unknown as NodeStore;

/** This function makes the state of an empty store. */
export const makeState = (nodeOps: NodeOps, ops: Ops): StoreState => ({
  nodes: new Map(),
  nodeOps,
  ops,
  epochStats: null,
  nextId: 0,
  dangling: new Map(),
  pending: null,
  batchDepth: 0,
  epoch: 0,
});

/** This function makes a node that is not in a store yet. */
export const makeNode = (id: NodeId, expr: Expr): MutableNode => ({
  id,
  expr,
  value: none,
  reads: deps(expr),
  seats: new Set(),
  seatsStructural: new Set(),
  seatedOn: new Set(),
  parent: undefined,
  slots: new Map(),
  dangles: false,
  mark: 0,
  dirty: 0,
  indegree: 0,
  next: null,
});

/**
 * This function gives an ID that no node of the store has. It uses the hint when the hint is free.
 * Without a hint, the IDs have the form `n_<number>`, with a counter for each store.
 */
export const freshId = (s: StoreState, hint?: string): NodeId => {
  if (hint !== undefined && !s.nodes.has(hint)) return hint;
  const base = hint ?? "n";
  for (;;) {
    const id = `${base}${hint === undefined ? "_" : "~"}${String(s.nextId++)}`;
    if (!s.nodes.has(id)) return id;
  }
};

/** This function makes the `record` expression of a container: one field for each slot. */
export const recordOf = (n: MutableNode): Expr => {
  const args: Expr[] = [];
  for (const name of n.slots.keys()) args.push(lit(name), ref(n.id, name));
  return { tag: "app", op: "record", args };
};

/** This function tells if the expression of a container is the record of its current slots. */
const isRecordOf = (n: MutableNode): boolean => {
  const e = n.expr;
  if (e.tag !== "app" || e.op !== "record" || e.args.length !== 2 * n.slots.size) return false;
  let i = 0;
  for (const name of n.slots.keys()) {
    const k = e.args[i++]!;
    const r = e.args[i++]!;
    if (k.tag !== "lit" || k.value !== name) return false;
    if (r.tag !== "ref" || r.path.length !== 2 || r.path[0] !== n.id || r.path[1] !== name) return false;
  }
  return true;
};

// === Wiring ===

/**
 * This function gives the chain of nodes that a read path goes through. The chain starts at the root
 * (`path[0]`, a node ID) and follows slots as far as they exist. The last node is the terminal: the path
 * reads its value. The function gives an empty chain when the root is not in the store.
 */
export const readTargets = (nodes: ReadonlyMap<NodeId, Node>, path: DepPath): Node[] => {
  const rootId = path[0];
  const root = rootId === undefined ? undefined : nodes.get(rootId);
  if (!root) return [];
  const out: Node[] = [root];
  let current = root;
  for (let i = 1; i < path.length; i++) {
    const slotId = current.slots.get(path[i]!);
    const next = slotId === undefined ? undefined : nodes.get(slotId);
    if (!next) break;
    current = next;
    out.push(current);
  }
  return out;
};

/**
 * This function seats a node on the nodes that its reads go through: a value seat on the terminal, and a
 * structural seat on each node before it. A read whose root is not in the store waits in `dangling`.
 */
export const wireNode = (s: StoreState, n: MutableNode): void => {
  for (const path of n.reads) {
    const rootId = path[0];
    const root = rootId === undefined ? undefined : s.nodes.get(rootId);
    if (!root) {
      if (rootId !== undefined) {
        let waiting = s.dangling.get(rootId);
        if (!waiting) s.dangling.set(rootId, (waiting = new Set()));
        waiting.add(n.id);
        n.dangles = true;
      }
      continue;
    }
    let current: MutableNode = root;
    for (let i = 1; i < path.length; i++) {
      const slotId = current.slots.get(path[i]!);
      const next = slotId === undefined ? undefined : s.nodes.get(slotId);
      if (!next) break;
      if (current !== n) {
        current.seatsStructural.add(n.id);
        n.seatedOn.add(current.id);
      }
      current = next;
    }
    if (current !== n) {
      current.seats.add(n.id);
      n.seatedOn.add(current.id);
    }
  }
};

/** This function removes a node from each seat set that holds it, and from `dangling`. */
export const unwireNode = (s: StoreState, n: MutableNode): void => {
  if (n.seatedOn.size > 0) {
    for (const otherId of n.seatedOn) {
      const other = s.nodes.get(otherId);
      if (other) {
        other.seats.delete(n.id);
        other.seatsStructural.delete(n.id);
      }
    }
    n.seatedOn.clear();
  }
  if (n.dangles) {
    for (const path of n.reads) {
      const head = path[0];
      const waiting = head === undefined ? undefined : s.dangling.get(head);
      if (waiting) {
        waiting.delete(n.id);
        if (waiting.size === 0) s.dangling.delete(head!);
      }
    }
    n.dangles = false;
  }
};

/** This function changes the expression of a node and keeps its reads correct. The caller touches the node. */
export const replaceExpr = (s: StoreState, n: MutableNode, expr: Expr): void => {
  unwireNode(s, n);
  n.expr = expr;
  n.reads = deps(expr);
};

// === Pending work, batches and the flush ===

const pending = (s: StoreState): Pending => (s.pending ??= { touched: new Set(), records: new Set() });

/** This function marks a node for the next flush: rewire and evaluate. */
export const touch = (s: StoreState, id: NodeId): void => {
  pending(s).touched.add(id);
};

/** This function marks a container: the next flush makes its record expression again. */
export const touchRecord = (s: StoreState, id: NodeId): void => {
  pending(s).records.add(id);
};

/** This function adds a node to the store. Readers that waited for its ID get rewired. */
export const insertNode = (s: StoreState, n: MutableNode): void => {
  s.nodes.set(n.id, n);
  touch(s, n.id);
  const waiting = s.dangling.get(n.id);
  if (waiting) {
    for (const r of waiting) touch(s, r);
    s.dangling.delete(n.id);
  }
};

/** This function runs the pending work now, except inside a batch. */
export const flushUnlessBatched = (s: StoreState): void => {
  if (s.batchDepth === 0) flush(s);
};

/** This function runs `fn` as one transaction: the pending work of all its writes runs as one epoch at the end. */
export const runBatch = <T>(s: StoreState, fn: () => T): T => {
  s.batchDepth++;
  try {
    return fn();
  } finally {
    s.batchDepth--;
    if (s.batchDepth === 0) flush(s);
  }
};

/** The limit of follow-up epochs in one flush. Only a custom op that writes on each epoch reaches it. */
const MAX_FOLLOW_UPS = 1000;

/**
 * This function runs the pending work. A write from a custom op during an epoch does not run inside
 * that epoch: it becomes pending, and the flush runs it as a follow-up epoch. The stats join all epochs.
 */
const flush = (s: StoreState): void => {
  let stats: { evaluated: Set<NodeId>; changed: Set<NodeId>; cyclic: Set<NodeId> } | null = null;
  s.batchDepth++;
  try {
    for (let round = 0; s.pending; round++) {
      if (round > MAX_FOLLOW_UPS) {
        s.pending = null;
        throw new Error(`The epochs did not settle after ${String(MAX_FOLLOW_UPS)} follow-ups: an op writes on each epoch.`);
      }
      const p = s.pending;
      s.pending = null;
      for (const id of p.records) {
        const n = s.nodes.get(id);
        if (!n) continue;
        if (!isRecordOf(n)) replaceExpr(s, n, recordOf(n));
        p.touched.add(id);
      }
      for (const id of p.touched) {
        const n = s.nodes.get(id);
        if (!n) continue;
        unwireNode(s, n);
        wireNode(s, n);
      }
      const epoch = runEpoch(s, p.touched);
      if (!stats) stats = epoch;
      else {
        for (const id of epoch.evaluated) stats.evaluated.add(id);
        for (const id of epoch.changed) stats.changed.add(id);
        for (const id of epoch.cyclic) stats.cyclic.add(id);
      }
    }
  } finally {
    s.batchDepth--;
  }
  s.epochStats = {
    evaluated: stats?.evaluated ?? new Set(),
    changed: stats?.changed ?? new Set(),
    cyclic: stats?.cyclic ?? new Set(),
    total: s.nodes.size,
  };
};

// === The epoch ===

/** This function makes the resolver that the expressions of a store use: `path[0]` is a node ID. */
export const resolverOf = (store: NodeStore): Resolver => (path) => {
  const rootId = path[0];
  const root = rootId === undefined ? undefined : store.nodes.get(rootId);
  return root ? store.nodeOps.deref(root, path.length === 1 ? [] : path.slice(1), store) : none;
};

/**
 * One epoch. The engine finds the closure of the frontier through `flow` and sorts it topologically.
 * Then it evaluates each dirty node in that order, thus each node reads settled values and evaluates at most
 * one time. A node is dirty when it is in the frontier or when a node before it changed. The nodes on a
 * cycle come after the sorted part, in the order of discovery.
 *
 * The machine keeps its state in the scratch fields of the nodes, with the epoch number as a stamp.
 */
const runEpoch = (
  s: StoreState,
  frontier: ReadonlySet<NodeId>,
): { evaluated: Set<NodeId>; changed: Set<NodeId>; cyclic: Set<NodeId> } => {
  const store = publicStore(s);
  const epoch = ++s.epoch;

  // 1. The closure: the nodes that the frontier can reach. Each node gets its successors one time.
  const closure: MutableNode[] = [];
  const stack: MutableNode[] = [];
  const enter = (n: MutableNode): void => {
    n.mark = epoch;
    n.indegree = 0;
    n.next = null;
    stack.push(n);
  };
  for (const id of frontier) {
    const n = s.nodes.get(id);
    if (n && n.mark !== epoch) {
      enter(n);
      n.dirty = epoch;
    }
  }
  while (stack.length > 0) {
    const n = stack.pop()!;
    closure.push(n);
    const next: MutableNode[] = [];
    for (const id of s.nodeOps.flow(n, store)) {
      const m = s.nodes.get(id);
      if (!m || m === n) continue;
      next.push(m);
      if (m.mark !== epoch) enter(m);
    }
    n.next = next;
  }

  // 2. The topological order of the closure (Kahn)
  for (const n of closure) for (const m of n.next!) m.indegree++;
  const order: MutableNode[] = [];
  for (const n of closure) if (n.indegree === 0) order.push(n);
  for (let head = 0; head < order.length; head++) {
    for (const m of order[head]!.next!) if (--m.indegree === 0) order.push(m);
  }
  const cyclic = new Set<NodeId>();
  if (order.length < closure.length) {
    for (const n of closure) {
      if (n.indegree > 0) {
        cyclic.add(n.id);
        order.push(n);
      }
    }
  }

  // 3. The evaluation of the dirty nodes, in order
  const resolver = resolverOf(store);
  const evaluated = new Set<NodeId>();
  const changed = new Set<NodeId>();
  for (const n of order) {
    if (n.dirty !== epoch) continue;
    evaluated.add(n.id);
    if (s.nodeOps.splash(evaluate(n.expr, resolver, s.ops), n, store)) {
      changed.add(n.id);
      for (const m of n.next!) m.dirty = epoch;
    }
  }
  for (const n of closure) n.next = null;
  return { evaluated, changed, cyclic };
};
