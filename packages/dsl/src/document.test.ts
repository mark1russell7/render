import { describe, it, expect } from "vitest";
import {
  app, asExpr, deps, evaluate, exprEquals, forEachFreeRef, formatExpr, fromDocument, isExpr, isExprDocument, lit,
  MAX_EXPR_DEPTH, objectResolver, parseExpr, record, ref, toDocument,
} from "@mark1russell7/render-dsl";
import type { EvalIssue, Expr, ExprDocument, Ops } from "@mark1russell7/render-dsl";
import { isSome, none } from "@mark1russell7/render-optional";
import type { Optional } from "@mark1russell7/render-optional";

const read = (doc: unknown): Expr => {
  const issues: EvalIssue[] = [];
  const r = fromDocument(doc, issues);
  if (!isSome(r)) throw new Error(`the document did not read: ${JSON.stringify(issues)}`);
  return r.value;
};
const roundTrip = (e: Expr): Expr => read(toDocument(e));
const viaJson = (e: Expr): Expr => read(JSON.parse(JSON.stringify(toDocument(e))));

/** A deep chain of `f(f(...f(1)))`: a tree whose depth is `levels`. */
const chainOf = (levels: number): Expr => {
  let e: Expr = lit(1);
  for (let i = 0; i < levels; i++) e = app("f", e);
  return e;
};

/** Each kind of node and each special form. Each entry is JSON safe: JSON text keeps its document. */
const CORPUS: readonly (readonly [string, Expr])[] = [
  ["a number", lit(42)],
  ["a text", lit("text")],
  ["true", lit(true)],
  ["false", lit(false)],
  ["null", lit(null)],
  ["an array", lit([1, "a", [null, true]])],
  ["an object", lit({ a: 1, b: { c: [2] } })],
  ["an empty array", lit([])],
  ["an empty object", lit({})],
  ["zero", lit(0)],
  ["undefined", lit(undefined)],
  ["NaN", lit(Number.NaN)],
  ["Infinity", lit(Number.POSITIVE_INFINITY)],
  ["-Infinity", lit(Number.NEGATIVE_INFINITY)],
  ["-0", lit(-0)],
  ["a literal with the shape of a reference", lit({ type: "ref", value: ["world", "a"] })],
  ["a literal with the shape of a lit", lit({ type: "lit", value: 1 })],
  ["a literal with the shape of an op", lit({ type: ["ops", "+"], value: [1, 2] })],
  ["a literal with the shape of an envelope with a header", lit({ type: "x", value: 1, name: "n", own: { view: "v" } })],
  ["a literal with the shape of an extension", lit({ type: ["ext", "undefined"], value: null })],
  ["a literal with the shape of a lit node", lit({ tag: "lit", value: 1 })],
  ["a literal with the shape of a ref node", lit({ tag: "ref", path: ["a"] })],
  ["an object with an extra key", lit({ type: "x", value: 1, extra: 2 })],
  ["an object with an empty type", lit({ type: "", value: 1 })],
  ["an object without a value", lit({ type: "x" })],
  ["an empty path", ref()],
  ["a path of one segment", ref("a")],
  ["a path with an index", ref("a", "b", "0")],
  ["segments with dots and backticks", ref("a.b", "`x`", "")],
  ["a path that starts with names", ref("names", "x")],
  ["a path that starts with world", ref("world", "x")],
  ["a path that starts with self", ref("self", "cells")],
  ["an infix op", app("+", lit(1), lit(2))],
  ["an op without arguments", app("max")],
  ["an op with dots", app("a.b", ref("x"))],
  ["an empty op name", app("")],
  ["an op name with empty keys", app(".a..b.")],
  ["an op name with a space", app("my op", ref("x"))],
  ["if", app("if", ref("c"), lit(1), lit(2))],
  ["and", app("and", ref("a"), ref("b"), lit(true))],
  ["or", app("or", ref("a"), lit(false))],
  ["an empty record", record({})],
  ["a record", record({ area: app("*", ref("w"), ref("h")), label: lit("box") })],
  ["a record field __proto__", app("record", lit("__proto__"), lit(1))],
  ["a record with an index name first", app("record", lit("1"), lit(1), lit("b"), lit(2))],
  ["a record with an index name later", app("record", lit("b"), lit(2), lit("1"), lit(1))],
  ["a record with a repeated name", app("record", lit("a"), lit(1), lit("a"), lit(2))],
  ["a record with a computed name", app("record", ref("k"), lit(1))],
  ["a record with a number name", app("record", lit(1), lit(2))],
  ["a record with an odd number of arguments", app("record", lit("a"))],
  ["a record with a literal name that has the shape of an envelope", app("record", lit("type"), lit("x"), lit("value"), lit(1))],
  ["a lambda with a bound and a free reference", app("fn", lit(["x"]), app("+", ref("x"), ref("y")))],
  ["a lambda that reads a field of its parameter", app("fn", lit(["p"]), ref("p", "a", "b"))],
  ["a lambda without parameters", app("fn", lit([]), ref("x"))],
  ["nested lambdas with shadowing", app("fn", lit(["x"]), app("fn", lit(["x", "y"]), app("+", ref("x"), ref("y"), ref("z"))))],
  ["an inner lambda that reads an outer parameter", app("fn", lit(["x"]), app("fn", lit(["y"]), app("+", ref("x"), ref("y"))))],
  ["a lambda that is applied", app("map", ref("items"), app("fn", lit(["x"]), app("*", ref("x"), ref("scale"))))],
  ["a lambda with a parameter that is not a text", app("fn", lit([1, "x"]), app("+", ref("1"), ref("x")))],
  ["a lambda with three arguments", app("fn", lit(["x"]), ref("x"), ref("x"))],
  ["a lambda with computed parameters", app("fn", ref("p"), ref("x"))],
  ["a lambda without a body", app("fn", lit(["x"]))],
  ["a lambda without arguments", app("fn")],
  ["a lambda whose parameter list is not a list", app("fn", lit("x"), ref("x"))],
  ["a record in a lambda", app("fn", lit(["d"]), record({ a: ref("d", "a"), b: ref("other") }))],
  ["a lambda in a record", record({ f: app("fn", lit(["x"]), ref("x")), g: ref("x") })],
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
  ["specials in arguments", app("f", lit(undefined), lit(Number.NaN), lit(-0), lit(Number.POSITIVE_INFINITY), lit(Number.NEGATIVE_INFINITY))],
  ["a tree at the depth limit", chainOf(MAX_EXPR_DEPTH)],
];

describe("toDocument and fromDocument: the round trip", () => {
  it.each(CORPUS)("fromDocument(toDocument(e)) is e: %s", (_name, e) => {
    const back = roundTrip(e);
    expect(exprEquals(back, e)).toBe(true);
    expect(isExpr(back)).toBe(true);
  });

  it.each(CORPUS)("the round trip also goes through JSON text: %s", (_name, e) => {
    expect(exprEquals(viaJson(e), e)).toBe(true);
  });

  it.each(CORPUS)("the root of each document is an envelope that isExprDocument accepts: %s", (_name, e) => {
    const doc = toDocument(e);
    expect(isExprDocument(doc)).toBe(true);
    expect(isExprDocument(JSON.parse(JSON.stringify(doc)))).toBe(true);
  });

  it("a literal that JSON cannot write stays in the document in memory", () => {
    const f = (): number => 1;
    const back = roundTrip(lit(f));
    expect(back).toEqual({ tag: "lit", value: f });
    expect(toDocument(app("call", lit(f)))).toEqual({ type: ["ops", "call"], value: [f] });
  });

  it("a special value inside a literal array or object gets its JSON form in JSON text, as in formatExpr", () => {
    const e = lit([undefined, Number.NaN, { a: undefined }]);
    expect(exprEquals(roundTrip(e), e)).toBe(true);
    expect(viaJson(e)).toEqual(lit([null, null, {}]));
  });
});

describe("toDocument: the documents of D12", () => {
  it("a literal is its JSON value in a position that holds terms, and the root is a lit envelope", () => {
    expect(toDocument(app("+", lit(1), lit("a")))).toEqual({ type: ["ops", "+"], value: [1, "a"] });
    expect(toDocument(lit(5))).toEqual({ type: "lit", value: 5 });
    expect(toDocument(lit([1, 2]))).toEqual({ type: "lit", value: [1, 2] });
  });

  it("a literal with the shape of an envelope is a lit envelope in each position", () => {
    const shaped = { type: "x", value: 1 };
    expect(toDocument(lit(shaped))).toEqual({ type: "lit", value: shaped });
    expect(toDocument(app("id", lit(shaped)))).toEqual({ type: ["ops", "id"], value: [{ type: "lit", value: shaped }] });
  });

  it("an op application has the type ops and the keys of the op name", () => {
    expect(toDocument(app("a.b", ref("x")))).toEqual({ type: ["ops", "a", "b"], value: [{ type: "ref", value: ["world", "x"] }] });
    expect(toDocument(app("if", ref("c"), lit(1)))).toEqual({ type: ["ops", "if"], value: [{ type: "ref", value: ["world", "c"] }, 1] });
  });

  it("a free reference starts at world, and a parameter of an enclosing fn starts at names", () => {
    expect(toDocument(ref("box", "width"))).toEqual({ type: "ref", value: ["world", "box", "width"] });
    expect(toDocument(app("fn", lit(["x"]), app("+", ref("x", "a"), ref("y"))))).toEqual({
      type: "fn",
      value: {
        params: ["x"],
        body: { type: ["ops", "+"], value: [{ type: "ref", value: ["names", "x", "a"] }, { type: "ref", value: ["world", "y"] }] },
      },
    });
  });

  it("an inner fn binds its parameters in addition to the outer parameters", () => {
    const doc = toDocument(app("fn", lit(["x"]), app("fn", lit(["y"]), app("f", ref("x"), ref("y"), ref("z")))));
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
    expect(toDocument(record({ area: app("*", ref("w"), lit(2)), label: lit("box") }))).toEqual({
      type: "record",
      value: { area: { type: ["ops", "*"], value: [{ type: "ref", value: ["world", "w"] }, 2] }, label: "box" },
    });
  });

  it("a form that a construct cannot keep exactly stays an op application", () => {
    expect(toDocument(app("record", ref("k"), lit(1)))).toEqual({ type: ["ops", "record"], value: [{ type: "ref", value: ["world", "k"] }, 1] });
    expect(toDocument(app("record", lit("b"), lit(2), lit("1"), lit(1)))).toEqual({ type: ["ops", "record"], value: ["b", 2, "1", 1] });
    expect(toDocument(app("fn", lit(["x"]), ref("x"), ref("x")))).toEqual({
      type: ["ops", "fn"],
      value: [["x"], { type: "ref", value: ["names", "x"] }, { type: "ref", value: ["names", "x"] }],
    });
  });

  it("a value that JSON cannot write is an extension", () => {
    expect(toDocument(lit(undefined))).toEqual({ type: ["ext", "undefined"], value: null });
    expect(toDocument(app("f", lit(Number.NaN), lit(-0), lit(Number.POSITIVE_INFINITY), lit(Number.NEGATIVE_INFINITY)))).toEqual({
      type: ["ops", "f"],
      value: [
        { type: ["ext", "number"], value: "NaN" },
        { type: ["ext", "number"], value: "-0" },
        { type: ["ext", "number"], value: "Infinity" },
        { type: ["ext", "number"], value: "-Infinity" },
      ],
    });
  });

  it("a world reference is a free reference of the scope analysis, in the same order", () => {
    const worldPaths = (doc: unknown, out: string[][] = []): string[][] => {
      if (Array.isArray(doc)) for (const d of doc) worldPaths(d, out);
      else if (doc !== null && typeof doc === "object") {
        const o = doc as Record<string, unknown>;
        if (o["type"] === "ref" && Array.isArray(o["value"])) {
          const [root, ...path] = o["value"] as string[];
          if (root === "world") out.push(path);
        } else if (o["type"] !== "lit") {
          for (const v of Object.values(o)) worldPaths(v, out);
        }
      }
      return out;
    };
    for (const [, e] of CORPUS.filter(([name]) => !name.startsWith("a tree at"))) {
      const free: string[][] = [];
      forEachFreeRef(e, (r) => { free.push([...r.path]); });
      expect(worldPaths(toDocument(e))).toEqual(free);
      expect(deps(asExpr(toDocument(e)))).toEqual(deps(e));
    }
  });

  it("toDocument throws a TypeError for a value that is not an expression", () => {
    const bad = (v: unknown): ExprDocument => toDocument(v as Expr);
    expect(() => bad(null)).toThrow(TypeError);
    expect(() => bad({ tag: "nope" })).toThrow(/not lit, ref or app/);
    expect(() => bad({ tag: "ref", path: [1] })).toThrow(/no path of texts/);
    expect(() => bad({ tag: "app", op: 1, args: [] })).toThrow(/no op or no args/);
    expect(() => bad(app("f", null as unknown as Expr))).toThrow(TypeError);
    expect(() => bad(app("record", null as unknown as Expr, lit(1)))).toThrow(TypeError);
    expect(() => bad(chainOf(MAX_EXPR_DEPTH + 1))).toThrow(/deeper than 1000/);
  });
});

describe("fromDocument: the reading", () => {
  it("a value that is not an envelope is a literal", () => {
    expect(read(5)).toEqual(lit(5));
    expect(read({ tag: "lit", value: 1 })).toEqual(lit({ tag: "lit", value: 1 }));
    expect(read(undefined)).toEqual(lit(undefined));
    expect(read({ type: ["ops", "f"], value: [], comment: "x" })).toEqual(lit({ type: ["ops", "f"], value: [], comment: "x" }));
  });

  it("a type can be a text, a list of keys or an expanded reference", () => {
    expect(read({ type: ["lit"], value: 1 })).toEqual(lit(1));
    expect(read({ type: { type: "ref", value: ["world", "ops", "add"] }, value: [1, 2] })).toEqual(app("add", lit(1), lit(2)));
    expect(read({ type: ["ops", "v", 2], value: [] })).toEqual(app("v.2"));
  });

  it("a step that is a whole number becomes a text segment", () => {
    expect(read({ type: "ref", value: ["world", "items", 0] })).toEqual(ref("items", "0"));
  });

  it("a fn written as an op application binds its parameters in its other arguments", () => {
    expect(read({ type: ["ops", "fn"], value: [["x"], { type: "ref", value: ["names", "x"] }] })).toEqual(app("fn", lit(["x"]), ref("x")));
    expect(read({ type: ["ops", "fn"], value: [{ type: "lit", value: [1] }, { type: "ref", value: ["names", "1"] }] }))
      .toEqual(app("fn", lit([1]), ref("1")));
  });

  it("a record field named __proto__ from JSON text stays a field", () => {
    const e = read(JSON.parse('{ "type": "record", "value": { "__proto__": 1, "a": 2 } }'));
    expect(e).toEqual(app("record", lit("__proto__"), lit(1), lit("a"), lit(2)));
  });

  it.each([
    ["the parse of each formula", [
      "(w + 1) * h",
      'if(ready, "go", boom())',
      'map(items, fn(["x"], x * scale))',
      'record("area", w * h, "missing", nope)',
      'concat(count(keys(box)), " keys: ", join(keys(box)))',
      "self.`my key`.0 + -Infinity",
      "`my op`(undefined, NaN, -0)",
    ]],
  ])("%s goes through a document and back to the same text", (_name, formulas) => {
    for (const formula of formulas) {
      const parsed = parseExpr(formula);
      if (!parsed.ok) throw new Error(parsed.message);
      expect(formatExpr(viaJson(parsed.expr))).toBe(formatExpr(parsed.expr));
    }
  });
});

/** Each malformed document, and the reason that its issue gives. */
const cyclic: { type: readonly string[]; value: unknown[] } = { type: ["ops", "f"], value: [] };
cyclic.value.push(cyclic);
const tooDeep = (): unknown => {
  let d: unknown = 1;
  for (let i = 0; i <= MAX_EXPR_DEPTH + 1; i++) d = { type: ["ops", "f"], value: [d] };
  return d;
};
const MALFORMED: readonly (readonly [string, unknown, RegExp])[] = [
  ["an unknown type", { type: "nope", value: 1 }, /The type nope is not a term of render/],
  ["ops without a name", { type: ["ops"], value: [] }, /The type ops is not a term of render/],
  ["a term with a name", { type: "lit", value: 1, name: "x" }, /no name and no own entries/],
  ["a term with own entries", { type: "lit", value: 1, own: {} }, /no name and no own entries/],
  ["a computed type", { type: { type: "ref", value: ["world", { type: "x", value: 1 }] }, value: [] }, /computed path/],
  ["a reference whose value is not a list", { type: "ref", value: "a" }, /not a path from a root/],
  ["a reference without a root", { type: "ref", value: [] }, /not a path from a root/],
  ["the root self", { type: "ref", value: ["self", "a"] }, /The root "self" is not names or world/],
  ["the root event", { type: "ref", value: ["event", "key"] }, /The root "event" is not names or world/],
  ["the root caps", { type: "ref", value: ["caps"] }, /The root "caps" is not names or world/],
  ["a root that is not a root", { type: "ref", value: [5, "a"] }, /The root 5 is not names or world/],
  ["a computed step", { type: "ref", value: ["world", "a", { type: ["moves", "up"], value: 1 }] }, /render has no computed steps/],
  ["a negative step", { type: "ref", value: ["world", -1] }, /not a key/],
  ["an unbound name", { type: "ref", value: ["names", "x"] }, /The name "x" is not a parameter of an enclosing fn/],
  ["names without a name", { type: "ref", value: ["names"] }, /The name null is not a parameter/],
  [
    "a world path with the name of a parameter",
    { type: "fn", value: { params: ["x"], body: { type: "ref", value: ["world", "x"] } } },
    /The world path "x" has the name of a parameter of an enclosing fn \(at value\.body\)\.$/,
  ],
  ["a record whose value is a list", { type: "record", value: [1] }, /not an object of fields/],
  ["a fn without a body", { type: "fn", value: { params: ["x"] } }, /not \{ params, body \}/],
  ["a fn with an extra field", { type: "fn", value: { params: [], body: 1, name: "f" } }, /not \{ params, body \}/],
  ["a fn whose value is a list", { type: "fn", value: [["x"], 1] }, /not \{ params, body \}/],
  ["a fn with a parameter that is not a text", { type: "fn", value: { params: [1], body: 1 } }, /not a list of names/],
  ["a fn whose params are not a list", { type: "fn", value: { params: "x", body: 1 } }, /not a list of names/],
  ["an op whose arguments are not a list", { type: ["ops", "f"], value: 1 }, /The arguments of the op "f" are not a list/],
  ["an unknown extension", { type: ["ext", "date"], value: "2026-10-21" }, /The type ext\.date is not a term of render/],
  ["ext without a name", { type: ["ext"], value: null }, /The type ext is not a term of render/],
  ["an undefined extension with a value", { type: ["ext", "undefined"], value: 0 }, /ext\.undefined is not null/],
  ["a number extension with another text", { type: ["ext", "number"], value: "1" }, /not NaN, Infinity, -Infinity or -0/],
  ["a number extension with a number", { type: ["ext", "number"], value: 1 }, /not NaN, Infinity, -Infinity or -0/],
  [
    "a problem deep in the document",
    { type: ["ops", "f"], value: [1, { type: "record", value: { a: { type: "ref", value: ["self"] } } }] },
    /^The root "self" is not names or world \(at value\.1\.value\.a\)\.$/,
  ],
  ["a document deeper than the limit", tooDeep(), /The document is deeper than 1000 levels/],
  ["a cycle", cyclic, /The document is deeper than 1000 levels/],
];

describe("fromDocument: a malformed document", () => {
  it.each(MALFORMED)("gives none with a bad-expr issue, and does not throw: %s", (_name, doc, reason) => {
    const issues: EvalIssue[] = [];
    expect(fromDocument(doc, issues)).toEqual(none);
    expect(issues).toEqual([{ code: "bad-expr", message: expect.stringMatching(reason) as unknown }]);
    expect(fromDocument(doc)).toEqual(none);
  });

  it.each(MALFORMED)("isExprDocument refuses it, and asExpr keeps it: %s", (_name, doc) => {
    expect(isExprDocument(doc)).toBe(false);
    expect(asExpr(doc as ExprDocument)).toBe(doc);
  });

  it.each(MALFORMED)("evaluate gives none with the same issue: %s", (_name, doc) => {
    const issues: EvalIssue[] = [];
    fromDocument(doc, issues);
    const evalIssues: EvalIssue[] = [];
    expect(evaluate(doc as ExprDocument, objectResolver({}), {}, evalIssues)).toEqual(none);
    expect(evalIssues).toEqual(issues);
  });

  it("an error that is not a problem of the document goes to the caller", () => {
    const hostile = { get type(): never { throw new Error("hostile"); }, value: 1 };
    expect(() => fromDocument(hostile)).toThrow("hostile");
  });
});

describe("isExprDocument and asExpr", () => {
  it("isExprDocument accepts only an envelope that reads", () => {
    expect(isExprDocument(toDocument(app("f", ref("x"))))).toBe(true);
    expect(isExprDocument({ type: "lit", value: 1 })).toBe(true);
    expect(isExprDocument(lit(1))).toBe(false);
    expect(isExprDocument(5)).toBe(false);
    expect(isExprDocument(null)).toBe(false);
  });

  it("asExpr keeps a tree of the IR as the same object, and reads a document", () => {
    const e = app("+", ref("a"), lit(1));
    expect(asExpr(e)).toBe(e);
    expect(exprEquals(asExpr(toDocument(e)), e)).toBe(true);
  });
});

describe("evaluate: a document gives the value of its expression", () => {
  const ops: Ops = {
    "+": (a: number, b: number) => a + b,
    "*": (a: number, b: number) => a * b,
    map: (xs: readonly unknown[], f: (x: unknown) => unknown) => xs.map((x) => f(x)),
    call: (f: (...args: unknown[]) => unknown, ...args: unknown[]) => f(...args),
    get: (o: Record<string, unknown>, k: string) => o[k],
    boom: () => { throw new Error("boom"); },
  };
  const ctx = { w: 2, h: 3, items: [1, 2, 3], scale: 10, box: { width: 21 }, ready: true, c: false, a: 1, b: 0, self: { cells: { value: 7 } } };
  const resolve = objectResolver(ctx);
  /** This function replaces each function of a value with a text, because each evaluation makes a new closure. */
  const withoutClosures = (v: unknown): unknown => {
    if (typeof v === "function") return "a function";
    if (Array.isArray(v)) return v.map(withoutClosures);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutClosures(x)]));
    return v;
  };
  const outcome = (r: Optional<unknown>): unknown => (isSome(r) ? { some: withoutClosures(r.value) } : r);

  it.each(CORPUS)("evaluate(toDocument(e)) equals evaluate(e), with the same issues: %s", (_name, e) => {
    const fromIr: EvalIssue[] = [];
    const fromDoc: EvalIssue[] = [];
    expect(outcome(evaluate(toDocument(e), resolve, ops, fromDoc))).toEqual(outcome(evaluate(e, resolve, ops, fromIr)));
    expect(fromDoc).toEqual(fromIr);
  });

  it("a lambda in a document reads its parameter and the world", () => {
    const doc = toDocument(app("map", ref("items"), app("fn", lit(["x"]), app("*", ref("x"), ref("scale")))));
    expect(evaluate(doc, resolve, ops)).toEqual({ tag: "some", value: [10, 20, 30] });
    const parsed = JSON.parse(JSON.stringify(doc)) as ExprDocument;
    expect(evaluate(parsed, resolve, ops)).toEqual({ tag: "some", value: [10, 20, 30] });
  });

  it("a tree of the IR evaluates as before", () => {
    expect(evaluate(lit(1), resolve, ops)).toEqual({ tag: "some", value: 1 });
    const issues: EvalIssue[] = [];
    expect(evaluate({ tag: "nope" } as unknown as Expr, resolve, ops, issues)).toEqual(none);
    expect(issues).toEqual([{ code: "bad-expr", message: "unknown tag: nope" }]);
  });
});

describe("a random corpus", () => {
  /** A small seeded generator, thus each run tests the same trees. */
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

  it("each of 400 random trees goes through a document and back, also through JSON text", () => {
    const next = random(20261021);
    for (let i = 0; i < 400; i++) {
      const e = gen(next, 0, []);
      expect(exprEquals(roundTrip(e), e)).toBe(true);
      expect(exprEquals(viaJson(e), e)).toBe(true);
      expect(deps(asExpr(toDocument(e)))).toEqual(deps(e));
    }
  });
});
