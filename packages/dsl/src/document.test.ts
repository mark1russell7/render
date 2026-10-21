import { describe, it, expect } from "vitest";
import { docEquals, refsOf } from "@mark1russell7/coeval";
import {
  app, checkExpr, evaluate, formatExpr, isExpr, lit, literalOf, objectResolver, opOf, parseExpr, record, ref, renderWorld,
} from "@mark1russell7/render-dsl";
import type { EvalIssue, Expr, Ops } from "@mark1russell7/render-dsl";
import { isSome, none, some } from "@mark1russell7/render-optional";
import type { Optional } from "@mark1russell7/render-optional";

const viaJson = (e: Expr): Expr => JSON.parse(JSON.stringify(e)) as Expr;

const parsed = (text: string): Expr => {
  const r = parseExpr(text);
  if (!r.ok) throw new Error(`${r.message} at ${String(r.offset)}`);
  return r.expr;
};

/** A deep chain of `f(f(...f(1)))`: a document whose depth is `levels`. */
const chainOf = (levels: number): Expr => {
  let e: Expr = lit(1);
  for (let i = 0; i < levels; i++) e = app("f", e);
  return e;
};

/** Each kind of term and each form. Each entry is JSON safe: JSON text keeps its document. */
const CORPUS: readonly (readonly [string, Expr])[] = [
  ["a number", lit(42)],
  ["a text", lit("text")],
  ["true", lit(true)],
  ["null", lit(null)],
  ["an array", lit([1, "a", [null, true]])],
  ["an object", lit({ a: 1, b: { c: [2] } })],
  ["undefined", lit(undefined)],
  ["NaN", lit(Number.NaN)],
  ["-Infinity", lit(Number.NEGATIVE_INFINITY)],
  ["-0", lit(-0)],
  ["a literal with the shape of a reference", lit({ type: "ref", value: ["world", "a"] })],
  ["a literal with the shape of an op", lit({ type: ["ops", "+"], value: [1, 2] })],
  ["a literal with the shape of an envelope with a header", lit({ type: "x", value: 1, name: "n", own: { view: "v" } })],
  ["an empty path", ref()],
  ["a path with an index", ref("a", "b", "0")],
  ["segments with dots and backticks", ref("a.b", "`x`", "")],
  ["a path that starts with names", ref("names", "x")],
  ["a path that starts with self", ref("self", "cells")],
  ["an infix op", app("+", lit(1), lit(2))],
  ["an op with dots", app("a.b", ref("x"))],
  ["an empty op name", app("")],
  ["an op name with empty keys", app(".a..b.")],
  ["if", app("if", ref("c"), lit(1), lit(2))],
  ["if without else", app("if", ref("c"), lit(1))],
  ["an if with one argument", app("if", ref("c"))],
  ["and", app("and", ref("a"), ref("b"), lit(true))],
  ["or", app("or", ref("a"), lit(false))],
  ["a record", record({ area: app("*", ref("w"), ref("h")), label: lit("box") })],
  ["a record field __proto__", app("record", lit("__proto__"), lit(1))],
  ["a record with an index name later", app("record", lit("b"), lit(2), lit("1"), lit(1))],
  ["a record with a computed name", app("record", ref("k"), lit(1))],
  ["a record with an odd number of arguments", app("record", lit("a"))],
  ["a lambda with a bound and a free reference", app("fn", lit(["x"]), app("+", ref("x"), ref("y")))],
  ["nested lambdas with shadowing", app("fn", lit(["x"]), app("fn", lit(["x", "y"]), app("+", ref("x"), ref("y"), ref("z"))))],
  ["an inner lambda that reads an outer parameter", app("fn", lit(["x"]), app("fn", lit(["y"]), app("+", ref("x"), ref("y"))))],
  ["a lambda that is applied", app("map", ref("items"), app("fn", lit(["x"]), app("*", ref("x"), ref("scale"))))],
  ["a lambda with computed parameters", app("fn", ref("p"), ref("x"))],
  ["a lambda with a repeated parameter", app("fn", lit(["x", "x"]), ref("x"))],
  [
    "the summary of ClassDef in the viewer",
    app("call",
      app("fn", lit(["d"]),
        app("boundaryView",
          app("get", ref("d"), lit("extends")),
          app("keys", app("or", app("get", ref("d"), lit("cells")), lit({}))),
          app("keys", app("or", app("get", ref("d"), lit("methods")), lit({}))))),
      app("call", ref("self", "dehydrate"))),
  ],
  ["specials in arguments", app("f", lit(undefined), lit(Number.NaN), lit(-0), lit(Number.POSITIVE_INFINITY))],
  ["a document at the depth limit", chainOf(1000)],
];

describe("the builders write the documents of D12 and D13", () => {
  it("a literal is its JSON value in a position that holds terms, and the root is a lit envelope", () => {
    expect(app("+", lit(1), lit("a"))).toEqual({ type: ["ops", "+"], value: [1, "a"] });
    expect(lit(5)).toEqual({ type: "lit", value: 5 });
    expect(lit([1, 2])).toEqual({ type: "lit", value: [1, 2] });
  });

  it("a literal with the shape of an envelope is a lit envelope in each position", () => {
    const shaped = { type: "x", value: 1 };
    expect(lit(shaped)).toEqual({ type: "lit", value: shaped });
    expect(app("id", lit(shaped))).toEqual({ type: ["ops", "id"], value: [{ type: "lit", value: shaped }] });
  });

  it("an op application has the type ops and the keys of the op name", () => {
    expect(app("a.b", ref("x"))).toEqual({ type: ["ops", "a", "b"], value: [{ type: "ref", value: ["world", "x"] }] });
    expect(opOf(app("a.b"))).toBe("a.b");
    expect(opOf(lit(1))).toBeUndefined();
    expect(opOf("text")).toBeUndefined();
  });

  it("if, and and or are the constructs of the kernel", () => {
    // oxlint-disable-next-line unicorn/no-thenable -- the construct if of the kernel has the field then
    expect(app("if", ref("c"), lit(1), lit(2))).toEqual({ type: "if", value: { test: { type: "ref", value: ["world", "c"] }, then: 1, else: 2 } });
    // oxlint-disable-next-line unicorn/no-thenable -- the construct if of the kernel has the field then
    expect(app("if", ref("c"), lit(1))).toEqual({ type: "if", value: { test: { type: "ref", value: ["world", "c"] }, then: 1 } });
    expect(app("and", lit(1), ref("b"))).toEqual({ type: "and", value: [1, { type: "ref", value: ["world", "b"] }] });
    expect(app("or")).toEqual({ type: "or", value: [] });
  });

  it("a free reference starts at world, and a parameter of an enclosing fn starts at names", () => {
    expect(ref("box", "width")).toEqual({ type: "ref", value: ["world", "box", "width"] });
    expect(app("fn", lit(["x"]), app("+", ref("x", "a"), ref("y")))).toEqual({
      type: "fn",
      value: {
        params: ["x"],
        body: { type: ["ops", "+"], value: [{ type: "ref", value: ["names", "x", "a"] }, { type: "ref", value: ["world", "y"] }] },
      },
    });
    expect(app("fn", lit(["x"]), lit(1))).toEqual({ type: "fn", value: { params: ["x"], body: 1 } });
  });

  it("an inner fn binds its parameters in addition to the outer parameters", () => {
    const doc = app("fn", lit(["x"]), app("fn", lit(["y"]), app("f", ref("x"), ref("y"), ref("z"))));
    expect(doc).toEqual({
      type: "fn",
      value: {
        params: ["x"],
        body: {
          type: "fn",
          value: {
            params: ["y"],
            body: {
              type: ["ops", "f"],
              value: [{ type: "ref", value: ["names", "x"] }, { type: "ref", value: ["names", "y"] }, { type: "ref", value: ["world", "z"] }],
            },
          },
        },
      },
    });
  });

  it("a record is the record construct", () => {
    expect(record({ area: app("*", ref("w"), lit(2)), label: lit("box") })).toEqual({
      type: "record",
      value: { area: { type: ["ops", "*"], value: [{ type: "ref", value: ["world", "w"] }, 2] }, label: "box" },
    });
    expect(app("record", lit("a"), lit(1))).toEqual({ type: "record", value: { a: 1 } });
  });

  it("a form that a construct cannot hold stays an op application", () => {
    expect(app("record", ref("k"), lit(1))).toEqual({ type: ["ops", "record"], value: [{ type: "ref", value: ["world", "k"] }, 1] });
    expect(app("record", lit("b"), lit(2), lit("1"), lit(1))).toEqual({ type: ["ops", "record"], value: ["b", 2, "1", 1] });
    expect(app("fn", lit(["x"]), ref("x"), ref("x"))).toEqual({
      type: ["ops", "fn"],
      value: [["x"], { type: "ref", value: ["world", "x"] }, { type: "ref", value: ["world", "x"] }],
    });
    expect(app("if", ref("c"))).toEqual({ type: ["ops", "if"], value: [{ type: "ref", value: ["world", "c"] }] });
  });

  it("a value that JSON cannot write is an extension, and literalOf reads it back", () => {
    expect(lit(undefined)).toEqual({ type: ["ext", "undefined"], value: null });
    expect(app("f", lit(Number.NaN), lit(-0), lit(Number.POSITIVE_INFINITY), lit(Number.NEGATIVE_INFINITY))).toEqual({
      type: ["ops", "f"],
      value: [
        { type: ["ext", "number"], value: "NaN" },
        { type: ["ext", "number"], value: "-0" },
        { type: ["ext", "number"], value: "Infinity" },
        { type: ["ext", "number"], value: "-Infinity" },
      ],
    });
    expect(literalOf(lit(undefined))).toEqual({ value: undefined });
    expect(Object.is(literalOf(lit(-0))?.value, -0)).toBe(true);
    expect(literalOf({ type: ["ext", "number"], value: "1" })).toBeUndefined();
    expect(literalOf({ type: ["ext", "date"], value: "2026" })).toBeUndefined();
    expect(literalOf(ref("a"))).toBeUndefined();
  });

  it("a literal that JSON cannot write stays in the document in memory", () => {
    const f = (): number => 1;
    expect(lit(f)).toEqual({ type: "lit", value: f });
    expect(app("call", lit(f))).toEqual({ type: ["ops", "call"], value: [f] });
  });

  it("the world references are the free references of the kernel, in the order of the document", () => {
    const paths = (e: Expr): string[][] =>
      refsOf(renderWorld, e).filter((use) => use.free && use.root === "world").map((use) => use.path.slice(1).map(String));
    expect(paths(app("map", ref("list"), app("fn", lit(["x"]), app("+", ref("x", "n"), ref("k")))))).toEqual([["list"], ["k"]]);
    expect(paths(app("+", ref("a b"), ref("a", "b")))).toEqual([["a b"], ["a", "b"]]);
  });
});

describe("the text form of a document", () => {
  it.each(CORPUS)("parseExpr(formatExpr(e)) is e, also after JSON text: %s", (_name, e) => {
    const text = formatExpr(e);
    expect(docEquals(parsed(text), e)).toBe(true);
    expect(formatExpr(viaJson(e))).toBe(text);
    expect(isExpr(e)).toBe(true);
  });

  it("a part that the text cannot write gives an ellipsis, which the parser refuses", () => {
    const docs: readonly Expr[] = [
      { type: "let", value: { bind: { a: 1 }, body: { type: "ref", value: ["names", "a"] } } },
      { type: "list", value: [1, 2] },
      { type: "call", value: { fn: { type: "ref", value: ["world", "f"] }, args: [] } },
      { type: "fn", value: { params: ["x"], body: { type: "ref", value: ["world", "x"] } } },
      { type: ["ext", "date"], value: "2026-10-21" },
      { type: "ref", value: ["names", "x"] },
      { type: "lit", value: 1, name: "n" },
      chainOf(1001),
    ];
    for (const doc of docs) {
      const text = formatExpr(doc);
      expect(text).toContain("…");
      expect(parseExpr(text).ok).toBe(false);
    }
  });

  it("the forms of version 0.1.1 give the text of their construct", () => {
    expect(formatExpr({ type: ["ops", "if"], value: [{ type: "ref", value: ["world", "c"] }, 1, 2] })).toBe("if(c, 1, 2)");
    expect(formatExpr({ type: ["ops", "and"], value: [true, 1] })).toBe("and(true, 1)");
    expect(parsed("if(c, 1, 2)")).toEqual(app("if", ref("c"), lit(1), lit(2)));
  });

  it("a path that starts with a parameter reads the parameter, and another path reads the world", () => {
    expect(parsed('fn(["x"], x.a + y)')).toEqual(app("fn", lit(["x"]), app("+", ref("x", "a"), ref("y"))));
    expect(parsed('map(xs, fn(["x"], x))')).toEqual({
      type: ["ops", "map"],
      value: [{ type: "ref", value: ["world", "xs"] }, { type: "fn", value: { params: ["x"], body: { type: "ref", value: ["names", "x"] } } }],
    });
  });

  it.each([
    "(w + 1) * h",
    'if(ready, "go", boom())',
    'map(items, fn(["x"], x * scale))',
    'record("area", w * h, "missing", nope)',
    'concat(count(keys(box)), " keys: ", join(keys(box)))',
    "self.`my key`.0 + -Infinity",
    "`my op`(undefined, NaN, -0)",
  ])("the formula %s goes through JSON text and back to the same text", (formula) => {
    expect(formatExpr(viaJson(parsed(formula)))).toBe(formula);
  });
});

/** Each malformed document, the code of its first issue, and the reason of the kernel. */
const cyclic: { type: readonly string[]; value: unknown[] } = { type: ["ops", "f"], value: [] };
cyclic.value.push(cyclic);
const MALFORMED: readonly (readonly [string, unknown, string, RegExp])[] = [
  ["an unknown type", { type: "nope", value: 1 }, "#KIND?", /no kind nope/],
  ["the root self", { type: "ref", value: ["self", "a"] }, "#REF!", /The root self is not open here/],
  ["the root event", { type: "ref", value: ["event", "key"] }, "#REF!", /The root event is not open here/],
  ["a root that is not a root", { type: "ref", value: [5, "a"] }, "#REF!", /A path starts with a root/],
  ["a computed step", { type: "ref", value: ["world", "a", { type: ["moves", "up"], value: 1 }] }, "#STEP?", /A step is a key/],
  ["an unbound name", { type: "ref", value: ["names", "x"] }, "#NAME?", /Nothing binds the name x/],
  ["a record whose value is a list", { type: "record", value: [1] }, "#VALUE!", /must be a record/],
  ["a fn without a body", { type: "fn", value: { params: ["x"] } }, "#VALUE!", /The field body is missing/],
  ["an op whose arguments are not a list", { type: ["ops", "f"], value: 1 }, "#VALUE!", /must be a list/],
  ["a problem deep in the document", { type: ["ops", "f"], value: [1, { type: "record", value: { a: { type: "ref", value: ["self"] } } }] }, "#REF!", /root self/],
  ["a document deeper than the limit", chainOf(1001), "#DEPTH!", /deeper than 1000/],
  ["a cycle", cyclic, "#DEPTH!", /deeper than 1000/],
];

describe("a malformed document", () => {
  it.each(MALFORMED)("checkExpr gives its issue, isExpr refuses it, and evaluate gives none: %s", (_name, doc, code, reason) => {
    const issues = checkExpr(doc);
    expect(issues[0]).toMatchObject({ code, reason: expect.stringMatching(reason) as unknown });
    expect(isExpr(doc)).toBe(false);
    const evalIssues: EvalIssue[] = [];
    expect(evaluate(doc as Expr, objectResolver({ a: 1 }), {}, evalIssues)).toEqual(none);
    expect(evalIssues.length).toBeGreaterThan(0);
  });

  it("checkExpr gives the place of each issue, and refuses a root that is not an envelope", () => {
    expect(checkExpr({ type: ["ops", "f"], value: [1, { type: "ref", value: ["self"] }] })).toMatchObject([{ code: "#REF!", place: [1] }]);
    expect(checkExpr(5)).toMatchObject([{ code: "#PART?", place: [] }]);
    expect(checkExpr(app("unknown", lit(1)))).toEqual([]);
  });
});

describe("evaluate: the documents of version 0.1.1", () => {
  const ops: Ops = { boom: () => { throw new Error("boom"); }, get: (o: Record<string, unknown>, k: string) => o[k] };
  const resolve = objectResolver({ yes: true, no: 0, k: "key" });

  it("an if as an op application is lazy, and an if with the wrong arguments is a bad form", () => {
    expect(evaluate({ type: ["ops", "if"], value: [{ type: "ref", value: ["world", "yes"] }, 1, { type: ["ops", "boom"], value: [] }] }, resolve, ops)).toEqual(some(1));
    expect(evaluate({ type: ["ops", "if"], value: [{ type: "ref", value: ["world", "no"] }, 1] }, resolve, ops)).toEqual(some(undefined));
    expect(evaluate({ type: ["ops", "if"], value: [false, 1, 2] }, resolve, ops)).toEqual(some(2));
    expect(evaluate({ type: ["ops", "if"], value: [{ type: "ref", value: ["world", "nope"] }, 1] }, resolve, ops)).toEqual(none);
    const issues: EvalIssue[] = [];
    expect(evaluate({ type: ["ops", "if"], value: [true, 1, 2, 3] }, resolve, ops, issues)).toEqual(none);
    expect(issues).toEqual([{ code: "bad-form", op: "if", message: "if(test, then, else?)" }]);
  });

  it("and and or as op applications are the constructs", () => {
    expect(evaluate({ type: ["ops", "and"], value: [1, 0, { type: ["ops", "boom"], value: [] }] }, resolve, ops)).toEqual(some(0));
    expect(evaluate({ type: ["ops", "or"], value: [0, "x"] }, resolve, ops)).toEqual(some("x"));
  });

  it("a record with a computed name evaluates its names, and leaves out a field that fails", () => {
    const doc = { type: ["ops", "record"], value: [{ type: "ref", value: ["world", "k"] }, 1, "gone", { type: ["ops", "boom"], value: [] }] };
    expect(evaluate(doc, resolve, ops)).toEqual(some({ key: 1 }));
    const bad: EvalIssue[] = [];
    expect(evaluate({ type: ["ops", "record"], value: [{}, 1] }, resolve, ops, bad)).toEqual(none);
    expect(bad).toEqual([{ code: "bad-form", op: "record", message: "A field name of record is not a text." }]);
    const issues: EvalIssue[] = [];
    expect(evaluate({ type: ["ops", "fn"], value: [{ type: "ref", value: ["world", "k"] }, 1] }, resolve, ops, issues)).toEqual(none);
    expect(issues).toEqual([{ code: "bad-form", op: "fn", message: "fn([...params], body)" }]);
  });
});

describe("evaluate: a document and its JSON text give the same value", () => {
  const ops: Ops = {
    "+": (a: number, b: number) => a + b,
    "*": (a: number, b: number) => a * b,
    f: (...args: unknown[]) => args.length,
    map: (xs: readonly unknown[], f: (x: unknown) => unknown) => xs.map((x) => f(x)),
    call: (f: (...args: unknown[]) => unknown, ...args: unknown[]) => f(...args),
    get: (o: Record<string, unknown>, k: string) => o[k],
    keys: (o: object) => Object.keys(o),
    boundaryView: (...args: unknown[]) => args,
  };
  const ctx = { w: 2, h: 3, items: [1, 2, 3], scale: 10, c: false, a: 1, b: 0, x: 4, y: 5, z: 6, self: { cells: {}, dehydrate: () => ({ cells: { v: 1 } }) } };
  const resolve = objectResolver(ctx);
  /** This function replaces each function of a value with a text, because each evaluation makes a new closure. */
  const withoutClosures = (v: unknown): unknown => {
    if (typeof v === "function") return "a function";
    if (Array.isArray(v)) return v.map(withoutClosures);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutClosures(x)]));
    return v;
  };
  const outcome = (r: Optional<unknown>): unknown => (isSome(r) ? { some: withoutClosures(r.value) } : r);

  it.each(CORPUS)("%s", (_name, e) => {
    const first: EvalIssue[] = [];
    const second: EvalIssue[] = [];
    expect(outcome(evaluate(viaJson(e), resolve, ops, second))).toEqual(outcome(evaluate(e, resolve, ops, first)));
    expect(second).toEqual(first);
  });
});

describe("a random corpus", () => {
  /** A small seeded generator, thus each run tests the same documents. */
  const random = (seed: number): (() => number) => {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  };
  const NAMES = ["a", "b", "x", "y", "names", "world", "self", "0", "__proto__", "type", "value", "a.b"];
  const LITERALS: readonly unknown[] = [
    0, 1.5, -2, "s", "", true, false, null, undefined, Number.NaN, -0, Number.POSITIVE_INFINITY, [1, "x"], { k: [true] },
    { type: "ref", value: ["world", "x"] }, { type: ["ops", "f"], value: [] }, { tag: "lit", value: 1 },
  ];
  const OPS = ["+", "f", "a.b", "if", "and", "or", "call", "get", "", "record", "fn"];

  const gen = (next: () => number, depth: number, scope: readonly string[]): Expr => {
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
    const roll = next();
    if (depth > 6 || roll < 0.25) return lit(pick(LITERALS));
    if (roll < 0.5) {
      const head = scope.length > 0 && next() < 0.5 ? pick(scope) : pick(NAMES);
      return ref(head, ...Array.from({ length: Math.floor(next() * 3) }, () => pick(NAMES)));
    }
    if (roll < 0.65) {
      const params = Array.from({ length: Math.floor(next() * 3) }, () => pick(NAMES));
      return app("fn", lit(params), gen(next, depth + 1, [...scope, ...params]));
    }
    if (roll < 0.8) {
      const n = Math.floor(next() * 4);
      return app("record", ...Array.from({ length: n }, (): Expr[] => [lit(pick(NAMES)), gen(next, depth + 1, scope)]).flat());
    }
    return app(pick(OPS), ...Array.from({ length: Math.floor(next() * 4) }, () => gen(next, depth + 1, scope)));
  };

  it("each of 400 random documents goes through its text and back, also through JSON text", () => {
    const next = random(20261021);
    for (let i = 0; i < 400; i++) {
      const e = gen(next, 0, []);
      const text = formatExpr(e);
      expect(docEquals(parsed(text), e)).toBe(true);
      expect(formatExpr(viaJson(e))).toBe(text);
      expect(isExpr(e)).toBe(true);
    }
  });
});
