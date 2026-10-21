/**
 * The public operations of a store. Each operation keeps the store consistent. At the end of the operation, or after
 * the end of the enclosing batch, the value of each node agrees with its expression.
 * The seats agree with the reads too. `store.epochStats` records the epoch of the last operation.
 */
import type { Expr, ExprDocument } from "@mark1russell7/render-dsl";
import { asExpr, lit } from "@mark1russell7/render-dsl";
import type { Optional } from "@mark1russell7/render-optional";
import { none } from "@mark1russell7/render-optional";
import type { Node, NodeId, NodeStore, StoreOptions } from "./types.ts";
import type { MutableNode, StoreState } from "./engine.ts";
import {
  expandNow, flushUnlessBatched, freshId, insertNode, linkSlot, makeNode, makeState, publicStore, replaceExpr,
  runBatch, state, touch, touchExpansion, touchRecord, unlinkSlot, unwireNode,
} from "./engine.ts";
import { defaultOps } from "./ops.ts";

/** This function makes an empty store. The options give its reactive semantics and its op registry. */
export const nodeStore = (options: StoreOptions = {}): NodeStore =>
  publicStore(makeState(options.nodeOps ?? defaultOps, options.ops ?? {}));

/**
 * This function gives an independent copy of a store: the same nodes, values, slots and seats, and the same
 * counters. A write to one store does not change the other. The expressions and the values are immutable,
 * thus the copy shares them. The options replace the semantics or the op registry of the copy, for example the
 * class semantics of a copied biblo. The function throws inside a batch, because a batch has pending work.
 */
export const forkStore = (store: NodeStore, options: StoreOptions = {}): NodeStore => {
  const s = state(store);
  if (s.pending !== null || s.batchDepth > 0) throw new Error("forkStore: the store is in a batch");
  const copy: StoreState = {
    nodes: new Map(),
    nodeOps: options.nodeOps ?? s.nodeOps,
    ops: options.ops ?? s.ops,
    epochStats: s.epochStats,
    nextId: s.nextId,
    dangling: new Map([...s.dangling].map(([id, readers]) => [id, new Set(readers)])),
    pending: null,
    batchDepth: 0,
    epoch: s.epoch,
  };
  for (const [id, n] of s.nodes) {
    const node: MutableNode = {
      ...n,
      seats: new Set(n.seats),
      seatsStructural: new Set(n.seatsStructural),
      seatedOn: new Set(n.seatedOn),
      heldBy: new Set(n.heldBy),
      slots: new Map(n.slots),
      // The scratch fields of the epoch machine start again: no epoch is in progress
      mark: 0,
      dirty: 0,
      index: -1,
      low: -1,
      onStack: false,
      next: null,
    };
    copy.nodes.set(id, node);
  }
  return publicStore(copy);
};

/** This function gives a node of the store, or `undefined`. */
export const getNode = (store: NodeStore, id: NodeId): Node | undefined => store.nodes.get(id);

/** This function gives the value of a node, or `none` when the store has no such node. */
export const readValue = (store: NodeStore, id: NodeId): Optional<unknown> => store.nodes.get(id)?.value ?? none;

/**
 * This function makes `fn` one transaction. The writes in `fn` change the structure at once, and one epoch
 * at the end evaluates all their effects. A batch inside a batch joins the outer batch.
 */
export const batch = <T>(store: NodeStore, fn: () => T): T => runBatch(state(store), fn);

/**
 * This function adds a node with an expression and evaluates it. It gives the ID of the node.
 * The ID is the hint when no node has it, otherwise a fresh ID. A reader that waited for this ID gets rewired.
 * The expression can be a document (`ExprDocument`): the node keeps its tree of the IR (`asExpr`).
 */
export const addNode = (store: NodeStore, expr: Expr | ExprDocument, idHint?: string): NodeId => {
  const s = state(store);
  const n = makeNode(freshId(s, idHint), asExpr(expr));
  insertNode(s, n);
  flushUnlessBatched(s);
  return n.id;
};

/**
 * This function sets the expression of a node. This is the fundamental write.
 * The engine rewires the reads of the node, evaluates it and propagates the change.
 * A write to a container collapses it first: its own slots are removed, and the expression replaces the record.
 * The expression can be a document (`ExprDocument`): the node keeps its tree of the IR (`asExpr`).
 */
export const setExpr = (store: NodeStore, id: NodeId, expr: Expr | ExprDocument): void => {
  const s = state(store);
  const n = s.nodes.get(id);
  if (n) {
    if (n.slots.size > 0) collapse(s, n);
    replaceExpr(s, n, asExpr(expr));
    touch(s, id);
  }
  flushUnlessBatched(s);
};

/**
 * This function writes a literal value: it is `setExpr` with `lit(value)`.
 * A write to a derived node makes it an input node, like a value that a person types over a formula.
 */
export const setValue = (store: NodeStore, id: NodeId, value: unknown): void => {
  setExpr(store, id, lit(value));
};

/** This function writes many literal values in one batch, thus in one epoch. */
export const fillMany = (store: NodeStore, writes: Iterable<readonly [NodeId, unknown]>): void => {
  batch(store, () => {
    for (const [id, value] of writes) setValue(store, id, value);
  });
};

/** The options of `setSlot`. */
export type SlotOptions = {
  /**
   * With `own`, the container becomes the owner of the child when the child has no owner. The removal of the
   * owner removes the child, and so does a slot change that drops the child. Without `own`, the child is shared.
   */
  readonly own?: boolean;
};

/**
 * This function points a slot of a container at a node, or removes the slot when `childId` is `undefined`.
 * This is the structural write: the container gets a new record expression, and each reader whose path goes
 * through the container resolves its path again. A node that the container owns and drops is removed.
 * The function does nothing when a node is missing or when the child is the container itself.
 */
export const setSlot = (
  store: NodeStore,
  parentId: NodeId,
  name: string,
  childId: NodeId | undefined,
  options: SlotOptions = {},
): void => {
  const s = state(store);
  const parent = s.nodes.get(parentId);
  const child = childId === undefined ? undefined : s.nodes.get(childId);
  if (parent && (childId === undefined || (child && childId !== parentId)) && parent.slots.get(name) !== childId) {
    const previous = parent.slots.get(name);
    if (previous !== undefined) unlinkSlot(s, parent, name);
    if (child) {
      linkSlot(parent, name, child);
      if (options.own === true && (child.parent === undefined || !s.nodes.has(child.parent))) child.parent = parent.id;
    }
    if (previous !== undefined) dropIfOwned(s, parent, previous);
    touchRecord(s, parent.id);
    for (const r of parent.seatsStructural) touch(s, r);
    for (const r of parent.seats) touch(s, r);
  }
  flushUnlessBatched(s);
};

/**
 * This function expands a node whose value is a plain object. Each field becomes a slot, and
 * a field that is a plain object becomes a container in turn. The node becomes a container, and its slots
 * are from then on the source of truth of its fields. A reader of a field gets a seat on the field node,
 * thus an edit of one field makes only its own readers dirty. An expansion of a derived node keeps the current fields.
 *
 * Inside a batch, the expansion waits for the epoch of the batch, thus it uses the settled value.
 * The function does nothing for a container or for a value that is not a plain object.
 */
export const expandNode = (store: NodeStore, id: NodeId): void => {
  const s = state(store);
  if (s.batchDepth > 0) touchExpansion(s, id);
  else expandNow(s, id);
  flushUnlessBatched(s);
};

/**
 * This function removes a node and the slots that it owns. The containers that hold it lose the slot.
 * Its readers resolve their paths again: a path to a removed node gives `none`. If a node with the same ID
 * comes back later, the readers find it.
 */
export const removeNode = (store: NodeStore, id: NodeId): void => {
  const s = state(store);
  const n = s.nodes.get(id);
  if (n) removeOwned(s, n);
  flushUnlessBatched(s);
};

/**
 * This function evaluates the full store again. It rewires each node, makes each record expression again,
 * and starts one epoch in which each node evaluates one time in topological order. The operations keep the
 * store consistent, thus this function is a repair tool. It does not revert a write.
 */
export const resolveAll = (store: NodeStore): void => {
  const s = state(store);
  for (const n of s.nodes.values()) {
    touch(s, n.id);
    if (n.slots.size > 0) touchRecord(s, n.id);
  }
  flushUnlessBatched(s);
};

// === Internal ===

/** A node that the container owns and no longer holds is removed: it was a part of the container. */
const dropIfOwned = (s: StoreState, container: MutableNode, childId: NodeId): void => {
  const former = s.nodes.get(childId);
  if (!former || former.parent !== container.id) return;
  for (const target of container.slots.values()) if (target === childId) return;
  removeOwned(s, former);
};

/** A container gives up its slots: the owned slot nodes are removed, and the shared ones are only released. */
const collapse = (s: StoreState, n: MutableNode): void => {
  const slots = [...n.slots.values()];
  for (const name of Array.from(n.slots.keys())) unlinkSlot(s, n, name);
  for (const childId of slots) {
    const child = s.nodes.get(childId);
    if (child && child.parent === n.id) removeOwned(s, child);
  }
  for (const r of n.seatsStructural) touch(s, r);
};

/** This function removes a node and its owned slot subtree, and touches each reader that stays. */
const removeOwned = (s: StoreState, root: MutableNode): void => {
  const doomed: MutableNode[] = [];
  const doomedIds = new Set<NodeId>();
  // The owned subtree, with a stack of its own: a deep tree does not overflow the call stack
  for (const todo = [root]; todo.length > 0;) {
    const n = todo.pop();
    if (n === undefined || doomedIds.has(n.id)) continue;
    doomedIds.add(n.id);
    doomed.push(n);
    for (const childId of n.slots.values()) {
      const child = s.nodes.get(childId);
      if (child && child.parent === n.id) todo.push(child);
    }
  }

  // The owner and each container that shares a removed node lose the slot
  for (const n of doomed) {
    for (const r of n.seatsStructural) touch(s, r);
    for (const r of n.seats) touch(s, r);
    for (const holderId of Array.from(n.heldBy)) {
      const holder = doomedIds.has(holderId) ? undefined : s.nodes.get(holderId);
      if (!holder) continue;
      for (const [name, target] of Array.from(holder.slots)) {
        if (target === n.id) unlinkSlot(s, holder, name);
      }
      touchRecord(s, holder.id);
      for (const r of holder.seatsStructural) touch(s, r);
    }
  }
  // A removed container no longer holds the nodes that it shares
  for (const n of doomed) {
    for (const target of n.slots.values()) if (!doomedIds.has(target)) s.nodes.get(target)?.heldBy.delete(n.id);
  }

  for (const n of doomed) {
    for (const readerId of n.seats) s.nodes.get(readerId)?.seatedOn.delete(n.id);
    for (const readerId of n.seatsStructural) s.nodes.get(readerId)?.seatedOn.delete(n.id);
    n.seats.clear();
    n.seatsStructural.clear();
  }
  for (const n of doomed) {
    unwireNode(s, n);
    s.nodes.delete(n.id);
  }
};
