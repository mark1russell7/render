import { describe, it, expect } from "vitest";
import { standardOps } from "@render/splay";

const op = (name: string): ((...args: readonly unknown[]) => unknown) => {
  const f = standardOps[name];
  if (!f) throw new Error(`no op ${name}`);
  return f;
};

describe("standardOps", () => {
  it('"+" adds two numbers', () => {
    expect(op("+")(3, 4)).toBe(7);
  });

  it('"-" subtracts two numbers', () => {
    expect(op("-")(10, 3)).toBe(7);
  });

  it('"*" multiplies two numbers', () => {
    expect(op("*")(3, 4)).toBe(12);
  });

  it('"/" divides two numbers', () => {
    expect(op("/")(12, 4)).toBe(3);
  });

  it('"max" returns the larger number', () => {
    expect(op("max")(3, 7)).toBe(7);
    expect(op("max")(10, 2)).toBe(10);
  });

  it('"min" returns the smaller number', () => {
    expect(op("min")(3, 7)).toBe(3);
    expect(op("min")(10, 2)).toBe(2);
  });

  it('"get" returns property from object', () => {
    const obj = { foo: 42, bar: "hello" };
    expect(op("get")(obj, "foo")).toBe(42);
    expect(op("get")(obj, "bar")).toBe("hello");
  });

  it('"get" returns undefined for non-object', () => {
    expect(op("get")(null, "foo")).toBeUndefined();
    expect(op("get")(42, "foo")).toBeUndefined();
  });

  it('"if" returns then-branch when truthy', () => {
    expect(op("if")(true, "yes", "no")).toBe("yes");
    expect(op("if")(1, "yes", "no")).toBe("yes");
  });

  it('"if" returns else-branch when falsy', () => {
    expect(op("if")(false, "yes", "no")).toBe("no");
    expect(op("if")(0, "yes", "no")).toBe("no");
  });

  it('"concat" joins arguments as strings', () => {
    expect(op("concat")("a", "b", "c")).toBe("abc");
    expect(op("concat")("count: ", 42)).toBe("count: 42");
  });

  it('"eq" checks strict equality', () => {
    expect(op("eq")(1, 1)).toBe(true);
    expect(op("eq")(1, "1")).toBe(false);
    expect(op("eq")("a", "a")).toBe(true);
  });

  it('"typeof" returns JavaScript typeof', () => {
    expect(op("typeof")("hello")).toBe("string");
    expect(op("typeof")(42)).toBe("number");
    expect(op("typeof")(true)).toBe("boolean");
    expect(op("typeof")(undefined)).toBe("undefined");
  });

  it('"map" maps a function over an array', () => {
    const double = (x: unknown) => (x as number) * 2;
    expect(op("map")([1, 2, 3], double)).toEqual([2, 4, 6]);
  });

  it('"map" returns empty array for non-array input', () => {
    expect(op("map")("not array", () => 0)).toEqual([]);
  });

  it('"props" creates object from key-value pairs', () => {
    expect(op("props")("a", 1, "b", 2)).toEqual({ a: 1, b: 2 });
  });

  it('"array" creates an array from arguments', () => {
    expect(op("array")(1, 2, 3)).toEqual([1, 2, 3]);
    expect(op("array")()).toEqual([]);
  });

  it('"str" coerces to string', () => {
    expect(op("str")(42)).toBe("42");
    expect(op("str")(null)).toBe("");
    expect(op("str")(undefined)).toBe("");
  });

  it('"toString" converts value to string', () => {
    expect(op("toString")(123)).toBe("123");
    expect(op("toString")(true)).toBe("true");
  });

  it('"textWidth" returns string length', () => {
    expect(op("textWidth")("hello")).toBe(5);
    expect(op("textWidth")("")).toBe(0);
  });

  it('"textHeight" returns 1', () => {
    expect(op("textHeight")("anything")).toBe(1);
    expect(op("textHeight")("")).toBe(1);
  });
});
