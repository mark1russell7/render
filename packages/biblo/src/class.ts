import type { Expr } from "@render/dsl";

/**
 * A CellDef is a cell template in a class.
 * It has an expression and optionally a type reference (another class name)
 * so we can pre-analyze paths through typed children at the class level.
 */
export type CellDef = {
  readonly expr: Expr;
  /** If this cell holds an instance of another class, name it here for static analysis */
  readonly type?: string;
  /** Default value before first evaluation */
  readonly default?: unknown;
};

/**
 * A ComponentClass is a template — shared structure, never copied.
 * The cell defs define the shape. Instance data lives in the seat graph,
 * keyed by instance ID.
 */
export type ComponentClass = {
  readonly name: string;
  readonly cells: Readonly<Record<string, CellDef>>;
  /** Class this extends (prototype chain) */
  readonly extends?: string;
};

export const componentClass = (
  name: string,
  cells: Record<string, CellDef>,
  ext?: string,
): ComponentClass => ({
  name,
  cells,
  ...(ext !== undefined ? { extends: ext } : {}),
});
