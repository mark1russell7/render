import type { Ops } from "@render/dsl";

/**
 * Standard DSL ops for the splay system.
 * These are the functions available inside cell expressions.
 */
export const standardOps: Ops = {
  "+": (a: unknown, b: unknown) => (a as number) + (b as number),
  "-": (a: unknown, b: unknown) => (a as number) - (b as number),
  "*": (a: unknown, b: unknown) => (a as number) * (b as number),
  "/": (a: unknown, b: unknown) => (a as number) / (b as number),
  max: (a: unknown, b: unknown) => Math.max(a as number, b as number),
  min: (a: unknown, b: unknown) => Math.min(a as number, b as number),
  toString: (a: unknown) => String(a),

  // Text measurement — placeholder implementations.
  textWidth: (text: unknown) => String(text).length,
  textHeight: (_text: unknown) => 1,

  // === UI ops — atoms for building element trees from Expr ===

  /** Property access: get(obj, key) → obj[key] */
  get: (obj: unknown, key: unknown) => {
    if (obj != null && typeof obj === "object") {
      return (obj as Record<string, unknown>)[String(key)];
    }
    return undefined;
  },

  /** Conditional: if(cond, then, else) */
  if: (cond: unknown, then_: unknown, else_: unknown) => cond ? then_ : else_,

  /** String concatenation */
  concat: (...args: unknown[]) => args.map(String).join(""),

  /** Equality check */
  eq: (a: unknown, b: unknown) => a === b,

  /** Type check */
  typeof: (v: unknown) => typeof v,

  /** Map a callback over an array: map(list, fn) → list.map(fn) */
  map: (list: unknown, fn: unknown) => {
    if (!Array.isArray(list) || typeof fn !== "function") return [];
    return (list as unknown[]).map(fn as (item: unknown) => unknown);
  },

  /** Create a props object from key-value pairs: props(k1, v1, k2, v2, ...) */
  props: (...args: unknown[]) => {
    const result: Record<string, unknown> = {};
    for (let i = 0; i < args.length - 1; i += 2) {
      result[String(args[i])] = args[i + 1];
    }
    return result;
  },

  /** Array construction */
  array: (...args: unknown[]) => args,

  /** Coerce to string */
  str: (v: unknown) => String(v ?? ""),
};
