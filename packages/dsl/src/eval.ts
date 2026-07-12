import type { Expr } from "./ir.js";
import type { Optional } from "@render/optional";
import { some, none, isSome } from "@render/optional";

/** Map of operation names to implementation functions */
export type Ops = Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;

/**
 * Path resolver — how refs get their values.
 *
 * evaluate is parameterized over resolution so every layer supplies its
 * own semantics through ONE seam: plain objects (objectResolver), the
 * node store (deref through slots), or anything else. There is no
 * materialized "context object" — resolution is a call.
 */
export type Resolver = (path: readonly string[]) => Optional<unknown>;

/** Resolver over a plain nested object (synthetic scopes, tests) */
export const objectResolver = (ctx: unknown): Resolver => (path) => {
  let current: unknown = ctx;
  for (const segment of path) {
    if (current == null || typeof current !== "object") return none;
    const obj = current as Record<string, unknown>;
    if (!(segment in obj)) return none;
    current = obj[segment];
  }
  return some(current);
};

/** Evaluate an expression against a resolver and op registry */
export const evaluate = (expr: Expr, resolve: Resolver, ops: Ops): Optional<unknown> => {
  switch (expr.tag) {
    case "lit":
      return some(expr.value);
    case "ref":
      return resolve(expr.path);
    case "app": {
      const fn = ops[expr.op];
      if (!fn) return none;
      const resolved: unknown[] = [];
      for (const arg of expr.args) {
        const r = evaluate(arg, resolve, ops);
        if (!isSome(r)) return none;
        resolved.push(r.value);
      }
      try {
        return some(fn(...resolved));
      } catch {
        return none;
      }
    }
  }
};
