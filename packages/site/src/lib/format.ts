import type { Optional } from "@render/optional";
import { textOf } from "@render/splay";

/** The text form of an expression is the formula language of `@render/dsl`: `a + c`, `abs(a)`, `if(d > 0, "up", "down")`. */
export { formatExpr } from "@render/dsl";

/** This function gives the text form of a value, or "none" for an absent value. */
export function formatValue(v: Optional<unknown>): string {
  if (v.tag === "none") return "none";
  const x = v.value;
  if (typeof x === "function") return "a function";
  if (x === undefined) return "undefined";
  return JSON.stringify(x) ?? textOf(x);
}
