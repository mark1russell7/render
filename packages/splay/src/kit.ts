import type { Biblo, InstanceId } from "@render/biblo";
import type { NodeStore } from "@render/node";

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
};

/** Per-class render method: produce output T */
export type RenderFn<T> = (ctx: RenderCtx<T>) => T;

/**
 * SplayKit<T> — minimal runtime config.
 *
 * Methods (hydrate, render, splash, etc.) live on the classes themselves
 * and resolve through the extends chain. The kit just provides:
 * - classFor: value → class name dispatch
 * - fallbackRender: default render for classes without one
 */
export type SplayKit<T> = {
  readonly classFor: (value: unknown) => string;
  readonly fallbackRender?: RenderFn<T> | undefined;
};

export const splayKit = <T>(
  classFor: (value: unknown) => string,
  fallbackRender?: RenderFn<T>,
): SplayKit<T> => ({
  classFor,
  fallbackRender,
});
