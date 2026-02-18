import type { Expr, DepPath } from "@render/dsl";
import type { Optional } from "@render/optional";
import { none } from "@render/optional";
import { deps } from "@render/dsl";

export type CellId = string;

export type Cell = {
  readonly id: CellId;
  readonly expr: Expr;
  value: Optional<unknown>;
  /** Paths this cell reads — extracted from expr */
  readonly reads: readonly DepPath[];
};

export const cell = (id: CellId, expr: Expr): Cell => ({
  id,
  expr,
  value: none,
  reads: deps(expr),
});
