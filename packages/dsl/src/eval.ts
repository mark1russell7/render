import type { Expr } from "./ir.js";
import type { Optional } from "@render/optional";
import { some, none, isSome } from "@render/optional";

/** Map of operation names to implementation functions */
export type Ops = Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;

/** Walk a path through a nested context, returning the value at the end */
const walkPath = (ctx: unknown, path: readonly string[]): Optional<unknown> => {
  let current: unknown = ctx;
  for (const segment of path) {
    if (current == null || typeof current !== "object") return none;
    const obj = current as Record<string, unknown>;
    if (!(segment in obj)) return none;
    current = obj[segment];
  }
  return some(current);
};

/** Evaluate an expression against a nested context and op registry */
export const evaluate = (expr: Expr, ctx: unknown, ops: Ops): Optional<unknown> => {
  switch (expr.tag) {
    case "lit":
      return some(expr.value);
    case "ref":
      return walkPath(ctx, expr.path);
    case "app": {
      const fn = ops[expr.op];
      if (!fn) return none;
      const resolved: unknown[] = [];
      for (const arg of expr.args) {
        const r = evaluate(arg, ctx, ops);
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
