import type { Expr } from "./ir.js";

/** A dependency path — chain of seats this expression reads through */
export type DepPath = readonly string[];

/** Extract all reference paths from an expression */
export const deps = (expr: Expr): DepPath[] => {
  switch (expr.tag) {
    case "lit": return [];
    case "ref": return [expr.path];
    case "app": return expr.args.flatMap(deps);
  }
};
