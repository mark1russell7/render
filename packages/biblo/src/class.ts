import type { Expr } from "@render/dsl";

/**
 * A CellDef is a cell template in a class.
 * It has an expression and optionally a type reference (another class name)
 * so we can pre-analyze paths through typed children at the class level.
 */
export type CellDef = {
  readonly expr: Expr;
  /** If this cell holds an instance of another class, name it here for static analysis */
  readonly type?: string | undefined;
  /**
   * Bindings for typed cells: override child cell expressions.
   * Keys are child cell names, values are Exprs in the child's scope.
   * e.g. { value: ref("parent", "key") } — the child's "value" cell reads from parent's "key".
   */
  readonly bindings?: Readonly<Record<string, Expr>> | undefined;
};

/**
 * A ComponentClass is a template — shared structure, never copied.
 *
 * cells: reactive structure (what data this class holds)
 * methods: behavior (how instances of this class behave)
 * extends: prototype chain — cells and methods both resolve through it
 *
 * Methods are keyed by name, values are opaque (unknown).
 * Each layer (splay, node, etc.) defines what method names it looks for
 * and casts to the expected signature. This keeps the class system generic.
 *
 * The Top type defines defaults for all methods. Every class implicitly
 * extends Top. Overriding a method on a subclass refines the behavior
 * for that class and all its descendants.
 */
export type ComponentClass = {
  readonly name: string;
  readonly cells: Readonly<Record<string, CellDef>>;
  /** Class this extends (prototype chain) */
  readonly extends?: string | undefined;
  /** Coinductive methods — resolved through extends chain, most specific wins */
  readonly methods?: Readonly<Record<string, unknown>> | undefined;
};

export const componentClass = (
  name: string,
  cells: Record<string, CellDef>,
  ext?: string,
  methods?: Record<string, unknown>,
): ComponentClass => ({
  name,
  cells,
  ...(ext !== undefined ? { extends: ext } : {}),
  ...(methods !== undefined ? { methods } : {}),
});

/**
 * Extend a class with additional/overridden methods and cells.
 * The result is a new class with the same name that layers overrides on top.
 * This is how you add render methods for a specific output target,
 * or refine any behavior.
 */
export const extendClass = (
  base: ComponentClass,
  overrides: {
    readonly cells?: Readonly<Record<string, CellDef>>;
    readonly methods?: Readonly<Record<string, unknown>>;
  },
): ComponentClass => ({
  ...base,
  cells: { ...base.cells, ...overrides.cells },
  methods: { ...(base.methods ?? {}), ...(overrides.methods ?? {}) },
});
