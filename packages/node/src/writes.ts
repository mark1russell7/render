/**
 * The public operations of a store. Each operation keeps the store consistent: after it returns (or after
 * the end of the enclosing batch), the value of each node agrees with its expression, and the seats agree
 * with the reads. `store.epochStats` records the epoch of the last operation.
 */
import type { Expr } from "@render/dsl";
import { lit } from "@render/dsl";
import type { Optional } from "@render/optional";
import { isSome, none, some } from "@render/optional";
import type { Node, NodeId, NodeStore, StoreOptions } from "./types.ts";
import type { MutableNode, StoreState } from "./engine.ts";
import {
  flushUnlessBatched, freshId, insertNode, makeNode, makeState, publicStore, replaceExpr,
  runBatch, state, touch, touchRecord, unwireNode,
} from "./engine.ts";
import { defaultOps } from "./ops.ts";
import { isPlainObject } from "./equality.ts";

/** This function makes an empty store. The options give its reactive semantics and its op registry. */
export const nodeStore = (options: StoreOptions = {}): NodeStore =>
  publicStore(makeState(options.nodeOps ?? defaultOps, options.ops ?? {}));

/** This function gives a node of the store, or `undefined`. */
export const getNode = (store: NodeStore, id: NodeId): Node | undefined => store.nodes.get(id);

/** This function gives the value of a node, or `none` when the store has no such node. */
export const readValue = (store: NodeStore, id: NodeId): Optional<unknown> => store.nodes.get(id)?.value ?? none;

/**
 * This function runs `fn` as one transaction. The writes in `fn` change the structure at once, and one epoch
 * at the end evaluates all their effects. A batch inside a batch joins the outer batch.
 */
export const batch = <T>(store: NodeStore, fn: () => T): T => runBatch(state(store), fn);

/**
 * This function adds a node with an expression and evaluates it. It gives the ID of the node.
 * The ID is the hint when no node has it, otherwise a fresh ID. A reader that waited for this ID gets rewired.
 */
export const addNode = (store: NodeStore, expr: Expr, idHint?: string): NodeId => {
  const s = state(store);
  const n = makeNode(freshId(s, idHint), expr);
  insertNode(s, n);
  flushUnlessBatched(s);
  return n.id;
};

/**
 * This function sets the expression of a node. This is the fundamental write.
 * The engine rewires the reads of the node, evaluates it and propagates the change.
 * A write to a container collapses it first: its own slots are removed, and the expression replaces the record.
 */
export const setExpr = (store: NodeStore, id: NodeId, expr: Expr): void => {
  const s = state(store);
  const n = s.nodes.get(id);
  if (n) {
    if (n.slots.size > 0) collapse(s, n);
    replaceExpr(s, n, expr);
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

/**
 * This function points a slot of a container at a node, or removes the slot when `childId` is `undefined`.
 * This is the structural write: the container gets a new record expression, and each reader whose path goes
 * through the container resolves its path again. The child becomes owned by the container when it has no owner.
 * The function does nothing when a node is missing or when the child is the container itself.
 */
export const setSlot = (store: NodeStore, parentId: NodeId, name: string, childId: NodeId | undefined): void => {
  const s = state(store);
  const parent = s.nodes.get(parentId);
  const child = childId === undefined ? undefined : s.nodes.get(childId);
  if (parent && (childId === undefined || (child && childId !== parentId)) && parent.slots.get(name) !== childId) {
    const previous = parent.slots.get(name);
    if (child) parent.slots.set(name, child.id);
    else parent.slots.delete(name);
    if (previous !== undefined) releaseOwnership(s, parent, previous);
    if (child && (child.parent === undefined || !s.nodes.has(child.parent))) child.parent = parent.id;
    touchRecord(s, parent.id);
    for (const r of parent.seatsStructural) touch(s, r);
    for (const r of parent.seats) touch(s, r);
  }
  flushUnlessBatched(s);
};

/**
 * This function expands a node whose value is a plain object. Each field becomes a slot, and
 * a field that is a plain object becomes a container in turn. The node becomes a container, and its slots
 * are now the source of truth of its fields. A reader of a field gets a seat on the field node, thus an edit
 * of one field makes only its own readers dirty. An expansion of a derived node keeps the current fields.
 * The function does nothing for a container or for a value that is not a plain object.
 */
export const expandNode = (store: NodeStore, id: NodeId): void => {
  const s = state(store);
  const n = s.nodes.get(id);
  const value = n && isSome(n.value) ? n.value.value : undefined;
  if (n && n.slots.size === 0 && isPlainObject(value)) {
    const build = (owner: MutableNode, fields: Record<string, unknown>): void => {
      for (const [key, fieldValue] of Object.entries(fields)) {
        const sub = makeNode(freshId(s, `${owner.id}.${key}`), lit(fieldValue));
        sub.parent = owner.id;
        sub.value = some(fieldValue);
        insertNode(s, sub);
        owner.slots.set(key, sub.id);
        if (isPlainObject(fieldValue)) {
          build(sub, fieldValue);
          touchRecord(s, sub.id);
        }
      }
    };
    build(n, value);
    touchRecord(s, n.id);
    for (const r of n.seats) touch(s, r);
    for (const r of n.seatsStructural) touch(s, r);
  }
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
 * and runs one epoch in which each node evaluates one time in topological order. The operations keep the
 * store consistent, thus this function is a repair tool, and it never reverts a write.
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

/** The parent stops to own a former slot target when no other slot of the parent points at it. */
const releaseOwnership = (s: StoreState, parent: MutableNode, childId: NodeId): void => {
  const former = s.nodes.get(childId);
  if (!former || former.parent !== parent.id) return;
  for (const target of parent.slots.values()) if (target === childId) return;
  former.parent = undefined;
};

/** A container gives up its slots: the owned slot nodes are removed, and the shared ones are only released. */
const collapse = (s: StoreState, n: MutableNode): void => {
  const slots = [...n.slots.values()];
  n.slots.clear();
  for (const childId of slots) {
    const child = s.nodes.get(childId);
    if (!child) continue;
    if (child.parent === n.id) removeOwned(s, child);
  }
  for (const r of n.seatsStructural) touch(s, r);
};

/** This function removes a node and its owned slot subtree, and touches each reader that stays. */
const removeOwned = (s: StoreState, root: MutableNode): void => {
  const doomed: MutableNode[] = [];
  const doomedIds = new Set<NodeId>();
  const collect = (n: MutableNode): void => {
    if (doomedIds.has(n.id)) return;
    doomedIds.add(n.id);
    doomed.push(n);
    for (const childId of n.slots.values()) {
      const child = s.nodes.get(childId);
      if (child && child.parent === n.id) collect(child);
    }
  };
  collect(root);

  // The owner and each container that shares a removed node lose the slot
  const holders = new Set<NodeId>();
  if (root.parent !== undefined) holders.add(root.parent);
  for (const n of doomed) {
    for (const r of n.seats) holders.add(r);
    for (const r of n.seatsStructural) touch(s, r);
    for (const r of n.seats) touch(s, r);
  }
  for (const holderId of holders) {
    if (doomedIds.has(holderId)) continue;
    const holder = s.nodes.get(holderId);
    if (!holder) continue;
    for (const [name, target] of [...holder.slots]) {
      if (doomedIds.has(target)) {
        holder.slots.delete(name);
        touchRecord(s, holder.id);
        for (const r of holder.seatsStructural) touch(s, r);
      }
    }
  }

  for (const n of doomed) {
    for (const readerId of [...n.seats, ...n.seatsStructural]) s.nodes.get(readerId)?.seatedOn.delete(n.id);
    n.seats.clear();
    n.seatsStructural.clear();
  }
  for (const n of doomed) {
    unwireNode(s, n);
    s.nodes.delete(n.id);
  }
};
