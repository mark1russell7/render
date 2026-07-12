import type { Biblo, InstanceId, Instance } from "@render/biblo";
import type { NodeStore } from "@render/node";
import type { Expr } from "@render/dsl";
import type { SplayKit, HydrateFn, HydrateCtx, RenderCtx, RenderFn, MutateFn, AddChildFn, DehydrateCtx, DehydrateFn } from "./kit.js";
import type { EvalIssue } from "@render/dsl";
import { lit, evaluate, objectResolver } from "@render/dsl";
import { instantiate, registerClass, resolveMethods } from "@render/biblo";
import type { ComponentClass } from "@render/biblo";
import { isSome } from "@render/optional";

/**
 * Register an array of classes into biblo.
 */
export const registerClasses = (b: Biblo, classes: readonly ComponentClass[]): void => {
  for (const cls of classes) {
    registerClass(b, cls);
  }
};

/**
 * Hydrate: dispatch on value type, create instance, call class's hydrate method.
 * The hydration ops record is built ONCE per top-level call and shared
 * by the whole recursive descent.
 */
export const hydrate = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  value: unknown,
  parentId?: InstanceId,
): Instance => {
  const hydrateOps: Record<string, (...args: unknown[]) => unknown> = {
    ...kit.ops,
    /** Hydrate each item of an array as a child */
    hydrateItems: (items: unknown, pid: unknown) => {
      if (!Array.isArray(items)) return;
      for (const item of items) hydrateWith(kit, b, store, hydrateOps, item, pid as InstanceId);
    },
    /** Hydrate each entry of an object as KVP children */
    hydrateEntries: (obj: unknown, pid: unknown) => {
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const kvpId = instantiate(b, store, "KeyValuePair", pid as InstanceId).id;
        hydrateWith(kit, b, store, hydrateOps, k, kvpId);
        hydrateWith(kit, b, store, hydrateOps, v, kvpId);
      }
    },
  };
  return hydrateWith(kit, b, store, hydrateOps, value, parentId);
};

const hydrateWith = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  hydrateOps: Record<string, (...args: unknown[]) => unknown>,
  value: unknown,
  parentId?: InstanceId,
): Instance => {
  const className = kit.classFor(value);
  const inst = instantiate(b, store, className, parentId, { value: lit(value) });

  const methods = resolveMethods(b, className);
  const hydrateMethod = methods["hydrate"];

  if (isExpr(hydrateMethod)) {
    // Expr path: evaluate with the shared closure-captured hydration ops
    evaluate(hydrateMethod, objectResolver({ self: { value, instanceId: inst.id } }), hydrateOps);
  } else if (typeof hydrateMethod === "function") {
    // Function path: call directly (legacy)
    const ctx: HydrateCtx = {
      instanceId: inst.id,
      b,
      store,
      hydrate: (v, pid) => { hydrateWith(kit, b, store, hydrateOps, v, pid); },
      instantiateChild: (cls, pid) => instantiate(b, store, cls, pid).id,
    };
    (hydrateMethod as HydrateFn)(ctx, value);
  }

  return inst;
};

/** Check if a value is an Expr (has a tag field matching our IR) */
export const isExpr = (v: unknown): v is Expr =>
  v != null && typeof v === "object" && "tag" in v &&
  ((v as Expr).tag === "lit" || (v as Expr).tag === "ref" || (v as Expr).tag === "app");

/**
 * A splay memo: instanceId → rendered output. The host owns invalidation
 * (delete entries whose instances — or ancestors — participated in an
 * epoch; clear on structural change). A cache hit skips the whole
 * subtree, which also lets React bail out on identical elements.
 */
export type SplayCache<T> = Map<InstanceId, T | undefined>;

/**
 * Splay: recursively render an instance tree.
 *
 * Render method can be:
 * - A function (RenderFn<T>) → called with RenderCtx (legacy path)
 * - An Expr → evaluated with the DSL interpreter + kit.ops (new path)
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

  const methods = resolveMethods(b, inst.classRef);
  const renderMethod = methods["render"];

  const cells = readCells(store, inst.id);
  const renderChild = (childId: InstanceId): T | undefined =>
    splay(kit, b, store, childId, mutate, addChildFn, cache);
  const setCell = mutate
    ? (cellName: string, value: unknown) => { mutate(inst.id, cellName, value); }
    : undefined;
  const addChild = addChildFn
    ? (className: string) => { addChildFn(inst.id, className); }
    : undefined;

  const renderCtx: RenderCtx<T> = {
    instanceId: inst.id,
    classRef: inst.classRef,
    cells,
    children: inst.scope.children,
    renderChild,
    readChildCells: (childId: InstanceId) => readCells(store, childId),
    setCell,
    addChild,
  };

  let output: T | undefined;
  if (isExpr(renderMethod)) {
    // Expr path: evaluate with DSL interpreter
    const issues: EvalIssue[] = [];
    const result = evaluate(renderMethod, objectResolver({ self: renderCtx }), kit.ops, issues);
    output = isSome(result)
      ? result.value as T
      // Failed render: surface WHY through the fallback instead of blanking
      : kit.fallbackRender?.({ ...renderCtx, issues });
  } else {
    // Function path: call directly
    const renderer = (renderMethod as RenderFn<T> | undefined) ?? kit.fallbackRender;
    output = renderer ? renderer(renderCtx) : undefined;
  }

  cache?.set(instanceId, output);
  return output;
};

/**
 * Dehydrate: inverse of hydrate. Walk an instance tree and reconstruct
 * the original value.
 *
 * hydrate:   value → instance tree  (wrap)
 * dehydrate: instance tree → value  (unwrap)
 *
 * dehydrate is a CLASS METHOD (like hydrate/render), resolved through
 * the extends chain — subclasses inherit it, and the engine carries no
 * per-class knowledge. Classes without one dehydrate to their cells.
 */
export const dehydrate = (
  b: Biblo,
  store: NodeStore,
  instanceId: InstanceId,
): unknown => {
  const inst = b.instances.get(instanceId);
  if (!inst) return undefined;

  const cells = readCells(store, inst.id);
  const method = resolveMethods(b, inst.classRef)["dehydrate"];
  if (typeof method === "function") {
    const ctx: DehydrateCtx = {
      instanceId: inst.id,
      cells,
      children: inst.scope.children,
      dehydrateChild: (childId) => dehydrate(b, store, childId),
    };
    return (method as DehydrateFn)(ctx);
  }
  return cells;
};

/** Read cell values from an instance's root node slots */
export const readCells = (
  store: NodeStore,
  instanceId: InstanceId,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  const rootNode = store.nodes.get(instanceId);
  if (!rootNode) return result;

  for (const [name, slotId] of rootNode.slots) {
    const slotNode = store.nodes.get(slotId);
    if (slotNode && isSome(slotNode.value)) {
      result[name] = slotNode.value.value;
    }
  }
  return result;
};
