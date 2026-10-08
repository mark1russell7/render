import { describe, it, expect } from "vitest";
import { lit, ref, app, deps, mapFreeRefs } from "@render/dsl";

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

  it("deduplicates identical refs", () => {
    const expr = app("+", ref("x"), ref("x"));
    expect(deps(expr)).toEqual([["x"]]);
  });

  it("keeps distinct paths that share a prefix", () => {
    const expr = app("+", ref("x"), ref("x", "y"));
    expect(deps(expr)).toEqual([["x"], ["x", "y"]]);
  });
});

describe("regressions (docs/REVIEW.md)", () => {
  it("R-04: the parameters of a fn form are not dependencies", () => {
    const expr = app("map", ref("list"), app("fn", lit(["x"]), app("+", ref("x", "n"), ref("k"))));
    expect(deps(expr)).toEqual([["list"], ["k"]]);
  });

  it("keeps a path with a space apart from a path of two segments", () => {
    expect(deps(app("+", ref("a b"), ref("a", "b")))).toEqual([["a b"], ["a", "b"]]);
  });
});

describe("mapFreeRefs", () => {
  it("rewrites only the free references", () => {
    const expr = app("+", ref("self", "a"), app("fn", lit(["self"]), ref("self", "b")));
    const out = mapFreeRefs(expr, (r) => ref("i_1", ...r.path.slice(1)));
    expect(out).toEqual(app("+", ref("i_1", "a"), app("fn", lit(["self"]), ref("self", "b"))));
  });

  it("keeps the same object when nothing changes", () => {
    const expr = app("+", lit(1), app("fn", lit(["x"]), ref("x")));
    expect(mapFreeRefs(expr, (r) => r)).toBe(expr);
  });
});

describe("deps of malformed data", () => {
  it("skips a malformed node and does not throw", () => {
    const malformed = { tag: "app", op: "+", args: [ref("a"), "text", { tag: "app", op: "x" }, null] } as unknown as Parameters<typeof deps>[0];
    expect(deps(malformed)).toEqual([["a"]]);
  });
});

describe("deps of a large expression", () => {
  it("removes duplicates also above the scan limit", () => {
    const refs = Array.from({ length: 40 }, (_, i) => ref("n", String(i % 20)));
    expect(deps(app("array", ...refs))).toHaveLength(20);
  });
});
