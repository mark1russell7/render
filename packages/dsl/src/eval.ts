/**
 * The evaluation of an expression at the public boundary of render. The kernel evaluates a compiled plan. This
 * module gives the plan a resolver as the root `world`, and it gives the result as an `Optional` with issues.
 */
import type { DocVisit, EvalError, HostThing, Key } from "@mark1russell7/coeval";
import { THING, context, typeName, typePath, walk } from "@mark1russell7/coeval";
import type { Optional } from "@mark1russell7/render-optional";
import { isSome, none, some } from "@mark1russell7/render-optional";
import type { Expr } from "./expr.ts";
import { opOf } from "./expr.ts";
import type { EvalIssue } from "./issue.ts";
import type { Ops } from "./machine.ts";
import { NO_VALUE, plannerOf, renderWorld } from "./machine.ts";

export type { EvalIssue } from "./issue.ts";

/**
 * A path resolver: it gives the value of a `world` reference. The path has the segments after the root.
 *
 * Each layer gives its own names through this one seam: plain objects (`objectResolver`), the node store of
 * `@mark1russell7/render-node`, or other sources.
 */
export type Resolver = (path: readonly string[]) => Optional<unknown>;

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/**
 * This function makes a resolver over a plain nested object. The resolver reads only own properties,
 * thus a path, for example `["constructor"]`, does not find a value of `Object.prototype`.
 */
export const objectResolver = (ctx: unknown): Resolver => (path) => {
  let current: unknown = ctx;
  for (const segment of path) {
    if (current === null || typeof current !== "object" || !hasOwn(current, segment)) return none;
    current = (current as Record<string, unknown>)[segment];
  }
  return some(current);
};

/** This function gives the keys of a path as texts. A document from another source can have a number key. */
const texts = (keys: readonly Key[]): readonly string[] =>
  keys.every((k): k is string => typeof k === "string") ? keys : keys.map(String);

/**
 * This function makes the host thing of a resolver: the root `world` of an evaluation. It answers a full path in
 * one call. A reference to the root alone gives the value of the empty path.
 */
export const resolverThing = (resolve: Resolver): HostThing => ({
  [THING]: true,
  label: "resolver",
  deref: (key) => {
    const found = resolve([String(key)]);
    return isSome(found) ? found.value : undefined;
  },
  toJson: () => {
    const found = resolve([]);
    return isSome(found) ? found.value : NO_VALUE;
  },
  resolve: (keys) => {
    const found = resolve(texts(keys));
    return isSome(found) ? { thing: found.value } : undefined;
  },
});

/**
 * This function evaluates an expression with a resolver and an op registry. The kernel compiles the expression
 * one time for each registry, and the plan evaluates it.
 *
 * The evaluation is total: a failure gives `none` and does not throw. This is also true for a document that is not
 * valid, for example data from an edit. Give `issues` to collect the cause of a `none`.
 */
export const evaluate = (expr: Expr, resolve: Resolver, ops: Ops, issues?: EvalIssue[]): Optional<unknown> => {
  const result = plannerOf(ops)(expr).evaluate(context({ world: resolverThing(resolve) }));
  if (result.ok) return some(result.value);
  issues?.push(...issuesOf(expr, result.error));
  return none;
};

/** This function tells if a path starts with a prefix. */
const startsWith = (path: readonly Key[], prefix: readonly Key[]): boolean =>
  prefix.length <= path.length && prefix.every((key, i) => String(key) === String(path[i]));

/** The constructs whose arguments can be a bad form. */
const FORMS: ReadonlySet<string> = new Set(["if", "and", "or", "fn", "record", "call", "let", "list"]);

/** This function gives the message of an exception. */
const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** This function gives the issue of the document where an error started. */
const causeOf = (at: DocVisit | undefined, error: EvalError): EvalIssue => {
  const doc = at?.doc;
  if (doc === undefined) return { code: "bad-expr", message: error.reason };
  const op = opOf(doc);
  const keys = typePath(doc.type);
  if (keys?.length === 1 && keys[0] === "ref" && Array.isArray(doc.value) && (error.code === "#N/A" || error.code === "#NAME?")) {
    return { code: "path-miss", path: (doc.value as readonly unknown[]).slice(1).map(String) };
  }
  if (op !== undefined && error.code === "#NAME?") return { code: "unknown-op", op };
  if (op !== undefined && error.code === "#CALC!") return { code: "op-threw", op, message: messageOf(error.cause) };
  if (error.code === "#VALUE!") {
    if (op !== undefined && Array.isArray(doc.value)) return { code: "bad-form", op, message: error.reason };
    const name = typeName(doc.type);
    if (FORMS.has(name)) return { code: "bad-form", op: name, message: error.reason };
  }
  return { code: "bad-expr", message: error.reason };
};

/**
 * This function gives the issues of an error of the kernel. The first issue is the cause, at the document where the
 * error started. Each op application around that document adds an `arg-none` issue, from the inside out.
 */
export const issuesOf = (expr: unknown, error: EvalError): EvalIssue[] => {
  const place = error.place ?? [];
  let at: DocVisit | undefined;
  const around: string[] = [];
  walk(renderWorld, expr, (visit) => {
    if (at !== undefined || !startsWith(place, visit.place)) return "skip";
    if (visit.place.length === place.length) {
      at = visit;
      return "skip";
    }
    const op = opOf(visit.doc);
    if (op !== undefined) around.push(op);
    return undefined;
  });
  return [causeOf(at, error), ...around.toReversed().map((op): EvalIssue => ({ code: "arg-none", op }))];
};
