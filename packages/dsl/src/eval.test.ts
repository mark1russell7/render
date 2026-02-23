import { describe, it, expect } from "vitest";
import { lit, ref, app, evaluate } from "@render/dsl";
import type { Ops } from "@render/dsl";
import { some, none, isSome, isNone } from "@render/optional";

const ops: Ops = {
  "+": (a, b) => (a as number) + (b as number),
  "*": (a, b) => (a as number) * (b as number),
};

describe("evaluate", () => {
  it("evaluates a literal to some(value)", () => {
    expect(evaluate(lit(42), {}, {})).toEqual(some(42));
  });

  it("evaluates a ref by walking the context", () => {
    const ctx = { a: { b: 10 } };
    expect(evaluate(ref("a", "b"), ctx, {})).toEqual(some(10));
  });

  it("returns none for a missing ref path", () => {
    const ctx = { a: 1 };
    const result = evaluate(ref("x"), ctx, {});
    expect(isNone(result)).toBe(true);
  });

  it("returns none when ref path walks through a non-object", () => {
    const ctx = { a: 5 };
    const result = evaluate(ref("a", "b"), ctx, {});
    expect(isNone(result)).toBe(true);
  });

  it("evaluates an app by calling the op with resolved args", () => {
    const result = evaluate(app("+", lit(3), lit(4)), {}, ops);
    expect(result).toEqual(some(7));
  });

  it("evaluates nested app expressions", () => {
    // (1 + 2) * 3 = 9
    const expr = app("*", app("+", lit(1), lit(2)), lit(3));
    expect(evaluate(expr, {}, ops)).toEqual(some(9));
  });

  it("returns none for unknown op", () => {
    const result = evaluate(app("unknown", lit(1)), {}, ops);
    expect(isNone(result)).toBe(true);
  });

  it("returns none when an app arg fails to resolve", () => {
    const expr = app("+", ref("missing"), lit(1));
    const result = evaluate(expr, {}, ops);
    expect(isNone(result)).toBe(true);
  });

  it("returns none when op throws", () => {
    const throwingOps: Ops = {
      boom: () => {
        throw new Error("fail");
      },
    };
    const result = evaluate(app("boom"), {}, throwingOps);
    expect(isNone(result)).toBe(true);
  });

  it("can mix refs and lits in an app", () => {
    const ctx = { x: 10 };
    const expr = app("+", ref("x"), lit(5));
    expect(evaluate(expr, ctx, ops)).toEqual(some(15));
  });
});
