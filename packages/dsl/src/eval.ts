import type { Expr } from "./ir.ts";
import type { Optional } from "@render/optional";
import { some, none, isSome } from "@render/optional";

/** The op registry: a map from op names to functions. The interpreter reads only the own properties. */
export type Ops = Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;

/**
 * A path resolver: it gives the value of a reference.
 *
 * The interpreter takes resolution as a parameter. Thus each layer gives its own semantics through one seam:
 * plain objects (`objectResolver`), the node store (`storeResolver` of `@render/node`) or other sources.
 */
export type Resolver = (path: readonly string[]) => Optional<unknown>;

/**
 * The cause of a `none` result.
 *
 * The interpreter collects issues when the caller gives an array. Evaluation stays total, and each failure has a cause.
 * - `unknown-op`: the registry has no op with this name.
 * - `path-miss`: the resolver has no value at the path.
 * - `arg-none`: an argument of the op gave `none`.
 * - `op-threw`: the op threw an error. The message of the error is in `message`.
 * - `bad-form`: a special form has incorrect arguments.
 * - `bad-expr`: a node of the tree is not a valid expression.
 */
export type EvalIssue = {
  readonly code: "unknown-op" | "path-miss" | "arg-none" | "op-threw" | "bad-form" | "bad-expr";
  readonly op?: string;
  readonly path?: readonly string[];
  readonly message?: string;
};

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/**
 * This function makes a resolver over a plain nested object. The resolver reads only own properties,
 * thus a path such as `["constructor"]` does not find a value of `Object.prototype`.
 */
export const objectResolver = (ctx: unknown): Resolver => (path) => {
  let current: unknown = ctx;
  for (const segment of path) {
    if (current === null || typeof current !== "object" || !hasOwn(current, segment)) return none;
    current = (current as Record<string, unknown>)[segment];
  }
  return some(current);
};

/** The names of the special forms. The interpreter evaluates them before it looks for an op. */
export const specialForms: readonly string[] = ["if", "and", "or", "fn", "record"];

type AppNode = Extract<Expr, { tag: "app" }>;

/**
 * The special forms. The interpreter evaluates their arguments lazily, and an op with the same name has no effect.
 *
 * - `if(cond, then, else?)`: only the selected branch is evaluated.
 * - `and(a, b, ...)` and `or(a, b, ...)`: the evaluation stops at the first false value or true value.
 * - `fn(lit([...params]), body)`: a lambda. The result is a function. Its body reads the parameters through the resolver.
 * - `record(k1, v1, k2, v2, ...)`: an object. A field with a `none` value is not in the object.
 */
const evaluateSpecialForm = (
  expr: AppNode,
  resolve: Resolver,
  ops: Ops,
  issues: EvalIssue[] | undefined,
): Optional<unknown> | null => {
  switch (expr.op) {
    case "if": {
      const [condE, thenE, elseE] = expr.args;
      if (!condE || expr.args.length > 3) {
        issues?.push({ code: "bad-form", op: "if", message: "if(cond, then, else?)" });
        return none;
      }
      const cond = evaluate(condE, resolve, ops, issues);
      if (!isSome(cond)) return none;
      const branch = cond.value ? thenE : elseE;
      return branch ? evaluate(branch, resolve, ops, issues) : some(undefined);
    }
    case "and":
    case "or": {
      const stopOn = expr.op === "or";
      let last: unknown = !stopOn;
      for (const arg of expr.args) {
        const r = evaluate(arg, resolve, ops, issues);
        if (!isSome(r)) return none;
        if (Boolean(r.value) === stopOn) return r;
        last = r.value;
      }
      return some(last);
    }
    case "fn": {
      const [paramsE, body] = expr.args;
      if (!paramsE || !body || expr.args.length !== 2 || paramsE.tag !== "lit" || !Array.isArray(paramsE.value)) {
        issues?.push({ code: "bad-form", op: "fn", message: "fn(lit([...params]), body)" });
        return none;
      }
      const params = (paramsE.value as readonly unknown[]).map(String);
      const closure = (...args: readonly unknown[]): unknown => {
        const frame = new Map<string, unknown>();
        params.forEach((p, i) => { frame.set(p, args[i]); });
        const extended: Resolver = (path) => {
          const head = path[0];
          if (head === undefined || !frame.has(head)) return resolve(path);
          return objectResolver(frame.get(head))(path.slice(1));
        };
        const r = evaluate(body, extended, ops, issues);
        return isSome(r) ? r.value : undefined;
      };
      return some(closure);
    }
    case "record": {
      if (expr.args.length % 2 !== 0) {
        issues?.push({ code: "bad-form", op: "record", message: "record(k1, v1, k2, v2, ...)" });
        return none;
      }
      const entries: [string, unknown][] = [];
      for (let i = 0; i < expr.args.length; i += 2) {
        const k = evaluate(expr.args[i]!, resolve, ops, issues);
        if (!isSome(k) || (typeof k.value !== "string" && typeof k.value !== "number")) {
          issues?.push({ code: "bad-form", op: "record", message: "a field name is not a string" });
          return none;
        }
        const v = evaluate(expr.args[i + 1]!, resolve, ops, issues);
        if (isSome(v)) entries.push([String(k.value), v.value]);
      }
      // fromEntries makes own data properties, thus a field "__proto__" does not change the prototype
      return some(Object.fromEntries(entries));
    }
    default:
      return null;
  }
};

const badExpr = (issues: EvalIssue[] | undefined, message: string): Optional<unknown> => {
  issues?.push({ code: "bad-expr", message });
  return none;
};

/**
 * This function evaluates an expression with a resolver and an op registry.
 *
 * The evaluation is total: a failure gives `none` and does not throw. This is also true for a malformed tree,
 * for example data from an edit. Give `issues` to collect the cause of each `none`.
 */
export const evaluate = (
  expr: Expr,
  resolve: Resolver,
  ops: Ops,
  issues?: EvalIssue[],
): Optional<unknown> => {
  const e = expr as Partial<Record<"tag" | "path" | "op" | "args", unknown>> | null | undefined;
  if (e === null || typeof e !== "object") return badExpr(issues, `not an expression: ${String(e)}`);
  switch (e.tag) {
    case "lit":
      return some((expr as Extract<Expr, { tag: "lit" }>).value);
    case "ref": {
      if (!Array.isArray(e.path)) return badExpr(issues, "a ref without a path");
      const path = e.path as readonly string[];
      const r = resolve(path);
      if (!isSome(r)) issues?.push({ code: "path-miss", path });
      return r;
    }
    case "app": {
      if (typeof e.op !== "string" || !Array.isArray(e.args)) return badExpr(issues, "an app without an op or args");
      const node = expr as AppNode;
      const special = evaluateSpecialForm(node, resolve, ops, issues);
      if (special !== null) return special;

      const fn = hasOwn(ops, node.op) ? ops[node.op] : undefined;
      if (typeof fn !== "function") {
        issues?.push({ code: "unknown-op", op: node.op });
        return none;
      }
      const resolved: unknown[] = [];
      for (const arg of node.args) {
        const r = evaluate(arg, resolve, ops, issues);
        if (!isSome(r)) {
          issues?.push({ code: "arg-none", op: node.op });
          return none;
        }
        resolved.push(r.value);
      }
      try {
        return some(fn(...resolved));
      } catch (err) {
        issues?.push({ code: "op-threw", op: node.op, message: err instanceof Error ? err.message : String(err) });
        return none;
      }
    }
    default:
      return badExpr(issues, `unknown tag: ${String(e.tag)}`);
  }
};
