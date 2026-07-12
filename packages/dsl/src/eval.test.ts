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

describe("special forms (Phase 4)", () => {
  it("if is lazy: the unselected branch never evaluates", () => {
    let boomCalls = 0;
    const lazyOps: Ops = {
      ...ops,
      boom: () => {
        boomCalls++;
        throw new Error("should not run");
      },
    };
    const expr = app("if", lit(true), lit("yes"), app("boom"));
    expect(evaluate(expr, over({}), lazyOps)).toEqual(some("yes"));
    expect(boomCalls).toBe(0);

    // A poisoned branch only matters when selected
    const expr2 = app("if", lit(false), app("boom"), lit("no"));
    expect(evaluate(expr2, over({}), lazyOps)).toEqual(some("no"));
    expect(boomCalls).toBe(0);
  });

  it("and/or short-circuit", () => {
    let calls = 0;
    const spyOps: Ops = {
      tick: () => {
        calls++;
        return true;
      },
    };
    expect(evaluate(app("and", lit(false), app("tick")), over({}), spyOps)).toEqual(some(false));
    expect(calls).toBe(0);
    expect(evaluate(app("or", lit(true), app("tick")), over({}), spyOps)).toEqual(some(true));
    expect(calls).toBe(0);
    expect(evaluate(app("and", lit(1), lit(2)), over({}), {})).toEqual(some(2));
    expect(evaluate(app("or", lit(0), lit(3)), over({}), {})).toEqual(some(3));
  });

  it("fn produces a closure usable by map", () => {
    const mapOps: Ops = {
      ...ops,
      map: (list, f) =>
        Array.isArray(list) && typeof f === "function"
          ? list.map(f as (item: unknown) => unknown)
          : [],
    };
    // map([1,2,3], fn(x → x * 10))
    const expr = app("map",
      lit([1, 2, 3]),
      app("fn", lit(["x"]), app("*", ref("x"), lit(10))),
    );
    expect(evaluate(expr, over({}), mapOps)).toEqual(some([10, 20, 30]));
  });

  it("fn params shadow outer scope; other refs still reach it", () => {
    const expr = app("fn", lit(["x"]), app("+", ref("x"), ref("outer")));
    const result = evaluate(expr, over({ outer: 100, x: -1 }), ops);
    const f = (result as { value: (...a: unknown[]) => unknown }).value;
    expect(f(1)).toBe(101);
  });
});

describe("issue collection (Phase 4)", () => {
  it("records unknown-op with the op name", () => {
    const issues: import("@render/dsl").EvalIssue[] = [];
    evaluate(app("nope", lit(1)), over({}), ops, issues);
    expect(issues).toContainEqual({ code: "unknown-op", op: "nope" });
  });

  it("records path-miss with the path", () => {
    const issues: import("@render/dsl").EvalIssue[] = [];
    evaluate(ref("ghost", "field"), over({}), ops, issues);
    expect(issues).toContainEqual({ code: "path-miss", path: ["ghost", "field"] });
  });

  it("records op-threw with the message", () => {
    const issues: import("@render/dsl").EvalIssue[] = [];
    const throwing: Ops = { boom: () => { throw new Error("kapow"); } };
    evaluate(app("boom"), over({}), throwing, issues);
    expect(issues).toContainEqual({ code: "op-threw", op: "boom", message: "kapow" });
  });
});
