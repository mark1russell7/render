/**
 * The internal state of a store and the epoch machine. The public operations are in `writes.ts`.
 *
 * Each write changes the structure at once and marks the nodes that it touched. A flush then rewires
 * the touched nodes and starts one epoch over them. Outside a batch, each write flushes at its end.
 */
import type { DepPath, Expr, Ops, Resolver } from "@render/dsl";
import { deps, evaluate, lit, ref } from "@render/dsl";
import type { Optional } from "@render/optional";
import { isSome, none, some } from "@render/optional";
import type { EpochStats, Node, NodeId, NodeOps, NodeStore } from "./types.ts";
import { isPlainObject } from "./equality.ts";

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
  readonly heldBy: Set<NodeId>;
  readonly slots: Map<string, NodeId>;
  /** True when a read of this node waits in `dangling`. */
  dangles: boolean;
  // The scratch fields of the epoch machine. They are valid only when `mark` is the current epoch.
  mark: number;
  dirty: number;
  index: number;
  low: number;
  onStack: boolean;
  next: MutableNode[] | null;
};

/** The work that the next flush does. */
type Pending = {
  /** The nodes to rewire and to evaluate. */
  readonly touched: Set<NodeId>;
  /** The containers whose record expression to make again from their slots. */
  readonly records: Set<NodeId>;
  /** The nodes to expand after the epoch, because a batch asked for an expansion of a value that was not settled. */
  readonly expansions: Set<NodeId>;
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
export const publicStore = (s: StoreState): NodeStore => s;

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
  heldBy: new Set(),
  slots: new Map(),
  dangles: false,
  mark: 0,
  dirty: 0,
  index: -1,
  low: -1,
  onStack: false,
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

// === Slots ===

/** This function points a slot at a node and records the container in `heldBy` of the node. */
export const linkSlot = (container: MutableNode, name: string, child: MutableNode): void => {
  container.slots.set(name, child.id);
  child.heldBy.add(container.id);
};

/** This function removes a slot. The target forgets the container when no other slot of the container points at it. */
export const unlinkSlot = (s: StoreState, container: MutableNode, name: string): void => {
  const target = container.slots.get(name);
  container.slots.delete(name);
  if (target === undefined) return;
  for (const other of container.slots.values()) if (other === target) return;
  s.nodes.get(target)?.heldBy.delete(container.id);
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
 * This function seats a node on the nodes that its reads go through. The terminal gets a value seat, and
 * each node before it gets a structural seat. A read whose root is not in the store waits in `dangling`.
 *
 * A path that stops at a container before its end reads a slot that the container does not have. That read
 * gives `none` and does not read the value of the container. Thus it gets only a structural seat, and a
 * container cannot be on a false cycle with a reader of one of its missing slots.
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
    let i = 1;
    for (; i < path.length; i++) {
      const slotId = current.slots.get(path[i]!);
      const next = slotId === undefined ? undefined : s.nodes.get(slotId);
      if (!next) break;
      if (current !== n) {
        current.seatsStructural.add(n.id);
        n.seatedOn.add(current.id);
      }
      current = next;
    }
    if (current === n) continue;
    const deadEnd = i < path.length && current.slots.size > 0;
    (deadEnd ? current.seatsStructural : current.seats).add(n.id);
    n.seatedOn.add(current.id);
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

const pending = (s: StoreState): Pending =>
  (s.pending ??= { touched: new Set(), records: new Set(), expansions: new Set() });

/** This function marks a node for the next flush: rewire and evaluate. */
export const touch = (s: StoreState, id: NodeId): void => {
  pending(s).touched.add(id);
};

/** This function marks a container: the next flush makes its record expression again. */
export const touchRecord = (s: StoreState, id: NodeId): void => {
  pending(s).records.add(id);
};

/** This function marks a node for an expansion after the next epoch, when its value is settled. */
export const touchExpansion = (s: StoreState, id: NodeId): void => {
  pending(s).expansions.add(id);
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

/**
 * This function expands a node with a settled value. Each field of a plain object becomes an owned
 * slot, and a field that is a plain object becomes a container in turn. A field that holds one of its own
 * ancestors stays a leaf, thus a cyclic object gives a finite tree. The caller flushes.
 */
export const expandNow = (s: StoreState, id: NodeId): void => {
  const n = s.nodes.get(id);
  const value = n && isSome(n.value) ? n.value.value : undefined;
  if (!n || n.slots.size > 0 || !isPlainObject(value)) return;
  const build = (owner: MutableNode, fields: Record<string, unknown>, ancestors: ReadonlySet<object>): void => {
    for (const [key, fieldValue] of Object.entries(fields)) {
      const sub = makeNode(freshId(s, `${owner.id}.${key}`), lit(fieldValue));
      sub.parent = owner.id;
      sub.value = some(fieldValue);
      insertNode(s, sub);
      linkSlot(owner, key, sub);
      if (isPlainObject(fieldValue) && !ancestors.has(fieldValue)) {
        build(sub, fieldValue, new Set([...ancestors, fieldValue]));
        touchRecord(s, sub.id);
      }
    }
  };
  build(n, value, new Set([value]));
  touchRecord(s, n.id);
  for (const r of n.seats) touch(s, r);
  for (const r of n.seatsStructural) touch(s, r);
};

/** This function does the pending work at once, except inside a batch. */
export const flushUnlessBatched = (s: StoreState): void => {
  if (s.batchDepth === 0) flush(s);
};

/**
 * This function makes `fn` one transaction: the pending work of all its writes becomes one epoch at the end.
 * When `fn` throws, the flush still does the pending work, and the error of `fn` is the error of the batch.
 */
export const runBatch = <T>(s: StoreState, fn: () => T): T => {
  s.batchDepth++;
  let result: T;
  try {
    result = fn();
  } catch (error) {
    s.batchDepth--;
    if (s.batchDepth === 0) {
      try {
        flush(s);
      } catch {
        // The error of fn is the cause. An error of the flush comes after it, thus the batch keeps the first one.
      }
    }
    throw error;
  }
  s.batchDepth--;
  if (s.batchDepth === 0) flush(s);
  return result;
};

/** The limit of follow-up epochs in one flush. Only a custom op that writes on each epoch reaches it. */
const MAX_FOLLOW_UPS = 1000;

/** The error of an op during an epoch, with the dirty nodes that the epoch did not evaluate. */
class EpochFailure {
  readonly retry: ReadonlySet<NodeId>;
  readonly cause: unknown;
  constructor(retry: ReadonlySet<NodeId>, cause: unknown) {
    this.retry = retry;
    this.cause = cause;
  }
}

/**
 * This function does the pending work. A custom op can write during an epoch. That write does not go into
 * the epoch: it becomes pending, and the flush does it in a follow-up epoch. The stats join all epochs.
 * When an op throws, the dirty nodes that the epoch did not evaluate stay pending. The next flush evaluates them,
 * and the error goes to the caller.
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
      let epoch: { evaluated: Set<NodeId>; changed: Set<NodeId>; cyclic: Set<NodeId> };
      try {
        epoch = runEpoch(s, p.touched);
      } catch (failure) {
        if (!(failure instanceof EpochFailure)) throw failure;
        for (const id of failure.retry) touch(s, id);
        for (const id of p.expansions) touchExpansion(s, id);
        throw failure.cause;
      }
      if (!stats) stats = epoch;
      else {
        for (const id of epoch.evaluated) stats.evaluated.add(id);
        for (const id of epoch.changed) stats.changed.add(id);
        for (const id of epoch.cyclic) stats.cyclic.add(id);
      }
      // An expansion inside a batch waits for the settled value. It makes new pending work: a follow-up epoch.
      for (const id of p.expansions) expandNow(s, id);
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
 * The limit of the rounds of a cycle in one epoch. Like the iterative calculation of a spreadsheet, the members
 * of a cycle evaluate again until their values are stable, or until this limit.
 */
export const MAX_CYCLE_ROUNDS = 100;

/**
 * This function gives the strongly connected components of the closure (Tarjan, without recursion).
 * Tarjan gives each component after all components that it reaches. Thus the reverse list is a topological
 * order of the components, and each node comes after its inputs.
 */
const components = (closure: readonly MutableNode[]): MutableNode[][] => {
  const out: MutableNode[][] = [];
  const stack: MutableNode[] = [];
  let counter = 0;
  for (const start of closure) {
    if (start.index !== -1) continue;
    const frames: { readonly node: MutableNode; next: number }[] = [];
    const open = (v: MutableNode): void => {
      v.index = v.low = counter++;
      v.onStack = true;
      stack.push(v);
      frames.push({ node: v, next: 0 });
    };
    open(start);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const v = frame.node;
      const successors = v.next!;
      if (frame.next < successors.length) {
        const w = successors[frame.next++]!;
        if (w.index === -1) open(w);
        else if (w.onStack) v.low = Math.min(v.low, w.index);
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) parent.node.low = Math.min(parent.node.low, v.low);
      if (v.low === v.index) {
        const component: MutableNode[] = [];
        let w: MutableNode;
        do {
          w = stack.pop()!;
          w.onStack = false;
          component.push(w);
        } while (w !== v);
        out.push(component);
      }
    }
  }
  return out.toReversed();
};

/**
 * One epoch. The engine finds the closure of the frontier through `flow`, and it orders the strongly connected
 * components of the closure topologically. Then it evaluates each dirty node in that order, thus each node
 * reads settled values. A node is dirty when it is in the frontier or when one of its inputs changed.
 *
 * A node outside a cycle evaluates at most one time. The members of a cycle (a component with more than one
 * node) evaluate again while one of them changes, up to `MAX_CYCLE_ROUNDS` rounds. The stats report them.
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
    n.index = -1;
    n.low = -1;
    n.onStack = false;
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

  // 2. The order: the components, with each component after its inputs
  const order = components(closure);

  // 3. The evaluation of the dirty nodes, in order
  const resolver = resolverOf(store);
  const evaluated = new Set<NodeId>();
  const changed = new Set<NodeId>();
  const cyclic = new Set<NodeId>();
  const evaluateNode = (n: MutableNode): boolean => {
    n.dirty = 0;
    evaluated.add(n.id);
    if (!s.nodeOps.splash(evaluate(n.expr, resolver, s.ops), n, store)) return false;
    changed.add(n.id);
    for (const m of n.next!) m.dirty = epoch;
    return true;
  };
  let position = 0;
  try {
    for (; position < order.length; position++) {
      const component = order[position]!;
      if (component.length === 1) {
        const n = component[0]!;
        if (n.dirty === epoch) evaluateNode(n);
        continue;
      }
      for (const n of component) cyclic.add(n.id);
      for (let round = 0; round < MAX_CYCLE_ROUNDS; round++) {
        let any = false;
        for (const n of component) if (n.dirty === epoch && evaluateNode(n)) any = true;
        if (!any) break;
      }
    }
  } catch (cause) {
    const retry = new Set<NodeId>();
    for (let i = position; i < order.length; i++) {
      for (const n of order[i]!) if (n.dirty === epoch || i === position) retry.add(n.id);
    }
    for (const n of closure) n.next = null;
    throw new EpochFailure(retry, cause);
  }
  for (const n of closure) n.next = null;
  return { evaluated, changed, cyclic };
};
