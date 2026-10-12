/**
 * The Optional of render: a value that is present (`Some`) or absent (`None`). The evaluation of render is total,
 * thus a failure gives `none` and not an exception. The form is structural: any value with the same fields is an
 * Optional of this package.
 */

/** The absence of a value. */
export type None = { readonly tag: "none" };

/** A present value. */
export type Some<T> = { readonly tag: "some"; readonly value: T };

/** A value that is present (`Some`) or absent (`None`). It replaces `null`, `undefined` and exceptions. */
export type Optional<T> = None | Some<T>;

/** The one absent value. */
export const none: None = Object.freeze({ tag: "none" });

/** This function wraps a present value. */
export const some = <T>(value: T): Some<T> => ({ tag: "some", value });

/** This function tells if an optional is absent. */
export const isNone = <T>(o: Optional<T>): o is None => o.tag === "none";

/** This function tells if an optional is present. */
export const isSome = <T>(o: Optional<T>): o is Some<T> => o.tag === "some";

/** This function applies `f` to a present value. An absent value stays absent. */
export const map = <T, U>(o: Optional<T>, f: (v: T) => U): Optional<U> => (isSome(o) ? some(f(o.value)) : none);

/** This function applies `f`, which gives an optional, to a present value. An absent value stays absent. */
export const flatMap = <T, U>(o: Optional<T>, f: (v: T) => Optional<U>): Optional<U> => (isSome(o) ? f(o.value) : none);

/** This function gives the present value, or `undefined`. */
export const unwrap = <T>(o: Optional<T>): T | undefined => (isSome(o) ? o.value : undefined);

/** This function gives the present value, or `fallback`. */
export const getOr = <T, U>(o: Optional<T>, fallback: U): T | U => (isSome(o) ? o.value : fallback);

/** This function wraps a value, and gives `none` for `null` and `undefined`. */
export const fromNullable = <T>(value: T | null | undefined): Optional<NonNullable<T>> =>
  value === null || value === undefined ? none : some(value);

/** This function changes a value of a sentinel form into an optional. The value `sentinel` means "absent". */
export const fromSentinel = <T, S>(value: T | S, sentinel: S): Optional<T> => (value === sentinel ? none : some(value as T));

/** This function changes an optional into a sentinel form: an absent value becomes `sentinel`. */
export const toSentinel = <T, S>(o: Optional<T>, sentinel: S): T | S => (isSome(o) ? o.value : sentinel);
