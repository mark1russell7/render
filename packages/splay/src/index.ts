import type { Biblo, InstanceId } from "@render/biblo";
import type { NodeStore } from "@render/node";
import { isSome } from "@render/optional";

/**
 * A render function receives a context and produces T.
 * T is the output medium — DOM nodes, canvas commands, strings, whatever.
 */
export type RenderFn<T> = (ctx: RenderCtx<T>) => T;

/**
 * The context given to each render function.
 *
 * - cells: resolved cell values for this instance (read from node store)
 * - children: this instance's child IDs (in order)
 * - renderChild: recursive dispatch — call this to render a child instance
 * - instanceId: the current instance's ID
 * - classRef: the current instance's class name
 */
export type RenderCtx<T> = {
  readonly instanceId: InstanceId;
  readonly classRef: string;
  readonly cells: Readonly<Record<string, unknown>>;
  readonly children: readonly InstanceId[];
  readonly renderChild: (childId: InstanceId) => T | undefined;
};

/**
 * A render kit maps class names to render functions.
 * Fallback handles any class without a specific renderer.
 */
export type RenderKit<T> = {
  readonly renderers: ReadonlyMap<string, RenderFn<T>>;
  readonly fallback?: RenderFn<T> | undefined;
};

export const renderKit = <T>(
  renderers: Record<string, RenderFn<T>>,
  fallback?: RenderFn<T>,
): RenderKit<T> => ({
  renderers: new Map(Object.entries(renderers)),
  fallback,
});

/**
 * Splay: recursively render an instance tree.
 *
 * Looks up the instance → finds the renderer for its class → calls it
 * with a context that includes cell values and a recursive renderChild.
 */
export const splay = <T>(
  kit: RenderKit<T>,
  b: Biblo,
  store: NodeStore,
  instanceId: InstanceId,
): T | undefined => {
  const inst = b.instances.get(instanceId);
  if (!inst) return undefined;

  const renderer = kit.renderers.get(inst.classRef) ?? kit.fallback;
  if (!renderer) return undefined;

  const cells = readCells(store, inst.id);
  const ctx: RenderCtx<T> = {
    instanceId: inst.id,
    classRef: inst.classRef,
    cells,
    children: inst.scope.children,
    renderChild: (childId) => splay(kit, b, store, childId),
  };

  return renderer(ctx);
};

/**
 * Read all cell values for an instance from the node store.
 * Walks the root node's slots, extracts resolved values.
 */
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

// Re-exports
export { standardClasses, Text, Num, Bool, KeyValuePair, VStack, HStack, Grid, HtmlElement } from "./classes.js";
export { standardOps } from "./ops.js";
export { classFor, hydrate } from "./hydrate.js";
