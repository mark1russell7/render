import type { Expr, Ref } from "./ir.ts";
import { MAX_EXPR_DEPTH } from "./ir.ts";

/** This function tells if a value has the shape of one tree node: a tag, and a path or args of the correct type. */
const isNode = (e: unknown): e is Expr => {
  if (e === null || typeof e !== "object") return false;
  const o = e as { readonly tag?: unknown; readonly path?: unknown; readonly args?: unknown };
  return o.tag === "lit" || (o.tag === "ref" && Array.isArray(o.path)) || (o.tag === "app" && Array.isArray(o.args));
};

/**
 * This function gives the parameter names of a `fn` form, or `undefined` for another node.
 * The form is `fn(lit([...params]), body)`.
 */
export const fnParams = (e: Expr): readonly string[] | undefined => {
  if (!isNode(e) || e.tag !== "app" || e.op !== "fn") return undefined;
  const params = e.args[0];
  if (params?.tag !== "lit" || !Array.isArray(params.value)) return undefined;
  return (params.value as readonly unknown[]).map(String);
};

/**
 * This function visits each free reference of an expression, in the order of the source.
 * A reference is bound, and not free, when its first segment is a parameter of an enclosing `fn` form.
 * The walk skips a malformed node, thus data from an edit cannot make it throw. The walk uses no recursion,
 * thus a very deep tree cannot overflow the stack.
 */
export const forEachFreeRef = (expr: Expr, visit: (r: Ref) => void): void => {
  const stack: [Expr, ReadonlySet<string>][] = [[expr, new Set()]];
  while (stack.length > 0) {
    const [e, bound] = stack.pop()!;
    if (!isNode(e)) continue;
    if (e.tag === "ref") {
      const head = e.path[0];
      if (head === undefined || !bound.has(head)) visit(e);
    } else if (e.tag === "app") {
      const params = fnParams(e);
      const inner = params ? new Set([...bound, ...params]) : bound;
      for (let i = e.args.length - 1; i >= 0; i--) stack.push([e.args[i]!, inner]);
    }
  }
};

/**
 * This function gives a copy of an expression with each free reference replaced.
 * The bound references of `fn` forms stay the same. The function keeps unchanged subtrees.
 * A subtree below `MAX_EXPR_DEPTH` levels stays the same: the interpreter does not evaluate it.
 */
export const mapFreeRefs = (expr: Expr, f: (r: Ref) => Expr): Expr => {
  const walk = (e: Expr, bound: ReadonlySet<string>, depth: number): Expr => {
    if (!isNode(e) || depth > MAX_EXPR_DEPTH) return e;
    switch (e.tag) {
      case "lit":
        return e;
      case "ref": {
        const head = e.path[0];
        return head !== undefined && bound.has(head) ? e : f(e);
      }
      case "app": {
        const params = fnParams(e);
        const inner = params ? new Set([...bound, ...params]) : bound;
        let changed = false;
        const args = e.args.map((a) => {
          const next = walk(a, inner, depth + 1);
          if (next !== a) changed = true;
          return next;
        });
        return changed ? { tag: "app", op: e.op, args } : e;
      }
    }
  };
  return walk(expr, new Set(), 0);
};
