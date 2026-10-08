/**
 * Structural equality for node values.
 *
 * With reference equality only, each expression that makes an object is always dirty: each evaluation
 * gives a new object, and each epoch propagates it. Node values are plain data, thus the default is structural:
 *
 * - `Object.is` for primitives, thus `NaN` is equal to `NaN`.
 * - Element by element for arrays, own key by own key for plain objects.
 * - An exotic object (a class instance, a function, a React element) is equal only to itself.
 * - Below `MAX_DEPTH` levels, two values are not equal. This limit also stops a cyclic value.
 */

const MAX_DEPTH = 32;

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** This function tells if a value is a plain object: its prototype is `Object.prototype` or `null`. */
export const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const eq = (a: unknown, b: unknown, depth: number): boolean => {
  if (Object.is(a, b)) return true;
  if (depth >= MAX_DEPTH) return false;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!eq(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }

  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const k of keysA) {
    if (!hasOwn(b, k) || !eq(a[k], b[k], depth + 1)) return false;
  }
  return true;
};

/** This function compares two node values structurally. The module comment gives the rules. */
export const valueEquals = (a: unknown, b: unknown): boolean => eq(a, b, 0);
