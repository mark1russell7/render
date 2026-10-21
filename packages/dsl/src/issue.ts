/**
 * The cause of a `none` result.
 *
 * The interpreter collects issues when the caller gives an array. Evaluation stays total, and each failure has a cause.
 * - `unknown-op`: the registry has no op with this name.
 * - `path-miss`: the resolver has no value at the path.
 * - `arg-none`: an argument of the op gave `none`.
 * - `op-threw`: the op threw an error. The message of the error is in `message`.
 * - `bad-form`: a special form has incorrect arguments.
 * - `bad-expr`: a node of the tree is not a valid expression, or a document is not a valid document of an expression.
 */
export type EvalIssue = {
  readonly code: "unknown-op" | "path-miss" | "arg-none" | "op-threw" | "bad-form" | "bad-expr";
  readonly op?: string;
  readonly path?: readonly string[];
  readonly message?: string;
};
