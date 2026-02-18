import type { Biblo, InstanceId } from "@render/biblo";
import type { NodeStore } from "@render/node";
import type { Ops } from "@render/dsl";

/**
 * Context passed to a class's hydrate method.
 */
export type HydrateCtx = {
  readonly instanceId: InstanceId;
  readonly b: Biblo;
  readonly store: NodeStore;
  /** Recursively hydrate a value as a child — dispatches via classFor */
  readonly hydrate: (value: unknown, parentId: InstanceId) => void;
  /** Instantiate a specific class as a child (no type dispatch) */
  readonly instantiateChild: (className: string, parentId: InstanceId) => InstanceId;
};

/** Per-class hydrate method: populate children from a value */
export type HydrateFn = (ctx: HydrateCtx, value: unknown) => void;

/**
 * Context passed to a class's render method.
 */
export type RenderCtx<T> = {
  readonly instanceId: InstanceId;
  readonly classRef: string;
  readonly cells: Readonly<Record<string, unknown>>;
  readonly children: readonly InstanceId[];
  readonly renderChild: (childId: InstanceId) => T | undefined;
  /** Write a new value to a cell. Undefined in read-only mode. */
  readonly setCell?: ((cellName: string, value: unknown) => void) | undefined;
  /** Create a new child instance of the given class. Undefined in read-only mode. */
  readonly addChild?: ((className: string) => void) | undefined;
};

/** Per-class render method: produce output T */
export type RenderFn<T> = (ctx: RenderCtx<T>) => T;

/**
 * Mutation callback: given an instanceId and cell name, write a value.
 * Provided by the host (e.g. React app), not by the splay engine.
 */
export type MutateFn = (instanceId: InstanceId, cellName: string, value: unknown) => void;

/**
 * Structure mutation callback: create a child instance of className under parentId.
 * Provided by the host (e.g. React app), not by the splay engine.
 */
export type AddChildFn = (parentId: InstanceId, className: string) => void;

/**
 * SplayKit<T> — runtime config for a specific output type.
 *
 * Methods (hydrate, render, splash, etc.) live on the classes themselves
 * and resolve through the extends chain. The kit provides:
 * - classFor: value → class name dispatch
 * - ops: merged Ops for evaluating Expr-based render methods
 * - fallbackRender: default render for classes without one
 */
export type SplayKit<T> = {
  readonly classFor: (value: unknown) => string;
  /** Ops registry for evaluating Expr-based render methods */
  readonly ops: Ops;
  readonly fallbackRender?: RenderFn<T> | undefined;
};

export const splayKit = <T>(
  classFor: (value: unknown) => string,
  ops: Ops,
  fallbackRender?: RenderFn<T>,
): SplayKit<T> => ({
  classFor,
  ops,
  fallbackRender,
});
