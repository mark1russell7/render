import { describe, it, expect } from "vitest";
import {
  some,
  none,
  isSome,
  isNone,
  map,
  flatMap,
  unwrap,
  fromNullable,
} from "@render/optional";

describe("some", () => {
  it("creates a Some from a string", () => {
    expect(some("hello")).toEqual({ tag: "some", value: "hello" });
  });

  it("creates a Some from a number", () => {
    expect(some(42)).toEqual({ tag: "some", value: 42 });
  });

  it("creates a Some from an object", () => {
    const obj = { a: 1 };
    const result = some(obj);
    expect(result).toEqual({ tag: "some", value: { a: 1 } });
    expect(result.value).toBe(obj);
  });
});

describe("none", () => {
  it("is a None value", () => {
    expect(none).toEqual({ tag: "none" });
  });
});

describe("isSome", () => {
  it("returns true for Some", () => {
    expect(isSome(some(1))).toBe(true);
  });

  it("returns false for None", () => {
    expect(isSome(none)).toBe(false);
  });
});

describe("isNone", () => {
  it("returns true for None", () => {
    expect(isNone(none)).toBe(true);
  });

  it("returns false for Some", () => {
    expect(isNone(some(1))).toBe(false);
  });
});

describe("map", () => {
  it("applies function to Some value", () => {
    expect(map(some(2), (x) => x * 3)).toEqual(some(6));
  });

  it("returns None for None input", () => {
    expect(map(none, (x: number) => x * 3)).toBe(none);
  });
});

describe("flatMap", () => {
  it("applies function returning Optional to Some value", () => {
    const result = flatMap(some(5), (x) => (x > 0 ? some(x * 2) : none));
    expect(result).toEqual(some(10));
  });

  it("returns None when function returns None", () => {
    const result = flatMap(some(-1), (x) => (x > 0 ? some(x) : none));
    expect(result).toBe(none);
  });

  it("returns None for None input", () => {
    expect(flatMap(none, () => some(1))).toBe(none);
  });
});

describe("unwrap", () => {
  it("returns value for Some", () => {
    expect(unwrap(some("ok"))).toBe("ok");
  });

  it("returns undefined for None", () => {
    expect(unwrap(none)).toBeUndefined();
  });
});

describe("fromNullable", () => {
  it("converts null to None", () => {
    expect(fromNullable(null)).toBe(none);
  });

  it("converts undefined to None", () => {
    expect(fromNullable(undefined)).toBe(none);
  });

  it("converts a value to Some", () => {
    expect(fromNullable(42)).toEqual(some(42));
  });

  it("converts empty string to Some (not null/undefined)", () => {
    expect(fromNullable("")).toEqual(some(""));
  });
});
