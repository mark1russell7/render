import type { Ops } from "@render/dsl";
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
};

/** The categories of the standard ops. They are next to the definitions, thus they stay in sync. */
export const opCategories: Readonly<Record<string, readonly string[]>> = {
  math: ["+", "-", "*", "/", "max", "min", "<", ">", "<=", ">=", "abs"],
  measure: ["textWidth", "textHeight"],
  data: ["get", "if", "not", "concat", "eq", "typeof", "map", "props", "array", "str", "toString"],
};
