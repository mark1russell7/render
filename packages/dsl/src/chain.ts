import type { Expr } from "./ir.ts";
import type { Optional } from "@render/optional";
import { some, none } from "@render/optional";
import { ref, lit, app } from "./ir.ts";

/** A fluent builder of expressions. Each step gives a new chain. */
export interface Chain {
  /** This step starts a new chain from a path reference. */
  readonly ref: (...path: readonly string[]) => Chain;
  /** This step applies an op. The expression of the chain becomes the first argument. */
  readonly app: (op: string, ...args: readonly (Expr | number | string | boolean)[]) => Chain;
  /** This step gives the built expression, or `none` for an empty chain. */
  readonly build: () => Optional<Expr>;
}

const normalize = (a: Expr | number | string | boolean): Expr =>
  a !== null && typeof a === "object" ? a : lit(a);

/** This function starts a chain, optionally from an expression. */
export const chain = (expr?: Expr): Chain => ({
  ref: (...path) => chain(ref(...path)),
  app: (op, ...rawArgs) => {
    const args = rawArgs.map(normalize);
    return chain(app(op, ...(expr ? [expr, ...args] : args)));
  },
  build: (): Optional<Expr> => (expr ? some(expr) : none),
});
