/** A literal value. */
export type Lit = { readonly tag: "lit"; readonly value: unknown };

/** A path reference. The resolver of the evaluation gives the value at the path. */
export type Ref = { readonly tag: "ref"; readonly path: readonly string[] };

/** An operation application. The interpreter calls the named op with the values of the arguments. */
export type App = { readonly tag: "app"; readonly op: string; readonly args: readonly Expr[] };

/** The expression tree. These three node types are the complete IR. */
export type Expr = Lit | Ref | App;

/** This function makes a literal. */
export const lit = (value: unknown): Lit => ({ tag: "lit", value });

/** This function makes a path reference. */
export const ref = (...path: readonly string[]): Ref => ({ tag: "ref", path });

/** This function makes an operation application. */
export const app = (op: string, ...args: readonly Expr[]): App => ({ tag: "app", op, args });

/**
 * This function makes a `record` form: an object with one field for each entry.
 * The interpreter omits a field when its expression gives `none`.
 */
export const record = (fields: Readonly<Record<string, Expr>>): App =>
  app("record", ...Object.entries(fields).flatMap(([name, e]): Expr[] => [lit(name), e]));

const MAX_DEPTH = 256;

const isExprAt = (v: unknown, depth: number): boolean => {
  if (depth > MAX_DEPTH || v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as { readonly tag?: unknown; readonly path?: unknown; readonly op?: unknown; readonly args?: unknown };
  switch (o.tag) {
    case "lit":
      return true;
    case "ref":
      return Array.isArray(o.path) && o.path.every((s) => typeof s === "string");
    case "app":
      return typeof o.op === "string" && Array.isArray(o.args) && o.args.every((a) => isExprAt(a, depth + 1));
    default:
      return false;
  }
};

/**
 * This function tells if a value is a well-formed expression tree. It examines the full tree.
 * Use it at each boundary where data becomes an `Expr`, for example an edit in the viewer.
 */
export const isExpr = (v: unknown): v is Expr => isExprAt(v, 0);
