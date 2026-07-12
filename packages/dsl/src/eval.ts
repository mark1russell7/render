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

/**
 * Why an evaluation produced none. Collected (optionally) instead of
 * thrown, so evaluation stays total but failures carry provenance —
 * a blank subtree can say WHY it's blank.
 */
export type EvalIssue = {
  readonly code: "unknown-op" | "path-miss" | "arg-none" | "op-threw" | "bad-form";
  readonly op?: string;
  readonly path?: readonly string[];
  readonly message?: string;
};

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

/**
 * Special forms — evaluated lazily inside the interpreter, before op
 * lookup (an op with the same name is shadowed):
 *
 *   if(cond, then, else)  — only the selected branch evaluates
 *   and(a, b, ...)        — short-circuits on the first falsy value
 *   or(a, b, ...)         — short-circuits on the first truthy value
 *   fn(lit([params]), body) — a lambda: evaluates to a JS closure whose
 *     body sees params through the resolver; makes `map` usable from
 *     pure Exprs. Param refs resolve like paths: ref("x") or ref("x","field").
 */
const evaluateSpecialForm = (
  expr: Extract<Expr, { tag: "app" }>,
  resolve: Resolver,
  ops: Ops,
  issues: EvalIssue[] | undefined,
): Optional<unknown> | null => {
  switch (expr.op) {
    case "if": {
      const [condE, thenE, elseE] = expr.args;
      if (!condE) {
        issues?.push({ code: "bad-form", op: "if", message: "if(cond, then, else?)" });
        return none;
      }
      const cond = evaluate(condE, resolve, ops, issues);
      if (!isSome(cond)) return none;
      const branch = cond.value ? thenE : elseE;
      return branch ? evaluate(branch, resolve, ops, issues) : some(undefined);
    }
    case "and": {
      let last: unknown = true;
      for (const arg of expr.args) {
        const r = evaluate(arg, resolve, ops, issues);
        if (!isSome(r)) return none;
        if (!r.value) return some(r.value);
        last = r.value;
      }
      return some(last);
    }
    case "or": {
      let last: unknown = false;
      for (const arg of expr.args) {
        const r = evaluate(arg, resolve, ops, issues);
        if (!isSome(r)) return none;
        if (r.value) return some(r.value);
        last = r.value;
      }
      return some(last);
    }
    case "fn": {
      const [paramsE, body] = expr.args;
      if (!paramsE || !body || paramsE.tag !== "lit" || !Array.isArray(paramsE.value)) {
        issues?.push({ code: "bad-form", op: "fn", message: "fn(lit([...params]), body)" });
        return none;
      }
      const params = (paramsE.value as unknown[]).map(String);
      const closure = (...args: readonly unknown[]): unknown => {
        const frame: Record<string, unknown> = {};
        params.forEach((p, i) => { frame[p] = args[i]; });
        const frameResolver = objectResolver(frame);
        const extended: Resolver = (path) => {
          const head = path[0];
          if (head !== undefined && head in frame) return frameResolver(path);
          return resolve(path);
        };
        const r = evaluate(body, extended, ops, issues);
        return isSome(r) ? r.value : undefined;
      };
      return some(closure);
    }
    default:
      return null; // not a special form
  }
};

/**
 * Evaluate an expression against a resolver and op registry.
 * Total: failures return none; pass `issues` to learn why.
 */
export const evaluate = (
  expr: Expr,
  resolve: Resolver,
  ops: Ops,
  issues?: EvalIssue[],
): Optional<unknown> => {
  switch (expr.tag) {
    case "lit":
      return some(expr.value);
    case "ref": {
      const r = resolve(expr.path);
      if (!isSome(r)) issues?.push({ code: "path-miss", path: expr.path });
      return r;
    }
    case "app": {
      const special = evaluateSpecialForm(expr, resolve, ops, issues);
      if (special !== null) return special;

      const fn = ops[expr.op];
      if (!fn) {
        issues?.push({ code: "unknown-op", op: expr.op });
        return none;
      }
      const resolved: unknown[] = [];
      for (const arg of expr.args) {
        const r = evaluate(arg, resolve, ops, issues);
        if (!isSome(r)) {
          issues?.push({ code: "arg-none", op: expr.op });
          return none;
        }
        resolved.push(r.value);
      }
      try {
        return some(fn(...resolved));
      } catch (e) {
        issues?.push({ code: "op-threw", op: expr.op, message: e instanceof Error ? e.message : String(e) });
        return none;
      }
    }
  }
};
