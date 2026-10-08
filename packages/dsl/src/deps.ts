import type { Expr } from "./ir.ts";
import { forEachFreeRef } from "./scope.ts";

/** A dependency path: the segments that an expression reads through. */
export type DepPath = readonly string[];

const samePath = (a: DepPath, b: DepPath): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Above this number of paths, the function finds duplicates with a set of keys and not with a scan. */
const SCAN_LIMIT = 16;

/**
 * This function gives the free reference paths of an expression, without duplicates, in the order of the first read.
 * The parameters of a `fn` form are not dependencies.
 */
export const deps = (expr: Expr): DepPath[] => {
  const out: DepPath[] = [];
  let keys: Set<string> | null = null;
  forEachFreeRef(expr, (r) => {
    if (keys === null && out.length < SCAN_LIMIT) {
      if (!out.some((p) => samePath(p, r.path))) out.push(r.path);
      return;
    }
    // The JSON form of a path is a key without ambiguity: ["a b"] and ["a", "b"] stay separate.
    keys ??= new Set(out.map((p) => JSON.stringify(p)));
    const key = JSON.stringify(r.path);
    if (!keys.has(key)) {
      keys.add(key);
      out.push(r.path);
    }
  });
  return out;
};
