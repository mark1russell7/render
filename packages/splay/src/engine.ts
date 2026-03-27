import type { Biblo, InstanceId, Instance } from "@render/biblo";
import type { NodeStore } from "@render/node";
import type { Expr } from "@render/dsl";
import type { SplayKit, HydrateFn, HydrateCtx, RenderCtx, RenderFn, MutateFn, AddChildFn } from "./kit.js";
import { lit, evaluate } from "@render/dsl";
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
 */
export const hydrate = <T>(
  kit: SplayKit<T>,
  b: Biblo,
  store: NodeStore,
  value: unknown,
  parentId?: InstanceId,
): Instance => {
  const className = kit.classFor(value);
  const inst = instantiate(b, store, className, parentId, { value: lit(value) });

  const methods = resolveMethods(b, className);
  const hydrateMethod = methods["hydrate"];

  if (isExpr(hydrateMethod)) {
    // Expr path: evaluate with closure-captured hydration ops
    const hydrateOps: Record<string, (...args: unknown[]) => unknown> = {
      ...kit.ops,
      /** Hydrate each item of an array as a child */
      hydrateItems: (items: unknown, pid: unknown) => {
        if (!Array.isArray(items)) return;
        for (const item of items) hydrate(kit, b, store, item, pid as InstanceId);
      },
      /** Hydrate each entry of an object as KVP children */
      hydrateEntries: (obj: unknown, pid: unknown) => {
        if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          const kvpId = instantiate(b, store, "KeyValuePair", pid as InstanceId).id;
          hydrate(kit, b, store, k, kvpId);
          hydrate(kit, b, store, v, kvpId);
        }
      },
    };
    evaluate(hydrateMethod, { self: { value, instanceId: inst.id } }, hydrateOps);
  } else if (typeof hydrateMethod === "function") {
    // Function path: call directly (legacy)
    const ctx: HydrateCtx = {
      instanceId: inst.id,
      b,
      store,
      hydrate: (v, pid) => { hydrate(kit, b, store, v, pid); },
      instantiateChild: (cls, pid) => instantiate(b, store, cls, pid).id,
    };
    (hydrateMethod as HydrateFn)(ctx, value);
  }

  return inst;
};

/** Check if a value is an Expr (has a tag field matching our IR) */
const isExpr = (v: unknown): v is Expr =>
  v != null && typeof v === "object" && "tag" in v &&
  ((v as Expr).tag === "lit" || (v as Expr).tag === "ref" || (v as Expr).tag === "app");

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
): T | undefined => {
  const inst = b.instances.get(instanceId);
  if (!inst) return undefined;

  const methods = resolveMethods(b, inst.classRef);
  const renderMethod = methods["render"];

  const cells = readCells(store, inst.id);
  const renderChild = (childId: InstanceId): T | undefined =>
    splay(kit, b, store, childId, mutate, addChildFn);
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
    setCell,
    addChild,
  };

  // Expr path: evaluate with DSL interpreter
  if (isExpr(renderMethod)) {
    const result = evaluate(renderMethod, { self: renderCtx }, kit.ops);
    return isSome(result) ? result.value as T : undefined;
  }

  // Function path: call directly
  const renderer = (renderMethod as RenderFn<T> | undefined) ?? kit.fallbackRender;
  if (!renderer) return undefined;

  return renderer(renderCtx);
};

/**
 * Dehydrate: inverse of hydrate. Walk an instance tree and reconstruct
 * the original value.
 *
 * hydrate:   value → instance tree  (wrap)
 * dehydrate: instance tree → value  (unwrap)
 */
export const dehydrate = (
  b: Biblo,
  store: NodeStore,
  instanceId: InstanceId,
): unknown => {
  const inst = b.instances.get(instanceId);
  if (!inst) return undefined;

  const cells = readCells(store, inst.id);

  switch (inst.classRef) {
    case "Text":
    case "Num":
    case "Bool":
      return cells["value"];

    case "VStack":
    case "HStack":
      return inst.scope.children.map((id) => dehydrate(b, store, id));

    case "Grid": {
      const obj: Record<string, unknown> = {};
      for (const childId of inst.scope.children) {
        const child = b.instances.get(childId);
        if (child?.classRef === "KeyValuePair") {
          const [keyId, valId] = child.scope.children;
          const key = keyId != null ? dehydrate(b, store, keyId) : undefined;
          const val = valId != null ? dehydrate(b, store, valId) : undefined;
          if (typeof key === "string") obj[key] = val;
        }
      }
      return obj;
    }

    case "KeyValuePair": {
      const [keyId, valId] = inst.scope.children;
      return [
        keyId != null ? dehydrate(b, store, keyId) : undefined,
        valId != null ? dehydrate(b, store, valId) : undefined,
      ];
    }

    case "ExprLit":
    case "ExprRef":
      return cells["value"];

    case "ExprApp": {
      const exprObj = cells["value"] as { tag: "app"; op: string };
      return {
        tag: "app",
        op: exprObj.op,
        args: inst.scope.children.map(childId => dehydrate(b, store, childId)),
      };
    }

    default:
      return cells;
  }
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
