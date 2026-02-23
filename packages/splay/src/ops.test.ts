import { describe, it, expect } from "vitest";
import { standardOps } from "@render/splay";

describe("standardOps", () => {
  it('"+" adds two numbers', () => {
    expect(standardOps["+"](3, 4)).toBe(7);
  });

  it('"-" subtracts two numbers', () => {
    expect(standardOps["-"](10, 3)).toBe(7);
  });

  it('"*" multiplies two numbers', () => {
    expect(standardOps["*"](3, 4)).toBe(12);
  });

  it('"/" divides two numbers', () => {
    expect(standardOps["/"](12, 4)).toBe(3);
  });

  it('"max" returns the larger number', () => {
    expect(standardOps["max"](3, 7)).toBe(7);
    expect(standardOps["max"](10, 2)).toBe(10);
  });

  it('"min" returns the smaller number', () => {
    expect(standardOps["min"](3, 7)).toBe(3);
    expect(standardOps["min"](10, 2)).toBe(2);
  });

  it('"get" returns property from object', () => {
    const obj = { foo: 42, bar: "hello" };
    expect(standardOps["get"](obj, "foo")).toBe(42);
    expect(standardOps["get"](obj, "bar")).toBe("hello");
  });

  it('"get" returns undefined for non-object', () => {
    expect(standardOps["get"](null, "foo")).toBeUndefined();
    expect(standardOps["get"](42, "foo")).toBeUndefined();
  });

  it('"if" returns then-branch when truthy', () => {
    expect(standardOps["if"](true, "yes", "no")).toBe("yes");
    expect(standardOps["if"](1, "yes", "no")).toBe("yes");
  });

  it('"if" returns else-branch when falsy', () => {
    expect(standardOps["if"](false, "yes", "no")).toBe("no");
    expect(standardOps["if"](0, "yes", "no")).toBe("no");
  });

  it('"concat" joins arguments as strings', () => {
    expect(standardOps["concat"]("a", "b", "c")).toBe("abc");
    expect(standardOps["concat"]("count: ", 42)).toBe("count: 42");
  });

  it('"eq" checks strict equality', () => {
    expect(standardOps["eq"](1, 1)).toBe(true);
    expect(standardOps["eq"](1, "1")).toBe(false);
    expect(standardOps["eq"]("a", "a")).toBe(true);
  });

  it('"typeof" returns JavaScript typeof', () => {
    expect(standardOps["typeof"]("hello")).toBe("string");
    expect(standardOps["typeof"](42)).toBe("number");
    expect(standardOps["typeof"](true)).toBe("boolean");
    expect(standardOps["typeof"](undefined)).toBe("undefined");
  });

  it('"map" maps a function over an array', () => {
    const double = (x: unknown) => (x as number) * 2;
    expect(standardOps["map"]([1, 2, 3], double)).toEqual([2, 4, 6]);
  });

  it('"map" returns empty array for non-array input', () => {
    expect(standardOps["map"]("not array", () => 0)).toEqual([]);
  });

  it('"props" creates object from key-value pairs', () => {
    expect(standardOps["props"]("a", 1, "b", 2)).toEqual({ a: 1, b: 2 });
  });

  it('"array" creates an array from arguments', () => {
    expect(standardOps["array"](1, 2, 3)).toEqual([1, 2, 3]);
    expect(standardOps["array"]()).toEqual([]);
  });

  it('"str" coerces to string', () => {
    expect(standardOps["str"](42)).toBe("42");
    expect(standardOps["str"](null)).toBe("");
    expect(standardOps["str"](undefined)).toBe("");
  });

  it('"toString" converts value to string', () => {
    expect(standardOps["toString"](123)).toBe("123");
    expect(standardOps["toString"](true)).toBe("true");
  });

  it('"textWidth" returns string length', () => {
    expect(standardOps["textWidth"]("hello")).toBe(5);
    expect(standardOps["textWidth"]("")).toBe(0);
  });

  it('"textHeight" returns 1', () => {
    expect(standardOps["textHeight"]("anything")).toBe(1);
    expect(standardOps["textHeight"]("")).toBe(1);
  });
});
