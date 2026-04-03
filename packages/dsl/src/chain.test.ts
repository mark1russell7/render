import { describe, it, expect } from "vitest";
import { chain, ref, lit, app } from "@render/dsl";

describe("chain", () => {
  it("builds a ref expression", () => {
    const expr = chain().ref("x").build();
    expect(expr).toEqual(ref("x"));
  });

  it("builds a multi-segment ref", () => {
    const expr = chain().ref("a", "b", "c").build();
    expect(expr).toEqual(ref("a", "b", "c"));
  });

  it("builds ref.app with a primitive arg", () => {
    const expr = chain().ref("x").app("+", 1).build();
    /**
     * {
     *    $apply : {
     *       operation : "+",
     *       args : [
     *          { $ref : x },
     *          { $lit : 1 }
     *       ] 
     *    }
     * }
     * 
     * 
     */
    expect(expr).toEqual(app("+", ref("x"), lit(1)));
  });

  it("builds chained app calls", () => {
    // ref("x").app("+", 1).app("*", 2) => app("*", app("+", ref("x"), lit(1)), lit(2))
    const expr = chain().ref("x").app("+", 1).app("*", 2).build();
    expect(expr).toEqual(app("*", app("+", ref("x"), lit(1)), lit(2)));
  });

  it("normalizes string args to lit", () => {
    const expr = chain().ref("x").app("concat", "hello").build();
    expect(expr).toEqual(app("concat", ref("x"), lit("hello")));
  });

  it("passes Expr args through unchanged", () => {
    const expr = chain().ref("x").app("+", ref("y")).build();
    expect(expr).toEqual(app("+", ref("x"), ref("y")));
  });

  it("throws on empty chain build()", () => {
    expect(() => chain().build()).toThrow("Empty chain");
  });

  it("app without prior expr uses args only (no leading undefined)", () => {
    const expr = chain().app("+", 1, 2).build();
    expect(expr).toEqual(app("+", lit(1), lit(2)));
  });
});
