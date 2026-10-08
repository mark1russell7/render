import type { Biblo, InstanceId } from "@render/biblo";
import type { NodeStore } from "@render/node";
import type { Ops, EvalIssue } from "@render/dsl";

/** The context of a hydrate method that is a function. */
export type HydrateCtx = {
  readonly instanceId: InstanceId;
  readonly b: Biblo;
  readonly store: NodeStore;
  /** This function hydrates a value as a child. The `classFor` of the kit selects its class. */
  readonly hydrate: (value: unknown, parentId: InstanceId) => void;
  /** This function makes a child instance of a named class, without the dispatch of `classFor`. */
  readonly instantiateChild: (className: string, parentId: InstanceId) => InstanceId;
};

/** A hydrate method that is a function: it makes the children of an instance from a value. */
export type HydrateFn = (ctx: HydrateCtx, value: unknown) => void;

/** The context of a render method. An `Expr` render method reads it as `ref("self", ...)`. */
export type RenderCtx<T> = {
  readonly instanceId: InstanceId;
  readonly classRef: string;
  /** The values of the cells. A cell with a `none` value is not in the record. */
  readonly cells: Readonly<Record<string, unknown>>;
  readonly children: readonly InstanceId[];
  readonly renderChild: (childId: InstanceId) => T | undefined;
  /** This function reads the cells of a child instance, for example for a style that depends on the content. */
  readonly readChildCells: (childId: InstanceId) => Readonly<Record<string, unknown>>;
  /** This function writes a value to a cell. It is `undefined` in the read-only mode. */
  readonly setCell?: ((cellName: string, value: unknown) => void) | undefined;
  /** This function makes a child instance of a class. It is `undefined` in the read-only mode. */
  readonly addChild?: ((className: string) => void) | undefined;
  /** The causes of the failure, when an `Expr` render method gave `none`. */
  readonly issues?: readonly EvalIssue[] | undefined;
};

/** A render method that is a function: it gives the output of an instance. */
export type RenderFn<T> = (ctx: RenderCtx<T>) => T;

/**
 * The context of a dehydrate method. Dehydrate is a class method like hydrate and render,
 * thus the engine has no knowledge of a specific class. Each class knows how to unwrap itself.
 */
export type DehydrateCtx = {
  readonly instanceId: InstanceId;
  readonly cells: Readonly<Record<string, unknown>>;
  readonly children: readonly InstanceId[];
  readonly dehydrateChild: (childId: InstanceId) => unknown;
};

/** A dehydrate method: it gives the original value of an instance. */
export type DehydrateFn = (ctx: DehydrateCtx) => unknown;

/** The callback of a cell write. The host gives it, for example the React app. */
export type MutateFn = (instanceId: InstanceId, cellName: string, value: unknown) => void;

/** The callback of a structural change: make a child instance of a class under a parent. The host gives it. */
export type AddChildFn = (parentId: InstanceId, className: string) => void;

/**
 * The configuration of one output type `T`.
 *
 * The methods (hydrate, render, dehydrate) are on the classes, and the extends chain resolves them.
 * The kit gives the rest:
 * - `classFor`: the dispatch from a value to a class name.
 * - `ops`: the op registry of `Expr` methods, with the output atoms.
 * - `fallbackRender`: the render of a class without a render method, and of a failed render.
 */
export type SplayKit<T> = {
  readonly classFor: (value: unknown) => string;
  readonly ops: Ops;
  readonly fallbackRender?: RenderFn<T> | undefined;
};

/** This function makes a kit. */
export const splayKit = <T>(
  classFor: (value: unknown) => string,
  ops: Ops,
  fallbackRender?: RenderFn<T>,
): SplayKit<T> => ({
  classFor,
  ops,
  fallbackRender,
});
