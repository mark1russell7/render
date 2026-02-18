import type { Biblo, InstanceId, Instance } from "@render/biblo";
import type { NodeStore } from "@render/node";
import type { Expr } from "@render/dsl";
import type { SplayKit, HydrateFn, HydrateCtx, RenderFn, MutateFn, AddChildFn } from "./kit.js";
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
  const hydrateFn = methods["hydrate"] as HydrateFn | undefined;
  if (hydrateFn) {
    const ctx: HydrateCtx = {
      instanceId: inst.id,
      b,
      store,
      hydrate: (v, pid) => { hydrate(kit, b, store, v, pid); },
      instantiateChild: (cls, pid) => instantiate(b, store, cls, pid).id,
    };
    hydrateFn(ctx, value);
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

  // Expr path: evaluate with DSL interpreter
  if (isExpr(renderMethod)) {
    const ctx = {
      self: {
        instanceId: inst.id,
        classRef: inst.classRef,
        cells,
        children: inst.scope.children,
        renderChild,
        setCell,
        addChild,
      },
    };
    const result = evaluate(renderMethod, ctx, kit.ops);
    return isSome(result) ? result.value as T : undefined;
  }

  // Function path: call directly
  const renderer = (renderMethod as RenderFn<T> | undefined) ?? kit.fallbackRender;
  if (!renderer) return undefined;

  return renderer({
    instanceId: inst.id,
    classRef: inst.classRef,
    cells,
    children: inst.scope.children,
    renderChild,
    setCell,
    addChild,
  });
};

/** Read cell values from an instance's root node slots */
const readCells = (
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
