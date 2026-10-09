import type { Ops } from "@render/dsl";
import { formatExpr, isExpr } from "@render/dsl";
import { valueEquals } from "@render/node";

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/**
 * This function gives the text form of a value. A string stays the same, and `null` and `undefined` give an
 * empty text. An object or an array gives its JSON, and a function gives its name. Another value gives `String(value)`.
 */
export const textOf = (v: unknown): string => {
  switch (typeof v) {
    case "string":
      return v;
    case "number":
    case "boolean":
    case "bigint":
      return String(v);
    case "symbol":
      return v.toString();
    case "function":
      return `[function ${v.name}]`;
    case "undefined":
      return "";
    case "object":
      if (v === null) return "";
      try {
        return JSON.stringify(v) ?? "";
      } catch {
        return "[cyclic]";
      }
  }
};

/** The maximum length of a brief text, with its ellipsis. */
const BRIEF_LENGTH = 48;

/** The maximum number of keys in the brief text of an object. */
const BRIEF_KEYS = 6;

const clip = (text: string): string => (text.length > BRIEF_LENGTH ? `${text.slice(0, BRIEF_LENGTH - 1)}…` : text);

/**
 * This function gives a short text of a value, for a summary. An expression gives its formula. An array gives
 * its number of items, and an object gives its keys. A string gives its JSON. A long text ends with an ellipsis.
 */
export const briefOf = (v: unknown): string => {
  if (isExpr(v)) return clip(formatExpr(v));
  if (Array.isArray(v)) return v.length === 1 ? "[1 item]" : `[${String(v.length)} items]`;
  if (typeof v === "string") return clip(JSON.stringify(v));
  if (v === undefined) return "undefined";
  if (typeof v === "object" && v !== null) {
    const keys = Object.keys(v);
    if (keys.length === 0) return "{}";
    const shown = keys.slice(0, BRIEF_KEYS).join(", ");
    return clip(keys.length > BRIEF_KEYS ? `{ ${shown}, … +${String(keys.length - BRIEF_KEYS)} }` : `{ ${shown} }`);
  }
  return clip(textOf(v));
};

/** This function gives two numbers, or throws a type error that names the op. */
const numbers = (op: string, a: unknown, b: unknown): [number, number] => {
  if (typeof a !== "number" || typeof b !== "number") throw new TypeError(`${op} expects two numbers`);
  return [a, b];
};

/**
 * The standard ops: the functions that cell expressions and render methods can use.
 * An op throws for a value of an incorrect type. The interpreter catches the error, gives `none`,
 * and records an `op-threw` issue with the message.
 */
export const standardOps: Ops = {
  "+": (a, b) => { const [x, y] = numbers("+", a, b); return x + y; },
  "-": (a, b) => { const [x, y] = numbers("-", a, b); return x - y; },
  "*": (a, b) => { const [x, y] = numbers("*", a, b); return x * y; },
  "/": (a, b) => { const [x, y] = numbers("/", a, b); return x / y; },
  max: (a, b) => Math.max(...numbers("max", a, b)),
  min: (a, b) => Math.min(...numbers("min", a, b)),
  "<": (a, b) => { const [x, y] = numbers("<", a, b); return x < y; },
  ">": (a, b) => { const [x, y] = numbers(">", a, b); return x > y; },
  "<=": (a, b) => { const [x, y] = numbers("<=", a, b); return x <= y; },
  ">=": (a, b) => { const [x, y] = numbers(">=", a, b); return x >= y; },
  /** This op gives the absolute value of a number. */
  abs: (a) => { const [x] = numbers("abs", a, 0); return Math.abs(x); },
  /** This op gives `true` for a false value, and `false` for a true value. */
  not: (a) => !a,

  /** This op gives the text form of a value (`textOf`). */
  toString: (a: unknown) => textOf(a),
  /** This op gives the text form of a value (`textOf`). `null` and `undefined` give an empty text. */
  str: (v) => textOf(v),
  /** This op joins the text forms of its arguments. */
  concat: (...args) => args.map(textOf).join(""),

  /** This op is a placeholder of text measurement: one unit for each character. */
  textWidth: (text) => textOf(text).length,
  /** This op is a placeholder of text measurement: one line. */
  textHeight: () => 1,

  /** This op reads an own field of an object: `get(obj, key)`. It gives `undefined` for a missing field. */
  get: (obj, key) =>
    obj !== null && typeof obj === "object" && hasOwn(obj, String(key)) ? (obj as Record<string, unknown>)[String(key)] : undefined,

  /** This op is the strict conditional. The special form `if` of the interpreter has precedence over it. */
  if: (cond, then_, else_) => (cond ? then_ : else_),

  /** This op compares two values structurally, like the change detection of the engine. */
  eq: (a, b) => valueEquals(a, b),

  /** This op gives the JavaScript type of a value. */
  typeof: (v) => typeof v,

  /** This op applies a function to each item of an array: `map(list, fn)`. A `fn` form makes the function. */
  map: (list, fn) => {
    if (!Array.isArray(list) || typeof fn !== "function") throw new TypeError("map expects an array and a function");
    return list.map((item: unknown) => (fn as (item: unknown) => unknown)(item));
  },

  /** This op makes an object from name and value pairs: `props(k1, v1, k2, v2, ...)`. */
  props: (...args) => {
    const entries: [string, unknown][] = [];
    for (let i = 0; i + 1 < args.length; i += 2) entries.push([String(args[i]), args[i + 1]]);
    // fromEntries makes own data properties, thus a key "__proto__" does not change the prototype
    return Object.fromEntries(entries);
  },

  /** This op makes an array of its arguments. */
  array: (...args) => args,

  /** This op gives the own keys of an object or an array. */
  keys: (obj) => {
    if (obj === null || typeof obj !== "object") throw new TypeError("keys expects an object");
    return Object.keys(obj);
  },

  /** This op gives the number of items of an array, of keys of an object, or of characters of a string. */
  count: (v) => {
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    if (v !== null && typeof v === "object") return Object.keys(v).length;
    throw new TypeError("count expects an array, an object or a string");
  },

  /** This op joins the text forms of the items of an array: `join(list, separator)`. The default separator is ", ". */
  join: (list, separator) => {
    if (!Array.isArray(list)) throw new TypeError("join expects an array");
    return list.map(textOf).join(separator === undefined ? ", " : textOf(separator));
  },

  /** This op gives a short text of a value, for a summary (`briefOf`). */
  brief: (v) => briefOf(v),

  /** This op gives the formula of an expression: its text form (`formatExpr`). */
  formula: (e) => {
    if (!isExpr(e)) throw new TypeError("formula expects an expression");
    return formatExpr(e);
  },

  /**
   * This op applies a function to arguments: `call(f, ...args)`. An example is `call(self.dehydrate)`.
   * With a `fn` form, it binds a name: `call(fn(["d"], body), value)`.
   */
  call: (f, ...args) => {
    if (typeof f !== "function") throw new TypeError("call expects a function");
    return (f as (...a: unknown[]) => unknown)(...args);
  },
};

/** The categories of the standard ops. They are next to the definitions, thus they stay in sync. */
export const opCategories: Readonly<Record<string, readonly string[]>> = {
  math: ["+", "-", "*", "/", "max", "min", "<", ">", "<=", ">=", "abs"],
  measure: ["textWidth", "textHeight"],
  data: [
    "get", "if", "not", "concat", "eq", "typeof", "map", "props", "array", "str", "toString",
    "keys", "count", "join", "brief", "formula", "call",
  ],
};
