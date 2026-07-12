/**
 * Structural equality for node values.
 *
 * Reference equality alone makes every object-producing expression
 * permanently "dirty" (fresh object each evaluation → always propagates,
 * resolveAll never converges). Node values are hydrate-produced plain data,
 * so structural comparison is the right default:
 *
 * - Object.is for primitives (NaN equals NaN, unlike ===)
 * - element-wise for arrays, key-wise for plain objects
 * - anything exotic (class instances, functions, React elements) only
 *   equals itself by reference
 * - depth-capped: beyond MAX_DEPTH, values are treated as changed
 */

const MAX_DEPTH = 32;

const isPlainObject = (v: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const eq = (a: unknown, b: unknown, depth: number): boolean => {
  if (Object.is(a, b)) return true;
  if (depth >= MAX_DEPTH) return false;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;

  if (aArr && bArr) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (!eq(arrA[i], arrB[i], depth + 1)) return false;
    }
    return true;
  }

  if (!isPlainObject(a) || !isPlainObject(b)) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!(k in objB)) return false;
    if (!eq(objA[k], objB[k], depth + 1)) return false;
  }
  return true;
};

/** Structural equality for node values (see module docs) */
export const valueEquals = (a: unknown, b: unknown): boolean => eq(a, b, 0);
