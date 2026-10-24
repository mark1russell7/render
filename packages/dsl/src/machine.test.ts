import { describe, it, expect } from "vitest";
import { check, context, isClosure } from "@mark1russell7/coeval";
import { app, checkExpr, evaluate, isExpr, lit, machineOf, objectResolver, plannerOf, record, ref, resolverThing } from "@mark1russell7/render-dsl";
import type { EvalIssue, Expr, Ops } from "@mark1russell7/render-dsl";
import { isNone, none, some } from "@mark1russell7/render-optional";

const ops: Ops = {
  "+": (a: number, b: number) => a + b,
  map: (xs: readonly unknown[], f: (x: unknown) => unknown) => xs.map((x) => f(x)),
  boom: () => { throw new Error("boom"); },
};
const over = objectResolver;

describe("the profile of render", () => {
  it("the truth of a value is the truth of JavaScript", () => {
    for (const [test, want] of [[0, "no"], ["", "no"], [null, "no"], [Number.NaN, "no"], [1, "yes"], ["x", "yes"], [[], "yes"], [{}, "yes"]] as const) {
      expect(evaluate(app("if", lit(test), lit("yes"), lit("no")), over({}), ops)).toEqual(some(want));
    }
    expect(evaluate(app("if", lit(undefined), lit("yes"), lit("no")), over({}), ops)).toEqual(some("no"));
  });

  it("and and or give the value that decided, and stop early", () => {
    expect(evaluate(app("and", lit(1), lit(""), app("boom")), over({}), ops)).toEqual(some(""));
    expect(evaluate(app("and", lit(1), lit(2)), over({}), ops)).toEqual(some(2));
    expect(evaluate(app("or", lit(0), lit(null)), over({}), ops)).toEqual(some(null));
    expect(evaluate(app("or", lit(0), lit("x"), app("boom")), over({}), ops)).toEqual(some("x"));
    expect(evaluate(app("and"), over({}), ops)).toEqual(some(true));
    expect(evaluate(app("or"), over({}), ops)).toEqual(some(false));
  });

  it("an if without else gives undefined", () => {
    expect(evaluate(app("if", lit(0), lit(1)), over({}), ops)).toEqual(some(undefined));
  });

  it("a record leaves out each field whose value fails, for each cause", () => {
    const r = record({ a: lit(1), miss: ref("nope"), threw: app("boom"), unknown: app("nope"), deep: app("+", ref("nope"), lit(1)) });
    expect(evaluate(r, over({}), ops)).toEqual(some({ a: 1 }));
  });

  it("a record field named __proto__ is an own field, and does not change the prototype", () => {
    const r = evaluate(record({ ["__proto__"]: lit({ polluted: true }) }), over({}), ops);
    const v = (r as { value: object }).value;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.keys(v)).toEqual(["__proto__"]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("a reference reads own fields only, and a value with the shape of a reference stays a value", () => {
    const data = { cell: { type: "ref", value: ["world", "secret"] }, secret: 42 };
    expect(evaluate(ref("cell"), over(data), ops)).toEqual(some(data.cell));
    expect(isNone(evaluate(ref("cell", "constructor"), over(data), ops))).toBe(true);
    const lambda = app("fn", lit(["p"]), ref("p", "cell"));
    const f = (evaluate(lambda, over({}), ops) as { value: (p: unknown) => unknown }).value;
    expect(f(data)).toEqual(data.cell);
  });

  it("a parameter reads its fields as plain data, with the length and the items of a list", () => {
    expect(evaluate(app("map", lit([[1, 2, 3], ["a"]]), app("fn", lit(["xs"]), ref("xs", "length"))), over({}), ops)).toEqual(some([3, 1]));
    expect(evaluate(app("map", lit([[5, 6]]), app("fn", lit(["xs"]), ref("xs", "1"))), over({}), ops)).toEqual(some([6]));
  });

  it("a fn is a closure of the kernel, and a failure of its body fails the op that calls it", () => {
    const f = evaluate(app("fn", lit(["x"]), app("+", ref("x"), lit(1))), over({}), ops);
    expect(isClosure((f as { value: unknown }).value)).toBe(true);
    const issues: EvalIssue[] = [];
    expect(evaluate(app("map", lit([1]), app("fn", lit(["x"]), ref("x", "missing"))), over({}), ops, issues)).toEqual(none);
    expect(issues).toEqual([{ code: "path-miss", path: ["x", "missing"] }, { code: "arg-none", op: "map" }]);
  });

  it("the depth limit is 1000 levels", () => {
    const deep = (n: number) => {
      let e = lit(0);
      for (let i = 0; i < n; i++) e = app("+", e, lit(1));
      return e;
    };
    expect(evaluate(deep(1000), over({}), ops)).toEqual(some(1000));
    const issues: EvalIssue[] = [];
    expect(evaluate(deep(1001), over({}), ops, issues)).toEqual(none);
    expect(issues[0]).toEqual({ code: "bad-expr", message: "The nesting is deeper than 1000 documents." });
  });

  it("the root world alone gives the value of the empty path, or no value", () => {
    expect(evaluate(ref(), over({ a: 1 }), ops)).toEqual(some({ a: 1 }));
    expect(evaluate(ref(), () => none, ops)).toEqual(none);
  });

  it("a resolver answers the full path in one call", () => {
    const calls: string[] = [];
    const resolve = (path: readonly string[]) => {
      calls.push(path.join("."));
      return path[0] === "box" ? some(21) : none;
    };
    expect(evaluate(app("+", ref("box", "width"), ref("box", "width")), resolve, ops)).toEqual(some(42));
    expect(calls).toEqual(["box.width", "box.width"]);
    expect(resolverThing(resolve).deref("box")).toBe(21);
    expect(resolverThing(resolve).resolve?.(["box", 0])).toEqual({ thing: 21 });
  });

  it("each op registry has one machine and one planner, and a plan compiles one time for each expression", () => {
    expect(machineOf(ops)).toBe(machineOf(ops));
    expect(machineOf(ops)).not.toBe(machineOf({ ...ops }));
    const e = app("+", lit(1), lit(2));
    expect(plannerOf(ops)(e)).toBe(plannerOf(ops)(e));
    expect(plannerOf(ops)(e).evaluate(context())).toEqual({ ok: true, value: 3 });
  });
});

describe("the behavior of coeval 0.4.2 and 0.4.3", () => {
  it("check with the machine of a registry gives #NAME? for an unknown op, as an evaluation does", () => {
    const unknown = app("nope", lit(1));
    expect(check(machineOf(ops), unknown)).toEqual([{ code: "#NAME?", place: [], reason: "The language has no operation nope.", at: [] }]);
    const issues: EvalIssue[] = [];
    expect(evaluate(unknown, over({}), ops, issues)).toEqual(none);
    expect(issues).toEqual([{ code: "unknown-op", op: "nope" }]);
    expect(check(machineOf(ops), app("+", lit(1), app("map", lit([1]), app("fn", lit(["x"]), ref("x")))))).toEqual([]);
    // A form that its construct cannot hold is an op application of a form, for example if with one argument.
    expect(check(machineOf(ops), app("if", lit(1)))).toEqual([]);
  });

  it("checkExpr has no registry, thus an unknown op is not an issue", () => {
    expect(checkExpr(app("nope", lit(1)))).toEqual([]);
    expect(isExpr(app("nope", lit(1)))).toBe(true);
  });

  it("the parameters of a fn are a list of different texts: check and an evaluation give the same reason", () => {
    const body = { type: "ref", value: ["names", "x"] };
    for (const params of [["x", "x"], [1], "x"]) {
      const doc = { type: "fn", value: { params, body } } as unknown as Expr;
      const found = checkExpr(doc);
      expect(found).toHaveLength(1);
      expect(found[0]?.code).toBe("#VALUE!");
      expect(found[0]?.reason).toMatch(/The kind is fn\.$/u);
      expect(isExpr(doc)).toBe(false);
      const issues: EvalIssue[] = [];
      expect(evaluate(app("map", lit([1]), doc), over({}), ops, issues)).toEqual(none);
      expect(issues[0]).toEqual({ code: "bad-form", op: "fn", message: found[0]?.reason });
    }
    // The builder makes a construct only from different texts. Other parameters stay the op application fn.
    expect(app("fn", lit(["x", "x"]), ref("x")).type).toEqual(["ops", "fn"]);
  });

  it("an endless recursion through an op gives none and a bad-expr issue, not op-threw", () => {
    const world: Record<string, unknown> = {};
    const apply = { ...ops, apply: (f: (x: unknown) => unknown, x: unknown) => f(x) };
    world["f"] = (evaluate(app("fn", lit(["n"]), app("apply", ref("f"), ref("n"))), over(world), apply) as { value: unknown }).value;
    const issues: EvalIssue[] = [];
    expect(evaluate(app("apply", ref("f"), lit(1)), over(world), apply, issues)).toEqual(none);
    expect(issues[0]?.code).toBe("bad-expr");
    expect(issues[0]?.message).toMatch(/too deep/u);
  });
});
