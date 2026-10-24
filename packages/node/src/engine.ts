/**
 * The internal state of a store and the epoch machine. The public operations are in `writes.ts`.
 *
 * Each write changes the structure at once and marks the nodes that it touched. A flush then rewires
 * the touched nodes and starts one epoch over them. Outside a batch, each write flushes at its end.
 */
import type { Context, HostThing, Json, Key, Plan } from "@mark1russell7/coeval";
import { THING, context, isRecord, prepare, refsOf } from "@mark1russell7/coeval";
import type { Expr, Ops, Resolver } from "@mark1russell7/render-dsl";
import { NO_VALUE, isLiteral, lit, machineOf, renderWorld } from "@mark1russell7/render-dsl";
import type { Optional } from "@mark1russell7/render-optional";
import { isSome, none, some } from "@mark1russell7/render-optional";
import type { DepPath, EpochStats, Node, NodeId, NodeOps, NodeStore } from "./types.ts";
import { isPlainObject } from "./equality.ts";

/** The mutable form of a node. Only the engine sees it. */
export type MutableNode = {
  readonly id: NodeId;
  expr: Expr;
  /** The plan of `expr`, which the kernel compiled one time. Each epoch evaluates it. */
  plan: Plan;
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
  /** This function compiles an expression with the machine of the op registry. Each write compiles its new expression one time. */
  readonly plan: (doc: unknown) => Plan;
  /** The context of each evaluation: the store is the host thing of the root `world`. */
  ctx: Context;
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

/** This function gives the keys of a path as texts. A document from another source can have a number key. */
const texts = (keys: readonly Key[]): readonly string[] =>
  keys.every((k): k is string => typeof k === "string") ? keys : keys.map(String);

/** This function reads a path of a store: `path[0]` is a node ID, and the `deref` op of the store reads the rest. */
const readPath = (s: StoreState, path: readonly Key[]): Optional<unknown> => {
  const rootId = path[0];
  const root = rootId === undefined ? undefined : s.nodes.get(String(rootId));
  return root ? s.nodeOps.deref(root, path.length === 1 ? [] : texts(path.slice(1)), publicStore(s)) : none;
};

/**
 * This function makes the host thing of a store: the root `world` of its expressions. The kernel gives it each
 * `world` path in one call (`resolve`). The store has no value of its own (`NO_VALUE`).
 */
const storeThing = (s: StoreState): HostThing => ({
  [THING]: true,
  label: "node store",
  deref: (key) => {
    const found = readPath(s, [key]);
    return isSome(found) ? found.value : undefined;
  },
  toJson: () => NO_VALUE,
  resolve: (keys) => {
    const found = readPath(s, keys);
    return isSome(found) ? { thing: found.value } : undefined;
  },
});

/** This function gives a state its context: the store is the root `world`. */
export const withContext = (s: StoreState): StoreState => {
  s.ctx = context({ world: storeThing(s) });
  return s;
};

/**
 * This function gives the compiler of an op registry. A store compiles each new expression one time, without a
 * cache. Most expressions of a store are new objects, for example the literal of each write.
 */
export const compilerOf = (ops: Ops): ((doc: unknown) => Plan) => {
  const machine = machineOf(ops);
  return (doc) => prepare(machine, doc);
};

/** This function makes the state of an empty store. */
export const makeState = (nodeOps: NodeOps, ops: Ops): StoreState =>
  withContext({
    nodes: new Map(),
    nodeOps,
    ops,
    plan: compilerOf(ops),
    ctx: context(),
    epochStats: null,
    nextId: 0,
    dangling: new Map(),
    pending: null,
    batchDepth: 0,
    epoch: 0,
  });

const NO_READS: readonly DepPath[] = Object.freeze([]);

/**
 * This function gives the read paths of an expression: the `world` references that the kernel finds (`refsOf`).
 * The paths have no duplicates and keep the order of the first read. A parameter of a `fn` is not a read.
 */
export const readsOf = (expr: Expr): readonly DepPath[] => {
  if (isLiteral(expr)) return NO_READS;
  const out: DepPath[] = [];
  const seen = new Set<string>();
  for (const use of refsOf(renderWorld, expr)) {
    if (!use.free || use.root !== "world") continue;
    // The JSON form of a path is a key without ambiguity: ["a b"] and ["a", "b"] stay separate
    const path = use.path.slice(1).map(String);
    const key = JSON.stringify(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
};

/** This function makes a node that is not in a store yet. The kernel compiles its expression one time. */
export const makeNode = (s: StoreState, id: NodeId, expr: Expr): MutableNode => ({
  id,
  expr,
  plan: s.plan(expr),
  value: none,
  reads: readsOf(expr),
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

/** This function makes the `record` construct of a container: one field for each slot, a `world` reference to the slot. */
export const recordOf = (n: MutableNode): Expr => {
  const fields: Record<string, Json> = {};
  for (const name of n.slots.keys()) {
    // An own data property, thus a slot "__proto__" stays a field
    Object.defineProperty(fields, name, { value: { type: "ref", value: ["world", n.id, name] }, enumerable: true, writable: true, configurable: true });
  }
  return { type: "record", value: fields };
};

/** This function tells if the expression of a container is the record of its current slots, in their order. */
const isRecordOf = (n: MutableNode): boolean => {
  const e = n.expr;
  if (e.type !== "record" || !isRecord(e.value)) return false;
  const fields = e.value;
  const names = Object.keys(fields);
  if (names.length !== n.slots.size) return false;
  let i = 0;
  for (const name of n.slots.keys()) {
    if (names[i++] !== name) return false;
    const r = fields[name] as { readonly type?: unknown; readonly value?: unknown } | null;
    const path = r?.type === "ref" && Array.isArray(r.value) ? (r.value as readonly unknown[]) : undefined;
    if (path?.length !== 3 || path[0] !== "world" || path[1] !== n.id || path[2] !== name) return false;
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
 * This function seats a node on the targets of its reads (the `targets` op of the store). The terminal gets a
 * value seat, and each node that the path goes through gets a structural seat. A read whose root is not in the
 * store waits in `dangling`. A missing slot of a container has no terminal. Thus a container cannot be on a
 * false cycle with a reader of one of its missing slots.
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
    const targets = s.nodeOps.targets(root, path.slice(1), publicStore(s));
    for (const t of targets.through) {
      const m = s.nodes.get(t.id);
      if (!m || m === n) continue;
      m.seatsStructural.add(n.id);
      n.seatedOn.add(m.id);
    }
    const terminal = targets.terminal === undefined ? undefined : s.nodes.get(targets.terminal.id);
    if (terminal && terminal !== n) {
      terminal.seats.add(n.id);
      n.seatedOn.add(terminal.id);
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
export const replaceExpr = (s: StoreState, n: MutableNode, expr: Expr, reads: readonly DepPath[] = readsOf(expr)): void => {
  unwireNode(s, n);
  n.expr = expr;
  n.plan = s.plan(expr);
  n.reads = reads;
};

/** This function gives the reads of the record of a container: one path to each slot. */
const recordReads = (n: MutableNode): readonly DepPath[] => Array.from(n.slots.keys(), (name) => [n.id, name]);

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
 * The build uses its own stack, not the call stack, thus a deep value does not overflow it.
 */
export const expandNow = (s: StoreState, id: NodeId): void => {
  const n = s.nodes.get(id);
  const value = n && isSome(n.value) ? n.value.value : undefined;
  if (!n || n.slots.size > 0 || !isPlainObject(value)) return;
  type Frame = { readonly owner: MutableNode; readonly value: object; readonly fields: [string, unknown][]; next: number };
  // The objects on the path from the root to the current field
  const ancestors = new Set<object>([value]);
  const frames: Frame[] = [{ owner: n, value, fields: Object.entries(value), next: 0 }];
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const field = frame.fields[frame.next++];
    if (field === undefined) {
      frames.pop();
      ancestors.delete(frame.value);
      // A container gets its record after its fields, thus the records go from the leaves to the root
      if (frame.owner !== n) touchRecord(s, frame.owner.id);
      continue;
    }
    const [key, fieldValue] = field;
    const sub = makeNode(s, freshId(s, `${frame.owner.id}.${key}`), lit(fieldValue));
    sub.parent = frame.owner.id;
    sub.value = some(fieldValue);
    insertNode(s, sub);
    linkSlot(frame.owner, key, sub);
    if (isPlainObject(fieldValue) && !ancestors.has(fieldValue)) {
      ancestors.add(fieldValue);
      frames.push({ owner: sub, value: fieldValue, fields: Object.entries(fieldValue), next: 0 });
    }
  }
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
 *
 * When an op throws, the dirty nodes that the epoch did not evaluate stay pending. The next flush evaluates them,
 * and the error goes to the caller. A throw before the evaluation, for example of a custom `targets` or `flow`
 * op, keeps all the work of the round pending.
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
      let epoch: { evaluated: Set<NodeId>; changed: Set<NodeId>; cyclic: Set<NodeId> };
      try {
        for (const id of p.records) {
          const n = s.nodes.get(id);
          if (!n) continue;
          if (!isRecordOf(n)) replaceExpr(s, n, recordOf(n), recordReads(n));
          p.touched.add(id);
        }
        for (const id of p.touched) {
          const n = s.nodes.get(id);
          if (!n) continue;
          unwireNode(s, n);
          wireNode(s, n);
        }
        epoch = runEpoch(s, p.touched);
      } catch (failure) {
        if (failure instanceof EpochFailure) {
          for (const id of failure.retry) touch(s, id);
          for (const id of p.expansions) touchExpansion(s, id);
          throw failure.cause;
        }
        // The wiring or the closure failed, thus no node evaluated: the full round stays pending
        for (const id of p.records) touchRecord(s, id);
        for (const id of p.touched) touch(s, id);
        for (const id of p.expansions) touchExpansion(s, id);
        throw failure;
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

/**
 * This function makes the resolver of a store: `path[0]` is a node ID. The expressions of the store read the same
 * paths through the host thing of the store.
 */
export const resolverOf = (store: NodeStore): Resolver => (path) => readPath(state(store), path);

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

  // 3. The evaluation of the dirty nodes, in order. The kernel evaluates the plan of each node.
  const ctx = s.ctx;
  const evaluated = new Set<NodeId>();
  const changed = new Set<NodeId>();
  const cyclic = new Set<NodeId>();
  const evaluateNode = (n: MutableNode): boolean => {
    n.dirty = 0;
    evaluated.add(n.id);
    const result = n.plan.evaluate(ctx);
    if (!s.nodeOps.splash(result.ok ? some(result.value) : none, n, store)) return false;
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
