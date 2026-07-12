import { describe, it, expect } from "vitest";
import { lit, ref, app, evaluate, objectResolver } from "@render/dsl";
import type { Ops } from "@render/dsl";
import { some, none, isNone } from "@render/optional";

const ops: Ops = {
  "+": (a, b) => (a as number) + (b as number),
  "*": (a, b) => (a as number) * (b as number),
};

const over = (ctx: unknown) => objectResolver(ctx);

describe("evaluate", () => {
  it("evaluates a literal to some(value)", () => {
    expect(evaluate(lit(42), over({}), {})).toEqual(some(42));
  });

  it("evaluates a ref through the resolver", () => {
    const ctx = { a: { b: 10 } };
    expect(evaluate(ref("a", "b"), over(ctx), {})).toEqual(some(10));
  });

  it("returns none for a missing ref path", () => {
    const result = evaluate(ref("x"), over({ a: 1 }), {});
    expect(isNone(result)).toBe(true);
  });

  it("returns none when ref path walks through a non-object", () => {
    const result = evaluate(ref("a", "b"), over({ a: 5 }), {});
    expect(isNone(result)).toBe(true);
  });

  it("evaluates an app by calling the op with resolved args", () => {
    const result = evaluate(app("+", lit(3), lit(4)), over({}), ops);
    expect(result).toEqual(some(7));
  });

  it("evaluates nested app expressions", () => {
    // (1 + 2) * 3 = 9
    const expr = app("*", app("+", lit(1), lit(2)), lit(3));
    expect(evaluate(expr, over({}), ops)).toEqual(some(9));
  });

  it("returns none for unknown op", () => {
    const result = evaluate(app("unknown", lit(1)), over({}), ops);
    expect(isNone(result)).toBe(true);
  });

  it("returns none when an app arg fails to resolve", () => {
    const expr = app("+", ref("missing"), lit(1));
    const result = evaluate(expr, over({}), ops);
    expect(isNone(result)).toBe(true);
  });

  it("returns none when op throws", () => {
    const throwingOps: Ops = {
      boom: () => {
        throw new Error("fail");
      },
    };
    const result = evaluate(app("boom"), over({}), throwingOps);
    expect(isNone(result)).toBe(true);
  });

  it("can mix refs and lits in an app", () => {
    const expr = app("+", ref("x"), lit(5));
    expect(evaluate(expr, over({ x: 10 }), ops)).toEqual(some(15));
  });

  it("accepts a custom resolver (resolution is a call, not a context)", () => {
    const resolver = (path: readonly string[]) =>
      path[0] === "answer" ? some(41) : none;
    expect(evaluate(app("+", ref("answer"), lit(1)), resolver, ops)).toEqual(some(42));
  });
});
