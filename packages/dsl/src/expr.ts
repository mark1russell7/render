/**
 * The expressions of render. An expression is a coeval document: an envelope `{ type, value }`. The kernel of
 * coeval evaluates it, checks it and finds its references (decisions D12 and D13 of coeval).
 *
 * - A literal is its value in a position that holds terms. A literal with the shape of an envelope, and a literal at
 *   the root, is `{ type: "lit", value }`.
 * - A value that JSON cannot write is an extension: `{ type: ["ext", "undefined"], value: null }`, or
 *   `{ type: ["ext", "number"], value: "NaN" }` for `NaN`, `Infinity`, `-Infinity` and `-0`.
 * - A reference is `{ type: "ref", value: [root, ...path] }`. The root is `names` for a parameter of an enclosing
 *   `fn`, and `world` for each other name. The host finds a `world` name, for example a node ID, `self` or `parent`.
 * - An op application is `{ type: ["ops", ...keys], value: [...args] }`. The keys are the op name, split at its dots.
 * - `if`, `and`, `or`, `fn` and `record` are the constructs of the kernel, for example
 *   `{ type: "if", value: { test, then, else } }` and `{ type: "fn", value: { params, body } }`.
 */
import type { Envelope, Json } from "@mark1russell7/coeval";
import { isEnvelope, mapRefs, typePath } from "@mark1russell7/coeval";
import { renderWorld } from "./machine.ts";

/** An expression: a coeval document whose root is an envelope. */
export type Expr = Envelope;

/** The text of a number that JSON cannot write. The formula language writes the same text. */
const numberText = (n: number): string | undefined => {
  if (Number.isNaN(n)) return "NaN";
  if (n === Number.POSITIVE_INFINITY) return "Infinity";
  if (n === Number.NEGATIVE_INFINITY) return "-Infinity";
  return Object.is(n, -0) ? "-0" : undefined;
};

/** The numbers of the extension `["ext", "number"]`, by their text. */
const NUMBERS: ReadonlyMap<string, number> = new Map([
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  ["-0", -0],
]);

/**
 * This function makes a literal. `undefined` and the numbers that JSON cannot write become extensions. Another value
 * stays as it is in the `lit` envelope, also a value that JSON cannot write, for example a function.
 */
export const lit = (value: unknown): Expr => {
  if (value === undefined) return { type: ["ext", "undefined"], value: null };
  if (typeof value === "number") {
    const text = numberText(value);
    if (text !== undefined) return { type: ["ext", "number"], value: text };
  }
  return { type: "lit", value: value as Json };
};

/**
 * This function makes a reference from the root `world`: the host finds the first segment, for example a node ID.
 * A `fn` around the reference changes the root to `names` when its parameters have the first segment.
 */
export const ref = (...path: readonly string[]): Expr => ({ type: "ref", value: ["world", ...path] });

/** This function tells if a document is the envelope of a plain literal: `{ type: "lit", value }`. */
const isLit = (doc: Envelope): boolean => doc.type === "lit" && doc.name === undefined && doc.own === undefined;

/**
 * This function gives the term of an expression in a position that holds terms. A `lit` envelope becomes its value,
 * except a value with the shape of an envelope. Thus the builders write the canonical document of each expression.
 */
const term = (e: Expr): unknown => (isEnvelope(e) && isLit(e) && !isEnvelope(e.value) ? e.value : e);

/**
 * This function tells if an expression is a literal: a `lit` envelope or an extension. A literal has no references,
 * thus a caller can skip a walk of it.
 */
export const isLiteral = (doc: Envelope): boolean => {
  const type = doc.type;
  return type === "lit" || (Array.isArray(type) && type.length === 2 && type[0] === "ext");
};

/** This function gives the value of a literal document: a `lit` envelope or an extension. Another document gives `undefined`. */
export const literalOf = (doc: unknown): { readonly value: unknown } | undefined => {
  if (!isEnvelope(doc)) return undefined;
  if (isLit(doc)) return { value: doc.value };
  const keys = typePath(doc.type);
  if (keys?.length !== 2 || keys[0] !== "ext") return undefined;
  if (keys[1] === "undefined" && doc.value === null) return { value: undefined };
  const n = keys[1] === "number" && typeof doc.value === "string" ? NUMBERS.get(doc.value) : undefined;
  return n === undefined ? undefined : { value: n };
};

/** This function gives the op name of an op application `["ops", ...keys]`, or `undefined` for another document. */
export const opOf = (doc: unknown): string | undefined => {
  if (!isEnvelope(doc)) return undefined;
  const keys = typePath(doc.type);
  return keys !== undefined && keys.length > 1 && keys[0] === "ops" ? keys.slice(1).join(".") : undefined;
};

/**
 * This function binds the parameters of a `fn` in its body: a `world` reference whose first segment is a parameter
 * becomes a `names` reference. A reference inside a nested `fn` with the same parameter stays bound to that `fn`.
 */
const bind = (body: unknown, params: readonly string[]): unknown =>
  isEnvelope(body)
    ? mapRefs(renderWorld, body, (use) =>
        use.root === "world" && typeof use.path[1] === "string" && params.includes(use.path[1])
          ? { type: "ref", value: ["names", ...use.path.slice(1)] }
          : undefined)
    : body;

/** This function gives the text of a literal argument, or `undefined` for another argument. */
const literalName = (e: Expr | undefined): string | undefined => {
  const found = literalOf(e);
  return typeof found?.value === "string" ? found.value : undefined;
};

/**
 * This function makes a record from name and value pairs. An object cannot hold a computed name, a repeated name or
 * the order of index names (`"1"`, `"0"`). Such pairs give `undefined`, and stay an op application.
 */
const recordOf = (args: readonly Expr[]): Expr | undefined => {
  if (args.length % 2 !== 0) return undefined;
  const names: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const name = literalName(args[i]);
    if (name === undefined) return undefined;
    names.push(name);
  }
  const order = Object.keys(Object.fromEntries(names.map((n) => [n, null])));
  if (order.length !== names.length || order.some((n, i) => n !== names[i])) return undefined;
  // fromEntries makes own data properties, thus a field "__proto__" stays a field
  return { type: "record", value: Object.fromEntries(names.map((n, i) => [n, term(args[2 * i + 1] as Expr)])) as Json };
};

/** This function makes a `fn` from a literal list of different parameter names and a body, or gives `undefined`. */
const fnOf = (args: readonly Expr[]): Expr | undefined => {
  const params = args.length === 2 ? literalOf(args[0])?.value : undefined;
  if (!Array.isArray(params) || !params.every((p) => typeof p === "string") || new Set(params).size !== params.length) return undefined;
  const names = [...(params as readonly string[])];
  return { type: "fn", value: { params: names, body: bind(term(args[1] as Expr), names) } as Json };
};

/** This function makes the construct of a form of the text, or gives `undefined` when the form is an op application. */
const constructOf = (op: string, args: readonly Expr[]): Expr | undefined => {
  switch (op) {
    case "if":
      if (args.length !== 2 && args.length !== 3) return undefined;
      return {
        type: "if",
        // oxlint-disable-next-line unicorn/no-thenable -- the construct if of the kernel has the field then
        value: { test: term(args[0] as Expr), then: term(args[1] as Expr), ...(args.length === 3 ? { else: term(args[2] as Expr) } : {}) } as Json,
      };
    case "and":
    case "or":
      return { type: op, value: args.map(term) as Json };
    case "fn":
      return fnOf(args);
    case "record":
      return recordOf(args);
    default:
      return undefined;
  }
};

/**
 * This function makes an application, as the formula language writes it: `op(...args)`. Five names are forms with
 * constructs. They evaluate only the arguments that they need, and an op with the same name has no effect:
 *
 * - `if(test, then, else?)`: only the branch that the test selects. Without `else`, the value is `undefined`.
 * - `and(a, b, ...)` and `or(a, b, ...)`: the evaluation stops at the first false value or true value.
 * - `fn(["x", ...], body)`: a function. Its body reads the parameters as `names` references.
 * - `record("a", a, "b", b, ...)`: an object. A field whose value fails is not in the object.
 *
 * Each other name, and a form that its construct cannot hold, is an op application `["ops", ...keys]`.
 */
export const app = (op: string, ...args: readonly Expr[]): Expr =>
  constructOf(op, args) ?? { type: ["ops", ...op.split(".")], value: args.map(term) as Json };

/** This function makes a `record` construct: an object with one field for each entry. A field whose value fails is not in the object. */
export const record = (fields: Readonly<Record<string, Expr>>): Expr => ({
  type: "record",
  // fromEntries makes own data properties, thus a field "__proto__" stays a field
  value: Object.fromEntries(Object.entries(fields).map(([name, e]) => [name, term(e)])) as Json,
});
