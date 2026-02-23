import { describe, it, expect } from "vitest";
import { lit, ref, app } from "@render/dsl";

describe("lit", () => {
  it("creates a literal node with the given value", () => {
    expect(lit(42)).toEqual({ tag: "lit", value: 42 });
  });

  it("wraps strings", () => {
    expect(lit("hello")).toEqual({ tag: "lit", value: "hello" });
  });

  it("wraps null", () => {
    expect(lit(null)).toEqual({ tag: "lit", value: null });
  });
});

describe("ref", () => {
  it("creates a reference with a single-segment path", () => {
    expect(ref("a")).toEqual({ tag: "ref", path: ["a"] });
  });

  it("creates a reference with a multi-segment path", () => {
    expect(ref("a", "b")).toEqual({ tag: "ref", path: ["a", "b"] });
  });
});

describe("app", () => {
  it("creates an application node with op and args", () => {
    const result = app("+", lit(1), lit(2));
    expect(result).toEqual({
      tag: "app",
      op: "+",
      args: [
        { tag: "lit", value: 1 },
        { tag: "lit", value: 2 },
      ],
    });
  });

  it("creates an application with zero args", () => {
    expect(app("noop")).toEqual({ tag: "app", op: "noop", args: [] });
  });

  it("nests expressions", () => {
    const result = app("*", app("+", lit(1), lit(2)), lit(3));
    expect(result.tag).toBe("app");
    expect(result.op).toBe("*");
    expect(result.args).toHaveLength(2);
    expect(result.args[0]).toEqual(app("+", lit(1), lit(2)));
  });
});
