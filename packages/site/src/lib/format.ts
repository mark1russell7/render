import type { Expr } from "@render/dsl";
import type { Optional } from "@render/optional";
import { textOf } from "@render/splay";

const INFIX = new Set(["+", "-", "*", "/", "<", ">", "<=", ">="]);

/**
 * This function gives a short text form of an expression: `a + c`, `abs(a)`, `if(d > 0, "up", "down")`.
 * A reference is its path with dots. An infix op of two arguments is in the middle.
 */
export function formatExpr(e: Expr): string {
  switch (e.tag) {
    case "lit":
      return e.value === undefined ? "undefined" : JSON.stringify(e.value) ?? textOf(e.value);
    case "ref":
      return e.path.join(".");
    case "app": {
      const [l, r] = e.args;
      if (INFIX.has(e.op) && e.args.length === 2 && l && r) return `${formatExpr(l)} ${e.op} ${formatExpr(r)}`;
      return `${e.op}(${e.args.map(formatExpr).join(", ")})`;
    }
  }
}

/** This function gives the text form of a value, or "none" for an absent value. */
export function formatValue(v: Optional<unknown>): string {
  if (v.tag === "none") return "none";
  const x = v.value;
  if (typeof x === "function") return "a function";
  if (x === undefined) return "undefined";
  return JSON.stringify(x) ?? textOf(x);
}
