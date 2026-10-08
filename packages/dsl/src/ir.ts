/** A literal value. */
export type Lit = { readonly tag: "lit"; readonly value: unknown };

/** A path reference. The resolver of the evaluation gives the value at the path. */
export type Ref = { readonly tag: "ref"; readonly path: readonly string[] };

/** An operation application. The interpreter applies the named op to the values of the arguments. */
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

/**
 * The limit of the depth of an expression tree. The interpreter gives a `bad-expr` issue for a deeper node,
 * thus a very deep tree cannot overflow the stack. `isExpr` refuses a deeper tree.
 */
export const MAX_EXPR_DEPTH = 1000;

const isExprAt = (v: unknown, depth: number): boolean => {
  if (depth > MAX_EXPR_DEPTH || v === null || typeof v !== "object" || Array.isArray(v)) return false;
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

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** This function compares two literal values: plain data by structure, other values by identity. */
const sameData = (a: unknown, b: unknown, depth: number): boolean => {
  if (Object.is(a, b)) return true;
  if (depth > MAX_EXPR_DEPTH || a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => hasOwn(b, k) && sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1));
};

/**
 * This function compares two expressions by structure, to the full depth of `MAX_EXPR_DEPTH`.
 * Two literals are equal when their values are equal plain data.
 */
export const exprEquals = (a: Expr, b: Expr): boolean => {
  const stack: [Expr, Expr][] = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x === y) continue;
    if (x.tag !== y.tag) return false;
    if (x.tag === "lit") {
      if (!sameData(x.value, (y as Lit).value, 0)) return false;
    } else if (x.tag === "ref") {
      const p = (y as Ref).path;
      if (x.path.length !== p.length || x.path.some((s, i) => s !== p[i])) return false;
    } else {
      const other = y as App;
      if (x.op !== other.op || x.args.length !== other.args.length) return false;
      for (let i = 0; i < x.args.length; i++) stack.push([x.args[i]!, other.args[i]!]);
    }
  }
  return true;
};
