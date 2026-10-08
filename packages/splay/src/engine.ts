import type { Biblo, InstanceId, Instance } from "@render/biblo";
import { instantiate, resolveMethods } from "@render/biblo";
import type { NodeStore } from "@render/node";
import { batch } from "@render/node";
import type { EvalIssue, Ops } from "@render/dsl";
import { lit, evaluate, objectResolver, isExpr } from "@render/dsl";
import { isSome } from "@render/optional";
import type { SplayKit, HydrateFn, HydrateCtx, RenderCtx, RenderFn, MutateFn, AddChildFn, DehydrateCtx, DehydrateFn } from "./kit.ts";

/**
 * This function hydrates a value: it makes an instance tree from it. The `classFor` of the kit selects the
 * class of each value. The instance gets the value in its `value` cell, then the hydrate method of the class
 * makes the children. All nodes of the tree evaluate in one epoch at the end.
 */
export const hydrate = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  value: unknown,
  parentId?: InstanceId,
): Instance => {
  const hydrateOps: Ops = {
    ...kit.ops,
    /** This atom hydrates each item of an array as a child. */
    hydrateItems: (items: unknown, pid: unknown) => {
      if (!Array.isArray(items)) throw new TypeError("hydrateItems expects an array");
      for (const item of items) hydrateWith(kit, b, store, hydrateOps, item, String(pid));
    },
    /** This atom hydrates each field of an object as a `KeyValuePair` child. */
    hydrateEntries: (obj: unknown, pid: unknown) => {
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) throw new TypeError("hydrateEntries expects an object");
      for (const [k, v] of Object.entries(obj)) {
        const kvpId = instantiate(b, store, "KeyValuePair", String(pid)).id;
        hydrateWith(kit, b, store, hydrateOps, k, kvpId);
        hydrateWith(kit, b, store, hydrateOps, v, kvpId);
      }
    },
  };
  return batch(store, () => hydrateWith(kit, b, store, hydrateOps, value, parentId));
};

const hydrateWith = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  hydrateOps: Ops,
  value: unknown,
  parentId?: InstanceId,
): Instance => {
  const className = kit.classFor(value);
  const inst = instantiate(b, store, className, parentId, { value: lit(value) });
  const method = resolveMethods(b, className)["hydrate"];

  if (isExpr(method)) {
    evaluate(method, objectResolver({ self: { value, instanceId: inst.id } }), hydrateOps);
  } else if (typeof method === "function") {
    const ctx: HydrateCtx = {
      instanceId: inst.id,
      b,
      store,
      hydrate: (v, pid) => { hydrateWith(kit, b, store, hydrateOps, v, pid); },
      instantiateChild: (cls, pid) => instantiate(b, store, cls, pid).id,
    };
    (method as HydrateFn)(ctx, value);
  }
  return inst;
};

/**
 * The memo of splay: from an instance ID to its output. The host owns the invalidation: it deletes the
 * entries of the instances that changed (`invalidateSplay`) and clears the memo after a structural change.
 * A hit skips the full subtree, and React can then skip identical elements.
 */
export type SplayCache<T> = Map<InstanceId, T | undefined>;

/**
 * This function renders an instance tree to the output type `T`.
 *
 * The render method of the class is an `Expr` or a function. An `Expr` method reads the render context
 * as `ref("self", ...)` and uses the ops of the kit. When it gives `none`, the fallback of the kit renders
 * the instance with the causes, thus an error is visible and not a blank.
 */
export const splay = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  instanceId: InstanceId,
  mutate?: MutateFn,
  addChildFn?: AddChildFn,
  cache?: SplayCache<T>,
): T | undefined => {
  if (cache?.has(instanceId)) return cache.get(instanceId);

  const inst = b.instances.get(instanceId);
  if (!inst) return undefined;

  const renderMethod = resolveMethods(b, inst.classRef)["render"];
  const renderCtx: RenderCtx<T> = {
    instanceId: inst.id,
    classRef: inst.classRef,
    cells: readCells(store, inst.id),
    children: inst.scope.children,
    renderChild: (childId) => splay(kit, b, store, childId, mutate, addChildFn, cache),
    readChildCells: (childId) => readCells(store, childId),
    setCell: mutate ? (cellName, value) => { mutate(inst.id, cellName, value); } : undefined,
    addChild: addChildFn ? (className) => { addChildFn(inst.id, className); } : undefined,
  };

  let output: T | undefined;
  if (isExpr(renderMethod)) {
    const issues: EvalIssue[] = [];
    const result = evaluate(renderMethod, objectResolver({ self: renderCtx }), kit.ops, issues);
    output = isSome(result) ? (result.value as T) : kit.fallbackRender?.({ ...renderCtx, issues });
  } else if (typeof renderMethod === "function") {
    output = (renderMethod as RenderFn<T>)(renderCtx);
  } else {
    output = kit.fallbackRender?.(renderCtx);
  }

  cache?.set(instanceId, output);
  return output;
};

/**
 * This function deletes the memo entries of changed instances and of all their ancestors.
 * An ancestor holds the output of its children, thus it must render again too.
 */
export const invalidateSplay = <T>(b: Biblo, cache: SplayCache<T>, changed: Iterable<InstanceId>): void => {
  for (const start of changed) {
    let id: InstanceId | undefined = start;
    for (let guard = 0; id !== undefined && guard < 10_000; guard++) {
      cache.delete(id);
      id = b.instances.get(id)?.scope.parent;
    }
  }
};

/**
 * This function dehydrates an instance tree: it gives the value back (the inverse of `hydrate`).
 * Dehydrate is a class method, which the extends chain resolves. A class without one gives its cells.
 */
export const dehydrate = (b: Biblo, store: NodeStore, instanceId: InstanceId): unknown => {
  const inst = b.instances.get(instanceId);
  if (!inst) return undefined;

  const cells = readCells(store, inst.id);
  const method = resolveMethods(b, inst.classRef)["dehydrate"];
  if (typeof method !== "function") return cells;
  const ctx: DehydrateCtx = {
    instanceId: inst.id,
    cells,
    children: inst.scope.children,
    dehydrateChild: (childId) => dehydrate(b, store, childId),
  };
  return (method as DehydrateFn)(ctx);
};

/** This function reads the values of the cells of an instance. A cell with a `none` value is not in the record. */
export const readCells = (store: NodeStore, instanceId: InstanceId): Readonly<Record<string, unknown>> => {
  const result: Record<string, unknown> = {};
  const root = store.nodes.get(instanceId);
  if (!root) return result;
  for (const [name, slotId] of root.slots) {
    const slot = store.nodes.get(slotId);
    if (slot && isSome(slot.value)) result[name] = slot.value.value;
  }
  return result;
};
