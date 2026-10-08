import { describe, it, expect } from "vitest";
import { lit, ref, app, record, isExpr, evaluate, objectResolver } from "@render/dsl";
import type { Ops, Expr, EvalIssue } from "@render/dsl";
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
    const issues: EvalIssue[] = [];
    evaluate(app("nope", lit(1)), over({}), ops, issues);
    expect(issues).toContainEqual({ code: "unknown-op", op: "nope" });
  });

  it("records path-miss with the path", () => {
    const issues: EvalIssue[] = [];
    evaluate(ref("ghost", "field"), over({}), ops, issues);
    expect(issues).toContainEqual({ code: "path-miss", path: ["ghost", "field"] });
  });

  it("records op-threw with the message", () => {
    const issues: EvalIssue[] = [];
    const throwing: Ops = { boom: () => { throw new Error("kapow"); } };
    evaluate(app("boom"), over({}), throwing, issues);
    expect(issues).toContainEqual({ code: "op-threw", op: "boom", message: "kapow" });
  });
});

describe("regressions (docs/REVIEW.md)", () => {
  it("R-01: objectResolver reads only own properties", () => {
    expect(isNone(objectResolver({ a: {} })(["a", "constructor"]))).toBe(true);
    expect(isNone(objectResolver({})(["__proto__"]))).toBe(true);
    expect(objectResolver({ a: [10, 20] })(["a", "1"])).toEqual(some(20));
    expect(objectResolver({ a: [10, 20] })(["a", "length"])).toEqual(some(2));
  });

  it("R-02: an op name of Object.prototype is an unknown op", () => {
    const issues: EvalIssue[] = [];
    expect(isNone(evaluate(app("constructor", lit(1)), over({}), ops, issues))).toBe(true);
    expect(isNone(evaluate(app("hasOwnProperty", lit("x")), over({}), ops))).toBe(true);
    expect(issues).toContainEqual({ code: "unknown-op", op: "constructor" });
  });

  it("R-03: a lambda body reaches the outer scope for a name that is not a parameter", () => {
    const expr = app("fn", lit(["x"]), app("+", ref("toString"), ref("x")));
    const f = evaluate(expr, over({ toString: 100 }), ops);
    expect((f as { value: (...a: unknown[]) => unknown }).value(1)).toBe(101);
  });

  it("R-05: a malformed tree gives none and a bad-expr issue, and does not throw", () => {
    const issues: EvalIssue[] = [];
    const malformed = { tag: "app", op: "+", args: ["not an expr", lit(1)] } as unknown as Expr;
    expect(isNone(evaluate(malformed, over({}), ops, issues))).toBe(true);
    expect(issues.some((i) => i.code === "bad-expr")).toBe(true);
    expect(isNone(evaluate({ tag: "app", op: "+" } as unknown as Expr, over({}), ops))).toBe(true);
    expect(isNone(evaluate({ tag: "ref" } as unknown as Expr, over({}), ops))).toBe(true);
    expect(isNone(evaluate(null as unknown as Expr, over({}), ops))).toBe(true);
    expect(isNone(evaluate({ tag: "zap" } as unknown as Expr, over({}), ops))).toBe(true);
  });
});

describe("the record form", () => {
  it("makes an object from name and value pairs", () => {
    expect(evaluate(record({ a: lit(1), b: ref("x") }), over({ x: 2 }), ops)).toEqual(some({ a: 1, b: 2 }));
  });

  it("omits a field whose value is none", () => {
    expect(evaluate(record({ a: lit(1), b: ref("missing") }), over({}), ops)).toEqual(some({ a: 1 }));
  });

  it("keeps a field named __proto__ as an own field", () => {
    const r = evaluate(app("record", lit("__proto__"), lit({ polluted: true })), over({}), ops);
    const v = (r as { value: Record<string, unknown> }).value;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.keys(v)).toEqual(["__proto__"]);
  });

  it("is a bad form with an odd number of arguments or a name that is not a string", () => {
    const issues: EvalIssue[] = [];
    expect(isNone(evaluate(app("record", lit("a")), over({}), ops, issues))).toBe(true);
    expect(isNone(evaluate(app("record", lit({}), lit(1)), over({}), ops, issues))).toBe(true);
    expect(issues.filter((i) => i.code === "bad-form")).toHaveLength(2);
  });
});

describe("isExpr", () => {
  it("accepts well-formed trees and rejects malformed ones at any depth", () => {
    expect(isExpr(app("+", ref("a"), lit(1)))).toBe(true);
    expect(isExpr({ tag: "app", op: "+", args: [lit(1), "x"] })).toBe(false);
    expect(isExpr({ tag: "ref", path: ["a", 1] })).toBe(false);
    expect(isExpr({ tag: "app", op: 3, args: [] })).toBe(false);
    expect(isExpr([lit(1)])).toBe(false);
    expect(isExpr(null)).toBe(false);
    expect(isExpr("lit")).toBe(false);
  });
});
