import { describe, it, expect } from "vitest";
import { lit, ref, app, deps } from "@render/dsl";

describe("deps", () => {
  it("returns empty array for a literal", () => {
    expect(deps(lit(42))).toEqual([]);
  });

  it("returns the path for a ref", () => {
    expect(deps(ref("a", "b"))).toEqual([["a", "b"]]);
  });

  it("returns single-segment ref path", () => {
    expect(deps(ref("x"))).toEqual([["x"]]);
  });

  it("collects deps from nested app args", () => {
    const expr = app("+", ref("x"), ref("y"));
    expect(deps(expr)).toEqual([["x"], ["y"]]);
  });

  it("collects deps from deeply nested app", () => {
    const expr = app("*", app("+", ref("a"), lit(1)), ref("b"));
    expect(deps(expr)).toEqual([["a"], ["b"]]);
  });

  it("returns empty for app with only literals", () => {
    expect(deps(app("+", lit(1), lit(2)))).toEqual([]);
  });

  it("returns duplicates if same ref appears twice", () => {
    const expr = app("+", ref("x"), ref("x"));
    expect(deps(expr)).toEqual([["x"], ["x"]]);
  });
});
