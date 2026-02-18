/** Literal value */
export type Lit = { readonly tag: "lit"; readonly value: unknown };

/** Path reference — navigate a chain of seats to resolve a value */
export type Ref = { readonly tag: "ref"; readonly path: readonly string[] };

/** Operation application — call a named op with expression arguments */
export type App = { readonly tag: "app"; readonly op: string; readonly args: readonly Expr[] };

/** Expression tree — the entire IR */
export type Expr = Lit | Ref | App;

export const lit = (value: unknown): Lit => ({ tag: "lit", value });
export const ref = (...path: readonly string[]): Ref => ({ tag: "ref", path });
export const app = (op: string, ...args: readonly Expr[]): App => ({ tag: "app", op, args });
