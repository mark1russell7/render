export type None = { readonly tag: "none" };
export type Some<T> = { readonly tag: "some"; readonly value: T };
export type Optional<T> = None | Some<T>;

export const none: None = { tag: "none" };
export const some = <T>(value: T): Some<T> => ({ tag: "some", value });

export const isNone = <T>(o: Optional<T>): o is None => o.tag === "none";
export const isSome = <T>(o: Optional<T>): o is Some<T> => o.tag === "some";

export const map = <T, U>(o: Optional<T>, f: (v: T) => U): Optional<U> =>
  isSome(o) ? some(f(o.value)) : none;

export const flatMap = <T, U>(o: Optional<T>, f: (v: T) => Optional<U>): Optional<U> =>
  isSome(o) ? f(o.value) : none;

export const unwrap = <T>(o: Optional<T>): T | undefined =>
  isSome(o) ? o.value : undefined;

export const fromNullable = <T>(value: T | null | undefined): Optional<NonNullable<T>> =>
  value != null ? some(value as NonNullable<T>) : none;
