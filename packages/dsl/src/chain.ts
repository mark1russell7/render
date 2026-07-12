import type { Expr } from "./ir.js";
import type { Optional } from "@render/optional";
import { some, none } from "@render/optional";
import { ref, lit, app } from "./ir.js";

export interface Chain {
  /** Navigate a path through seats */
  readonly ref: (...path: readonly string[]) => Chain;
  /** Apply an operation — previous expression becomes first arg */
  readonly app: (op: string, ...args: readonly (Expr | number | string | boolean)[]) => Chain;
  /** Extract the built expression — none for an empty chain (total, no throw) */
  readonly build: () => Optional<Expr>;
}

const normalize = (a: Expr | number | string | boolean): Expr =>
  a !== null && typeof a === "object" ? a : lit(a);

export const chain = (expr?: Expr): Chain => ({
  ref: (...path) => chain(ref(...path)),
  app: (op, ...rawArgs) => {
    const args = rawArgs.map(normalize);
    return chain(app(op, ...(expr ? [expr, ...args] : args)));
  },
  build: (): Optional<Expr> => (expr ? some(expr) : none),
});

