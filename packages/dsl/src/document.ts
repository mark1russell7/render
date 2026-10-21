/**
 * The document form of the IR. A document is a coeval envelope, `{ type, value }`. It is the interchange form of
 * render, and each language that uses coeval writes the same idea as the same document (decision D12 of coeval).
 *
 * - A literal is its JSON value in a position that holds terms. A literal with the shape of an envelope is
 *   `{ type: "lit", value }`. The root of a document is always an envelope, thus a literal root is a `lit` envelope.
 * - A reference is `{ type: "ref", value: [root, ...path] }`. The root is `names` when the first segment is a
 *   parameter of an enclosing `fn` form. Else the root is `world`: the resolver finds the first segment, for example a node ID.
 * - An op application is `{ type: ["ops", ...keys], value: [...args] }`. The keys are the op name, split at its dots.
 * - A `record` form is `{ type: "record", value: { fields } }`. A `fn` form is `{ type: "fn", value: { params, body } }`.
 *   A form that the construct cannot keep exactly, for example a computed field name, stays an op application.
 * - A value that JSON cannot write is an extension: `{ type: ["ext", "undefined"], value: null }`, or
 *   `{ type: ["ext", "number"], value: "NaN" }` for `NaN`, `Infinity`, `-Infinity` and `-0`.
 */
import type { Envelope, Json, Key } from "@mark1russell7/coeval";
import { isEnvelope, isKey, isRecord, typeName, typePath } from "@mark1russell7/coeval";
import type { Optional } from "@mark1russell7/render-optional";
import { isSome, none, some } from "@mark1russell7/render-optional";
import type { App, Expr } from "./ir.ts";
import { MAX_EXPR_DEPTH } from "./ir.ts";
import type { EvalIssue } from "./issue.ts";
import { fnParams, paramsOf } from "./scope.ts";

/** The document of an expression: a coeval envelope. `toDocument` writes it, and `fromDocument` reads it. */
export type ExprDocument = Envelope;

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/**
 * This function tells if a value has the form of an envelope, thus a boundary reads it as a document.
 * A node of the IR does not have that form, because an envelope has no `tag`.
 */
export const isDocument = (value: unknown): value is ExprDocument => isEnvelope(value as Json);

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

// === Write ===

const notAnExpression = (reason: string): never => {
  throw new TypeError(`toDocument expects an expression: ${reason}.`);
};

/**
 * This function writes a literal in a position that holds terms. A literal is data, thus the document keeps the
 * value as it is. A value that JSON cannot write, for example a function, stays in the document in memory only.
 */
const literalTerm = (value: unknown): Json => {
  if (value === undefined) return { type: ["ext", "undefined"], value: null };
  if (typeof value === "number") {
    const text = numberText(value);
    if (text !== undefined) return { type: ["ext", "number"], value: text };
  }
  const data = value as Json;
  return isEnvelope(data) ? { type: "lit", value: data } : data;
};

/** This function gives the text of a literal node, or `undefined` for another node. */
const literalName = (e: Expr | undefined): string | undefined =>
  e?.tag === "lit" && typeof e.value === "string" ? e.value : undefined;

/**
 * This function writes a `record` form as a `record` construct. The construct is an object, thus it cannot keep
 * a computed name, a repeated name or the order of index names (`"0"`, `"1"`). Such a form gives `undefined`.
 */
const writeRecord = (args: readonly Expr[], bound: ReadonlySet<string>, depth: number): Json | undefined => {
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
  return { type: "record", value: Object.fromEntries(names.map((n, i) => [n, writeTerm(args[2 * i + 1]!, bound, depth + 1)])) };
};

/** This function writes a `fn` form as a `fn` construct. A form without two arguments, or with a parameter that is not a text, gives `undefined`. */
const writeFn = (args: readonly Expr[], bound: ReadonlySet<string>, depth: number): Json | undefined => {
  const [params, body] = args;
  if (args.length !== 2 || params?.tag !== "lit" || !Array.isArray(params.value)) return undefined;
  const names = params.value as readonly unknown[];
  if (!names.every((p) => typeof p === "string")) return undefined;
  return { type: "fn", value: { params: [...names] as string[], body: writeTerm(body!, bound, depth + 1) } };
};

const writeTerm = (e: Expr, bound: ReadonlySet<string>, depth: number): Json => {
  if (depth > MAX_EXPR_DEPTH) return notAnExpression(`the tree is deeper than ${String(MAX_EXPR_DEPTH)} levels`);
  const node = e as Partial<Record<"tag" | "value" | "path" | "op" | "args", unknown>> | null | undefined;
  if (node === null || typeof node !== "object") return notAnExpression(`${String(node)} is not a node`);
  switch (node.tag) {
    case "lit":
      return literalTerm(node.value);
    case "ref": {
      const path = node.path;
      if (!Array.isArray(path) || !path.every((s) => typeof s === "string")) return notAnExpression("a ref has no path of texts");
      const segments = path as readonly string[];
      const head = segments[0];
      return { type: "ref", value: [head !== undefined && bound.has(head) ? "names" : "world", ...segments] };
    }
    case "app": {
      if (typeof node.op !== "string" || !Array.isArray(node.args)) return notAnExpression("an app has no op or no args");
      const a = e as App;
      // The parameters of a fn form are bound in each argument of the form, as in the scope analysis (fnParams)
      const params = fnParams(a);
      const inner = params === undefined ? bound : new Set([...bound, ...params]);
      const construct = a.op === "record" ? writeRecord(a.args, inner, depth) : a.op === "fn" ? writeFn(a.args, inner, depth) : undefined;
      return construct ?? { type: ["ops", ...a.op.split(".")], value: a.args.map((arg) => writeTerm(arg, inner, depth + 1)) };
    }
    default:
      return notAnExpression(`the tag ${String(node.tag)} is not lit, ref or app`);
  }
};

/**
 * This function gives the document of an expression. The root of the document is always an envelope, thus a
 * boundary that takes an expression or its document can tell them apart.
 *
 * `fromDocument(toDocument(e))` gives an expression that is equal to `e` (`exprEquals`). After `JSON.stringify` and
 * `JSON.parse`, this is also true when each literal is JSON or a value of an extension. A special value inside a
 * literal array or object gets its JSON form, as in `formatExpr`.
 *
 * The function throws a `TypeError` for a value that is not a well-formed expression (`isExpr` gives `false`).
 */
export const toDocument = (expr: Expr): ExprDocument => {
  const doc = writeTerm(expr, new Set(), 0);
  return isEnvelope(doc) ? doc : { type: "lit", value: doc };
};

// === Read ===

/** The failure of a read. `fromDocument` catches it, and it gives `none` with a `bad-expr` issue. */
class DocumentFailure extends Error {}

/**
 * This function stops the read. The message tells the problem, and its place: the keys from the root of the
 * document, for example `The root "self" is not names or world (at value.1).`
 */
const fail = (reason: string, at: readonly Key[]): never => {
  throw new DocumentFailure(at.length === 0 ? reason : `${reason.replace(/\.$/u, "")} (at ${at.join(".")}).`);
};

const readRef = (value: Json, bound: ReadonlySet<string>, at: readonly Key[]): Expr => {
  if (!Array.isArray(value) || value.length === 0) return fail("The value of a reference is not a path from a root.", at);
  const [root, ...steps] = value as readonly Json[];
  const path: string[] = [];
  for (const step of steps) {
    if (!isKey(step)) return fail("A step of the path is not a key. render has no computed steps.", at);
    path.push(String(step));
  }
  const head = path[0];
  if (root === "names") {
    if (head === undefined || !bound.has(head)) return fail(`The name ${JSON.stringify(head ?? null)} is not a parameter of an enclosing fn.`, at);
  } else if (root === "world") {
    // render reads a parameter before the world, thus this path cannot reach the world
    if (head !== undefined && bound.has(head)) return fail(`The world path ${JSON.stringify(head)} has the name of a parameter of an enclosing fn.`, at);
  } else {
    return fail(`The root ${JSON.stringify(root)} is not names or world.`, at);
  }
  return { tag: "ref", path };
};

const readRecord = (value: Json, bound: ReadonlySet<string>, depth: number, at: Key[]): Expr => {
  if (!isRecord(value)) return fail("The value of a record is not an object of fields.", at);
  const args: Expr[] = [];
  for (const [name, field] of Object.entries(value)) {
    at.push("value", name);
    args.push({ tag: "lit", value: name }, readTerm(field, bound, depth + 1, at));
    at.length -= 2;
  }
  return { tag: "app", op: "record", args };
};

const readFn = (value: Json, bound: ReadonlySet<string>, depth: number, at: Key[]): Expr => {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !hasOwn(value, "params") || !hasOwn(value, "body")) {
    return fail("The value of a fn is not { params, body }.", at);
  }
  const params = value["params"];
  if (!Array.isArray(params) || !(params as readonly Json[]).every((p) => typeof p === "string")) {
    return fail("The params of a fn are not a list of names.", at);
  }
  const names = params as readonly string[];
  at.push("value", "body");
  const body = readTerm(value["body"], new Set([...bound, ...names]), depth + 1, at);
  at.length -= 2;
  return { tag: "app", op: "fn", args: [{ tag: "lit", value: [...names] }, body] };
};

const readOps = (op: string, value: Json, bound: ReadonlySet<string>, depth: number, at: Key[]): Expr => {
  if (!Array.isArray(value)) return fail(`The arguments of the op ${JSON.stringify(op)} are not a list.`, at);
  const args: Expr[] = [];
  let inner = bound;
  for (const [i, arg] of (value as readonly Json[]).entries()) {
    at.push("value", i);
    const read = readTerm(arg, inner, depth + 1, at);
    at.length -= 2;
    args.push(read);
    // The first argument of a fn form binds its parameters in the other arguments, as in the scope analysis (fnParams)
    if (i === 0 && op === "fn") {
      const params = paramsOf(read);
      if (params !== undefined) inner = new Set([...bound, ...params]);
    }
  }
  return { tag: "app", op, args };
};

const readExtension = (keys: readonly Key[], doc: ExprDocument, at: readonly Key[]): Expr => {
  const name = keys.join(".");
  const value = doc.value;
  if (name === "undefined") return value === null ? { tag: "lit", value: undefined } : fail("The value of ext.undefined is not null.", at);
  if (name === "number") {
    const n = typeof value === "string" ? NUMBERS.get(value) : undefined;
    return n === undefined ? fail("The value of ext.number is not NaN, Infinity, -Infinity or -0.", at) : { tag: "lit", value: n };
  }
  return fail(`The type ${typeName(doc.type)} is not a term of render.`, at);
};

const readTerm = (doc: unknown, bound: ReadonlySet<string>, depth: number, at: Key[]): Expr => {
  if (depth > MAX_EXPR_DEPTH) return fail(`The document is deeper than ${String(MAX_EXPR_DEPTH)} levels.`, at);
  // In a position that holds terms, a value that is not an envelope is a literal
  if (!isDocument(doc)) return { tag: "lit", value: doc };
  if (doc.name !== undefined || doc.own !== undefined) return fail("A term of render has no name and no own entries.", at);
  const path = typePath(doc.type);
  if (path === undefined) return fail("The type of a term is a computed path.", at);
  const [head, ...rest] = path;
  if (rest.length === 0) {
    if (head === "lit") return { tag: "lit", value: doc.value };
    if (head === "ref") return readRef(doc.value, bound, at);
    if (head === "record") return readRecord(doc.value, bound, depth, at);
    if (head === "fn") return readFn(doc.value, bound, depth, at);
  } else if (head === "ops") {
    return readOps(rest.join("."), doc.value, bound, depth, at);
  } else if (head === "ext") {
    return readExtension(rest, doc, at);
  }
  return fail(`The type ${typeName(doc.type)} is not a term of render.`, at);
};

/**
 * This function reads a document into an expression. The caller declares that the document is a term, thus a
 * value that is not an envelope is a literal.
 *
 * The read is total: a document that is not valid gives `none` and does not throw. Give `issues` to collect the
 * cause, a `bad-expr` issue whose message tells the problem and its place. These documents are not valid:
 * - A type that is not `lit`, `ref`, `record`, `fn`, `["ops", ...]` or an extension of render.
 * - A term with a `name` or `own` entries.
 * - A reference whose root is not `names` or `world`, or a reference with a computed step.
 * - A `names` path whose first step is not a parameter of an enclosing `fn`.
 * - A `world` path whose first step is a parameter of an enclosing `fn`.
 * - A document deeper than `MAX_EXPR_DEPTH` levels.
 */
export const fromDocument = (doc: unknown, issues?: EvalIssue[]): Optional<Expr> => {
  try {
    return some(readTerm(doc, new Set(), 0, []));
  } catch (error) {
    if (!(error instanceof DocumentFailure) && !(error instanceof RangeError)) throw error;
    issues?.push({ code: "bad-expr", message: error instanceof DocumentFailure ? error.message : "The document is too deep." });
    return none;
  }
};

/**
 * This function tells if a value is a valid document of an expression: an envelope that `fromDocument` reads.
 * It examines the full document. A tree of the IR and a bare literal are not documents.
 */
export const isExprDocument = (value: unknown): value is ExprDocument => isDocument(value) && isSome(fromDocument(value));

/**
 * This function gives the IR of a value at a boundary that takes an expression or its document, for example
 * `addNode`. A valid document becomes its tree, and a tree of the IR stays the same object. A document that is
 * not valid also stays the same. Thus `evaluate` reports it as it reports a malformed tree: `none`, with a
 * `bad-expr` issue.
 */
export const asExpr = (value: Expr | ExprDocument): Expr => {
  if (!isDocument(value)) return value;
  const read = fromDocument(value);
  return isSome(read) ? read.value : (value as unknown as Expr);
};
