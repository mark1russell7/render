import type { Expr } from "@render/dsl";

/**
 * A cell template of a class. It has an expression, and optionally a type: the name of another class.
 * A typed cell holds an instance of that class, thus the class level knows the paths through its children.
 */
export type CellDef = {
  readonly expr: Expr;
  /** The class of the child instance that this cell holds. */
  readonly type?: string | undefined;
  /**
   * The bindings of a typed cell: expressions that replace cells of the child.
   * They are in the scope of the child. For example, `{ value: ref("parent", "key") }` binds the cell `value`
   * of the child to the cell `key` of this instance.
   */
  readonly bindings?: Readonly<Record<string, Expr>> | undefined;
};

/**
 * A class is a template. Instances share it, and nothing copies it.
 *
 * - `cells`: the reactive structure, which is the data that each instance holds.
 * - `methods`: the behavior. The extends chain resolves them, and the most specific method wins.
 * - `extends`: the parent class. Cells and methods both resolve through it.
 *
 * The values of `methods` are opaque. Each layer reads the method names that it knows, for example
 * `render` for splay and `splash` for the node engine. The class `Top` gives the defaults.
 */
export type ComponentClass = {
  readonly name: string;
  readonly cells: Readonly<Record<string, CellDef>>;
  readonly extends?: string | undefined;
  readonly methods?: Readonly<Record<string, unknown>> | undefined;
};

/** This function makes a class. */
export const componentClass = (
  name: string,
  cells: Readonly<Record<string, CellDef>>,
  ext?: string,
  methods?: Readonly<Record<string, unknown>>,
): ComponentClass => ({
  name,
  cells,
  ...(ext !== undefined ? { extends: ext } : {}),
  ...(methods !== undefined ? { methods } : {}),
});

/**
 * This function gives a copy of a class with more cells and methods. The copy keeps the name.
 * An override with the name of an existing cell or method replaces it.
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
  methods: { ...base.methods, ...overrides.methods },
});
