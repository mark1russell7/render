import { none, some } from "@mark1russell7/render-optional";
import { describe, expect, it } from "vitest";
import { formatValue } from "./format.ts";

describe("formatValue", () => {
  it("gives none for an absent value", () => {
    expect(formatValue(none)).toBe("none");
  });

  it("gives the JSON of a value", () => {
    expect(formatValue(some(3))).toBe("3");
    expect(formatValue(some("up"))).toBe("\"up\"");
    expect(formatValue(some({ a: [1, 2] }))).toBe("{\"a\":[1,2]}");
    expect(formatValue(some(null))).toBe("null");
  });

  it("names a function and an undefined value", () => {
    expect(formatValue(some(() => 1))).toBe("a function");
    expect(formatValue(some(undefined))).toBe("undefined");
  });

  it("gives the text of a value with no JSON form, and does not throw", () => {
    expect(formatValue(some(10n))).toBe("10");
    expect(formatValue(some(Symbol("s")))).toBe("Symbol(s)");
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(formatValue(some(cycle))).toBe("[cyclic]");
  });
});
