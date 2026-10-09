import { describe, it, expect } from "vitest";
import { lit, ref, app, isExpr, exprEquals, formatExpr, parseExpr } from "@render/dsl";
import type { Expr, ParseResult } from "@render/dsl";

const self = (...path: string[]): Expr => ref("self", ...path);
const cell = (name: string): Expr => app("get", self("cells"), lit(name));

const parsed = (text: string): Expr => {
  const r = parseExpr(text);
  if (!r.ok) throw new Error(`${r.message} at ${String(r.offset)}`);
  return r.expr;
};

const failure = (text: string): Extract<ParseResult, { ok: false }> => {
  const r = parseExpr(text);
  if (r.ok) throw new Error(`expected a failure for ${text}`);
  return r;
};

describe("formatExpr", () => {
  it("gives a call with its arguments on one line", () => {
    expect(formatExpr(app("textView", cell("value"), self("setCell")))).toBe('textView(get(self.cells, "value"), self.setCell)');
    expect(formatExpr(app("array"))).toBe("array()");
  });

  it("writes the infix ops with parentheses only where the precedence needs them", () => {
    expect(formatExpr(app("+", lit(1), app("*", lit(2), lit(3))))).toBe("1 + 2 * 3");
    expect(formatExpr(app("*", app("+", lit(1), lit(2)), lit(3)))).toBe("(1 + 2) * 3");
    expect(formatExpr(app("-", ref("a"), app("-", ref("b"), ref("c"))))).toBe("a - (b - c)");
    expect(formatExpr(app("-", app("-", ref("a"), ref("b")), ref("c")))).toBe("a - b - c");
    expect(formatExpr(app("<", app("+", ref("a"), ref("b")), lit(10)))).toBe("a + b < 10");
    expect(formatExpr(app("+", lit(1), lit(2), lit(3)))).toBe("`+`(1, 2, 3)");
    expect(formatExpr(app("-", lit(1)))).toBe("`-`(1)");
  });

  it("quotes a segment or an op that is not a plain name", () => {
    expect(formatExpr(ref("self", "my key"))).toBe("self.`my key`");
    expect(formatExpr(ref("a`b"))).toBe("`a``b`");
    expect(formatExpr(ref("items", "0"))).toBe("items.0");
    expect(formatExpr(ref("0"))).toBe("`0`");
    expect(formatExpr(ref("true"))).toBe("`true`");
    expect(formatExpr(ref())).toBe(".");
    expect(formatExpr(app("a.b", lit(1)))).toBe("`a.b`(1)");
  });

  it("writes the special literals by their names", () => {
    expect(formatExpr(lit(undefined))).toBe("undefined");
    expect(formatExpr(lit(Number.NaN))).toBe("NaN");
    expect(formatExpr(lit(Number.POSITIVE_INFINITY))).toBe("Infinity");
    expect(formatExpr(lit(Number.NEGATIVE_INFINITY))).toBe("-Infinity");
    expect(formatExpr(lit(-0))).toBe("-0");
    expect(formatExpr(lit(() => 1))).toBe("undefined");
    expect(formatExpr(lit({ a: [1, "x"] }))).toBe('{"a":[1,"x"]}');
  });
});

describe("parseExpr", () => {
  it("reads calls, paths and literals", () => {
    expect(parsed('textView(get(self.cells, "value"), self.setCell)')).toEqual(app("textView", cell("value"), self("setCell")));
    expect(parsed("  x  ")).toEqual(ref("x"));
    expect(parsed("-3")).toEqual(lit(-3));
    expect(parsed("- Infinity")).toEqual(lit(Number.NEGATIVE_INFINITY));
    expect(parsed('fn(["x"], x * 10)')).toEqual(app("fn", lit(["x"]), app("*", ref("x"), lit(10))));
    expect(parsed('{"k": [1, null], "j": true}')).toEqual(lit({ k: [1, null], j: true }));
    expect(parsed("true(1)")).toEqual(app("true", lit(1)));
    expect(parsed("true.x")).toEqual(ref("true", "x"));
    expect(parsed("1 + 2 * 3 - 4")).toEqual(app("-", app("+", lit(1), app("*", lit(2), lit(3))), lit(4)));
    expect(parsed("a - -3")).toEqual(app("-", ref("a"), lit(-3)));
    expect(parsed("a <= b")).toEqual(app("<=", ref("a"), ref("b")));
  });

  it("keeps a key __proto__ of an object literal as an own key", () => {
    const e = parsed('{"__proto__": 1}');
    expect(e.tag).toBe("lit");
    const value = (e as { value: object }).value;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(["__proto__"]);
  });

  it("gives a message and an offset for each error", () => {
    expect(failure("")).toEqual({ ok: false, message: "An expression is missing.", offset: 0 });
    expect(failure("f(1,)")).toEqual({ ok: false, message: "An argument is missing after the comma.", offset: 4 });
    expect(failure("f(1, 2")).toMatchObject({ message: "A closing parenthesis is missing.", offset: 1 });
    expect(failure("f(1 2)")).toMatchObject({ message: "A comma or a closing parenthesis is missing.", offset: 4 });
    expect(failure("x y")).toMatchObject({ message: "The text continues after the expression.", offset: 2 });
    expect(failure("x.")).toMatchObject({ message: "A segment is missing after the dot.", offset: 2 });
    expect(failure("`abc")).toMatchObject({ message: "A backtick is missing at the end of the name.", offset: 0 });
    expect(failure('"abc')).toMatchObject({ message: "A closing quote is missing.", offset: 0 });
    expect(failure("-x")).toMatchObject({ offset: 0 });
    expect(failure("-x").message).toContain("0 - x");
    expect(failure("[1, x]")).toMatchObject({ offset: 4 });
    expect(failure("[1, x]").message).toContain("array(...)");
    expect(failure('{"a": x}').message).toContain("record(...)");
    expect(failure("{a: 1}").message).toBe("A key of an object literal is not a JSON string.");
    expect(failure("a.b(1)")).toMatchObject({ message: "An op name has no dots. Write the name in backticks.", offset: 0 });
    expect(failure("1 +")).toMatchObject({ message: "An operand is missing after +." });
    expect(failure("#")).toMatchObject({ message: "This character is not valid here: #", offset: 0 });
  });

  it("refuses a very deep text, and does not throw", () => {
    const deepCall = `${"f(".repeat(20_000)}1${")".repeat(20_000)}`;
    expect(parseExpr(deepCall).ok).toBe(false);
    const deepParens = `${"(".repeat(20_000)}1${")".repeat(20_000)}`;
    expect(parseExpr(deepParens).ok).toBe(false);
    const longChain = Array.from({ length: 20_000 }, () => "1").join(" + ");
    expect(parseExpr(longChain).ok).toBe(false);
    expect(parseExpr(`${"f(".repeat(500)}1${")".repeat(500)}`).ok).toBe(true);
  });
});

describe("the round trip", () => {
  const cases: readonly Expr[] = [
    // The render methods of the standard classes
    app("textView", cell("value"), self("setCell")),
    app("numView", cell("value"), self("setCell")),
    app("boolView", cell("value"), self("setCell")),
    app("kvp", self("children"), self("renderChild"), self("addChild"), self("readChildCells")),
    app("stack", lit("rv-vstack"), self("children"), self("renderChild"), self("addChild")),
    app("grid", self("cells"), self("children"), self("renderChild"), self("addChild")),
    app("exprAppView", cell("value"), self("children"), self("renderChild"), self("setCell"), self("addChild")),
    app("classChip", cell("value")),
    // The hydrate methods of the standard classes
    app("hydrateItems", self("value"), self("instanceId")),
    app("hydrateEntries", self("value"), self("instanceId")),
    app("hydrateItems", app("get", self("value"), lit("args")), self("instanceId")),
    // Infix forms
    app("+", lit(1), app("*", lit(2), lit(3))),
    app("*", app("+", lit(1), lit(2)), lit(3)),
    app("-", ref("a"), app("-", ref("b"), ref("c"))),
    app("-", app("-", ref("a"), ref("b")), ref("c")),
    app("<", app("<", ref("a"), ref("b")), ref("c")),
    app("/", lit(-3), lit(-0)),
    app(">=", app("-", ref("a")), lit(Number.NEGATIVE_INFINITY)),
    app("+", lit(1), lit(2), lit(3)),
    // Literals
    lit(Number.NaN), lit(Number.POSITIVE_INFINITY), lit(undefined), lit(null), lit(true),
    lit("with \"quotes\", `backticks` and a\nnewline"),
    lit([1, "two", { a: null }]),
    lit(1e21),
    lit({}),
    // Paths
    ref("self", "my key"), ref("a`b"), ref("items", "0"), ref("0"), ref("true"), ref(), ref(""), ref("x", ""),
    ref("i_3", "value"),
    // Special forms and other names
    app("if", ref("c"), lit(1), lit(2)),
    app("fn", lit(["x"]), app("*", ref("x"), lit(10))),
    app("map", ref("items"), app("fn", lit(["x"]), app("+", ref("x", "n"), lit(1)))),
    app("record", lit("a"), lit(1), lit("b"), ref("y")),
    app("and", ref("a"), app("or", ref("b"), lit(false))),
    app("a.b", lit(1)),
    app(""),
    app("true", lit(1)),
  ];

  it.each(cases.map((e) => [formatExpr(e), e] as const))("%s reads back to the same expression", (text, e) => {
    const back = parsed(text);
    expect(isExpr(back)).toBe(true);
    expect(exprEquals(back, e)).toBe(true);
    expect(formatExpr(back)).toBe(text);
  });
});
