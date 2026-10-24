/**
 * The cause of a `none` result. `evaluate` gives the error of the kernel as issues when the caller gives an array.
 *
 * - `unknown-op`: the registry has no op with this name.
 * - `path-miss`: the path of a reference reaches no value. `path` has the segments after the root.
 * - `arg-none`: an argument of the op gave `none`. Each op around the cause adds one, from the inside out.
 * - `op-threw`: the op threw an error. The message of the error is in `message`.
 * - `bad-form`: a form has incorrect arguments, for example an `if` without `then`. `op` names the form.
 * - `bad-expr`: the document is not a valid expression, for example too deep. `message` has the reason of the kernel.
 */
export type EvalIssue = {
  readonly code: "unknown-op" | "path-miss" | "arg-none" | "op-threw" | "bad-form" | "bad-expr";
  readonly op?: string;
  readonly path?: readonly string[];
  readonly message?: string;
};
