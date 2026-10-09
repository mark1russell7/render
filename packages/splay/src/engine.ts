import type { Biblo, InstanceId, Instance } from "@render/biblo";
import { destroyInstance, instantiate, moveChild, resolveMethods } from "@render/biblo";
import type { NodeStore } from "@render/node";
import { batch, setValue } from "@render/node";
import type { EvalIssue, Ops } from "@render/dsl";
import { lit, evaluate, objectResolver, isExpr, exprEquals } from "@render/dsl";
import { isSome } from "@render/optional";
import type {
  SplayCache, SplayKit, SplayOptions, HydrateFn, HydrateCtx, RenderCtx, RenderFn, DehydrateCtx, DehydrateFn, ViewPolicy,
} from "./kit.ts";

/** This function gives the ops of hydration: the ops of the kit, with the atoms that make children. */
const hydrateOpsFor = <T>(kit: SplayKit<T>, b: Biblo, store: NodeStore): Ops => {
  const ops: Ops = {
    ...kit.ops,
    /** This atom hydrates each item of an array as a child. */
    hydrateItems: (items: unknown, pid: unknown) => {
      if (!Array.isArray(items)) throw new TypeError("hydrateItems expects an array");
      for (const item of items) hydrateWith(kit, b, store, ops, item, String(pid));
    },
    /** This atom hydrates each field of an object as a `KeyValuePair` child. */
    hydrateEntries: (obj: unknown, pid: unknown) => {
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) throw new TypeError("hydrateEntries expects an object");
      for (const [k, v] of Object.entries(obj)) {
        const kvpId = instantiate(b, store, "KeyValuePair", String(pid)).id;
        hydrateWith(kit, b, store, ops, k, kvpId);
        hydrateWith(kit, b, store, ops, v, kvpId);
      }
    },
  };
  return ops;
};

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
): Instance => hydrateAs(kit, b, store, kit.classFor(value), value, parentId);

/**
 * This function hydrates a value with a named class at the root. The `classFor` of the kit selects the classes
 * of the children. An example is a class card of the viewer: a `ClassDef` at the root, and plain data below it.
 */
export const hydrateAs = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  className: string,
  value: unknown,
  parentId?: InstanceId,
): Instance => {
  const ops = hydrateOpsFor(kit, b, store);
  return batch(store, () => hydrateWith(kit, b, store, ops, value, parentId, className));
};

const hydrateWith = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  ops: Ops,
  value: unknown,
  parentId?: InstanceId,
  className: string = kit.classFor(value),
): Instance => {
  const inst = instantiate(b, store, className, parentId, { value: lit(value) });
  runHydrate(kit, b, store, ops, inst.id, className, value);
  return inst;
};

/** This function applies the hydrate method of a class to an instance and a value. */
const runHydrate = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  ops: Ops,
  instanceId: InstanceId,
  className: string,
  value: unknown,
): void => {
  const method = resolveMethods(b, className)["hydrate"];
  if (isExpr(method)) {
    evaluate(method, objectResolver({ self: { value, instanceId } }), ops);
  } else if (typeof method === "function") {
    const ctx: HydrateCtx = {
      instanceId,
      b,
      store,
      hydrate: (v, pid) => { hydrateWith(kit, b, store, ops, v, pid); },
      instantiateChild: (cls, pid) => instantiate(b, store, cls, pid).id,
    };
    (method as HydrateFn)(ctx, value);
  }
};

/** This function tells if a parent holds a child instance in one of its cells (a typed cell). */
const inSlot = (store: NodeStore, parentId: InstanceId | undefined, childId: InstanceId): boolean => {
  if (parentId === undefined) return false;
  for (const slot of store.nodes.get(parentId)?.slots.values() ?? []) if (slot === childId) return true;
  return false;
};

/**
 * This function gives an instance a new value in place. The instance keeps its ID and its class, and its
 * `value` cell gets the new value. The instances in its cells stay.
 *
 * When the class has a hydrate method, the children that it made go, and it makes the new children. A class
 * without a hydrate method keeps its children, because they do not come from the value. The function gives
 * `undefined` for a missing instance.
 */
export const rehydrate = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  instanceId: InstanceId,
  value: unknown,
): Instance | undefined => {
  const inst = b.instances.get(instanceId);
  if (!inst) return undefined;
  const ops = hydrateOpsFor(kit, b, store);
  const derived = resolveMethods(b, inst.classRef)["hydrate"] !== undefined;
  batch(store, () => {
    if (derived) {
      for (const childId of inst.scope.children.slice()) {
        if (!inSlot(store, instanceId, childId)) destroyInstance(b, store, childId);
      }
    }
    const valueSlot = store.nodes.get(instanceId)?.slots.get("value");
    if (valueSlot !== undefined && (store.nodes.get(valueSlot)?.slots.size ?? 0) === 0) setValue(store, valueSlot, value);
    runHydrate(kit, b, store, ops, instanceId, inst.classRef, value);
  });
  return inst;
};

/**
 * This function replaces the value of an instance with a new subtree. The `classFor` of the kit selects the
 * class of the new value. The new instance takes the place of the old one among the children of its parent.
 *
 * Two kinds of instance keep their ID and their class, because the function rehydrates them in place.
 * One kind has the class of the new value. The other kind is in a cell of its parent.
 * The function gives the instance that holds the value, or `undefined` for a missing instance.
 */
export const replaceValue = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  instanceId: InstanceId,
  value: unknown,
): Instance | undefined => {
  const inst = b.instances.get(instanceId);
  if (!inst) return undefined;
  const parentId = inst.scope.parent;
  if (kit.classFor(value) === inst.classRef || inSlot(store, parentId, instanceId)) {
    return rehydrate(kit, b, store, instanceId, value);
  }
  const index = parentId === undefined ? -1 : (b.instances.get(parentId)?.scope.children.indexOf(instanceId) ?? -1);
  const ops = hydrateOpsFor(kit, b, store);
  return batch(store, () => {
    destroyInstance(b, store, instanceId);
    const next = hydrateWith(kit, b, store, ops, value, parentId);
    if (index >= 0) moveChild(b, next.id, index);
    return next;
  });
};

/**
 * This function makes a view policy. An instance at a level below `levels` is expanded, and the other
 * collapsible instances show their summary. The overrides (an instance ID and its state) have precedence.
 * With overrides, the policy can change: `setExpanded` writes an override, then it tells `onChange`.
 */
export const viewPolicy = (
  levels: number,
  overrides?: Map<InstanceId, boolean>,
  onChange?: (instanceId: InstanceId, expanded: boolean) => void,
): ViewPolicy => ({
  isExpanded: (id, level) => overrides?.get(id) ?? level < levels,
  setExpanded: overrides === undefined
    ? undefined
    : (id, expanded) => {
        overrides.set(id, expanded);
        onChange?.(id, expanded);
      },
});

/**
 * This function tells if a class has a summary that differs from its render. Only such an instance can
 * collapse. A class that gives its render as its summary, for example `Text`, shows the same view at each level.
 */
const isCollapsible = (render: unknown, summary: unknown): boolean =>
  summary !== undefined && summary !== render && !(isExpr(summary) && isExpr(render) && exprEquals(summary, render));

/**
 * This function renders an instance tree to the output type `T`.
 *
 * The render method of the class is an `Expr` or a function. An `Expr` method reads the render context
 * as `ref("self", ...)` and uses the ops of the kit. When it gives `none`, the fallback of the kit renders
 * the instance with the causes, thus an error is visible and not a blank.
 *
 * Level of detail: a class can have a `summary` method, built with the same builder as its render. With a
 * view policy in the options, a collapsed instance renders its summary, and an expanded instance renders its
 * full view. Without a view policy, each instance renders its full view.
 */
export const splay = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  instanceId: InstanceId,
  options: SplayOptions<T> = {},
): T | undefined => splayAt(kit, b, store, instanceId, options, 0);

const splayAt = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  instanceId: InstanceId,
  options: SplayOptions<T>,
  level: number,
): T | undefined => {
  const { cache, view, mutate, addChild, replace } = options;
  if (cache?.has(instanceId)) return cache.get(instanceId);

  const inst = b.instances.get(instanceId);
  if (!inst) return undefined;

  const methods = resolveMethods(b, inst.classRef);
  const render = methods["render"];
  const summary = methods["summary"];
  const collapsible = isCollapsible(render, summary);
  const expanded = !collapsible || view === undefined || view.isExpanded(inst.id, level);
  const childLevel = collapsible ? level + 1 : level;
  const setExpanded = view?.setExpanded;

  const ctx: RenderCtx<T> = {
    instanceId: inst.id,
    classRef: inst.classRef,
    cells: readCells(store, inst.id),
    children: inst.scope.children,
    renderChild: (childId) => splayAt(kit, b, store, childId, options, childLevel),
    readChildCells: (childId) => readCells(store, childId),
    dehydrate: () => dehydrate(b, store, inst.id),
    detail: expanded ? "full" : "summary",
    collapsible,
    level,
    toggle: collapsible && setExpanded !== undefined ? () => { setExpanded(inst.id, !expanded); } : undefined,
    setCell: mutate ? (cellName, value) => { mutate(inst.id, cellName, value); } : undefined,
    addChild: addChild ? (className) => { addChild(inst.id, className); } : undefined,
    replace: replace ? (value) => { replace(inst.id, value); } : undefined,
  };

  const method = expanded ? render : summary;
  let output: T | undefined;
  if (isExpr(method)) {
    const issues: EvalIssue[] = [];
    const result = evaluate(method, objectResolver({ self: ctx }), kit.ops, issues);
    output = isSome(result) ? (result.value as T) : kit.fallbackRender?.({ ...ctx, issues });
  } else if (typeof method === "function") {
    output = (method as RenderFn<T>)(ctx);
  } else {
    output = kit.fallbackRender?.(ctx);
  }
  if (collapsible && kit.frame) output = kit.frame(ctx, output);

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
