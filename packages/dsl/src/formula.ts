/**
 * The formula language: the text form of the IR. It is the same compositional builder, but shorter.
 *
 * - A literal is JSON, or `undefined`, `NaN`, `Infinity` or `-Infinity`.
 * - A reference is a path with dots: `self.cells`. A segment that is not a name goes in backticks: `` self.`my key` ``.
 * - An application is a call: `textView(get(self.cells, "value"), self.setCell)`.
 * - The ops `* /`, `+ -` and `< > <= >=` with two arguments are infix, in that order of precedence.
 */
import type { Expr } from "./ir.ts";
import { MAX_EXPR_DEPTH } from "./ir.ts";

/** The result of `parseExpr`: an expression, or the reason of the failure and its character offset. */
export type ParseResult =
  | { readonly ok: true; readonly expr: Expr }
  | { readonly ok: false; readonly message: string; readonly offset: number };

/** The precedence of each infix op. A larger number binds more tightly. */
const PRECEDENCE: Readonly<Record<string, number>> = {
  "<": 1, ">": 1, "<=": 1, ">=": 1,
  "+": 2, "-": 2,
  "*": 3, "/": 3,
};

const KEYWORDS: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ["true", true],
  ["false", false],
  ["null", null],
  ["undefined", undefined],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
]);

const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DIGITS = /^[0-9]+$/;

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

const infixPrecedence = (e: Expr): number | undefined =>
  e.tag === "app" && e.args.length === 2 && hasOwn(PRECEDENCE, e.op) ? PRECEDENCE[e.op] : undefined;

// === Format ===

/** This function quotes a name in backticks. A backtick in the name becomes two backticks. */
const quote = (name: string): string => `\`${name.replaceAll("`", "``")}\``;

/** This function gives the text of a literal value. A value that JSON cannot write gives `undefined`. */
const literalText = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Number.POSITIVE_INFINITY) return "Infinity";
    if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
    if (Object.is(value, -0)) return "-0";
  }
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "undefined";
  }
};

/** This function gives the text of a path. The first segment is in backticks when it is not a plain name. */
const pathText = (path: readonly string[]): string => {
  if (path.length === 0) return ".";
  return path
    .map((segment, i) => {
      if (i === 0) return NAME.test(segment) && !KEYWORDS.has(segment) ? segment : quote(segment);
      return NAME.test(segment) || DIGITS.test(segment) ? segment : quote(segment);
    })
    .join(".");
};

const formatAt = (e: Expr, minPrecedence: number, depth: number): string => {
  if (depth > MAX_EXPR_DEPTH) return "…";
  switch (e.tag) {
    case "lit":
      return literalText(e.value);
    case "ref":
      return pathText(e.path);
    case "app": {
      const precedence = infixPrecedence(e);
      if (precedence !== undefined) {
        const left = formatAt(e.args[0]!, precedence, depth + 1);
        const right = formatAt(e.args[1]!, precedence + 1, depth + 1);
        const text = `${left} ${e.op} ${right}`;
        return precedence < minPrecedence ? `(${text})` : text;
      }
      const name = NAME.test(e.op) ? e.op : quote(e.op);
      return `${name}(${e.args.map((a) => formatAt(a, 0, depth + 1)).join(", ")})`;
    }
  }
};

/**
 * This function gives the canonical one-line text of an expression. `parseExpr` reads the text back to an equal
 * expression. Two limits apply. A literal that JSON cannot write gives `undefined`, and a special value inside an
 * array or an object gives its JSON form. A subtree below `MAX_EXPR_DEPTH` levels gives `…`, which is not valid text.
 */
export const formatExpr = (e: Expr): string => formatAt(e, 0, 0);

// === Parse ===

/** The failure of a parse. The parser throws it, and `parseExpr` gives it as a result. */
class ParseFailure extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.offset = offset;
  }
}

/** A parsed expression with its height: the number of levels below its root. */
type Parsed = { readonly expr: Expr; readonly height: number };

const NUMBER = /(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const NAME_AT = /[A-Za-z_$][A-Za-z0-9_$]*/y;
const DIGITS_AT = /[0-9]+/y;

const leaf = (expr: Expr): Parsed => ({ expr, height: 0 });

/** The parser keeps its position and its nesting in one object. Each method reads at the position. */
const makeParser = (text: string) => {
  let pos = 0;
  let nesting = 0;

  const fail = (message: string, offset: number = pos): never => {
    throw new ParseFailure(message, offset);
  };
  const skip = (): void => {
    while (pos < text.length && /\s/.test(text[pos]!)) pos++;
  };
  const at = (pattern: RegExp): string | undefined => {
    pattern.lastIndex = pos;
    const m = pattern.exec(text);
    return m ? m[0] : undefined;
  };
  const enter = (offset: number): void => {
    if (++nesting > MAX_EXPR_DEPTH) fail(`The expression is deeper than ${String(MAX_EXPR_DEPTH)} levels.`, offset);
  };
  const app = (op: string, args: readonly Parsed[], offset: number): Parsed => {
    const height = 1 + args.reduce((h, a) => Math.max(h, a.height), 0);
    if (height > MAX_EXPR_DEPTH) fail(`The expression is deeper than ${String(MAX_EXPR_DEPTH)} levels.`, offset);
    return { expr: { tag: "app", op, args: args.map((a) => a.expr) }, height };
  };

  /** This function reads a backtick name. Two backticks in the name are one backtick. */
  const quoted = (): string => {
    const start = pos;
    pos++;
    let out = "";
    for (;;) {
      if (pos >= text.length) return fail("A backtick is missing at the end of the name.", start);
      const c = text[pos]!;
      if (c === "`") {
        if (text[pos + 1] === "`") {
          out += "`";
          pos += 2;
          continue;
        }
        pos++;
        return out;
      }
      out += c;
      pos++;
    }
  };

  const string = (): Parsed => {
    const start = pos;
    pos++;
    while (pos < text.length && text[pos] !== '"') pos += text[pos] === "\\" ? 2 : 1;
    if (pos >= text.length) return fail("A closing quote is missing.", start);
    pos++;
    try {
      return leaf({ tag: "lit", value: JSON.parse(text.slice(start, pos)) as unknown });
    } catch {
      return fail("The string is not valid JSON.", start);
    }
  };

  const number = (negative: boolean, start: number): Parsed => {
    const digits = at(NUMBER);
    if (digits !== undefined) {
      pos += digits.length;
      const n = Number(digits);
      return leaf({ tag: "lit", value: negative ? -n : n });
    }
    const name = at(NAME_AT);
    if (name === "Infinity" || name === "NaN") {
      pos += name.length;
      const n = KEYWORDS.get(name) as number;
      return leaf({ tag: "lit", value: negative ? -n : n });
    }
    return fail("A minus sign is valid only before a number. For another value, write 0 - x.", start);
  };

  /** This function reads the elements of an array or an object literal. Each element must be a literal. */
  const literalValue = (kind: "array" | "object"): unknown => {
    skip();
    const start = pos;
    const element = binary(0);
    if (element.expr.tag !== "lit") {
      return fail(
        kind === "array"
          ? "An element of an array literal is not a literal. Write array(...) for computed elements."
          : "A value of an object literal is not a literal. Write record(...) for computed values.",
        start,
      );
    }
    return element.expr.value;
  };

  const array = (): Parsed => {
    const open = pos;
    enter(open);
    pos++;
    const values: unknown[] = [];
    skip();
    if (text[pos] === "]") {
      pos++;
    } else {
      for (;;) {
        values.push(literalValue("array"));
        skip();
        if (text[pos] === ",") {
          pos++;
          skip();
          if (text[pos] === "]") fail("An element is missing after the comma.");
          continue;
        }
        if (text[pos] === "]") {
          pos++;
          break;
        }
        if (pos >= text.length) fail("A closing bracket is missing.", open);
        fail("A comma or a closing bracket is missing.");
      }
    }
    nesting--;
    return leaf({ tag: "lit", value: values });
  };

  const object = (): Parsed => {
    const open = pos;
    enter(open);
    pos++;
    const entries: [string, unknown][] = [];
    skip();
    if (text[pos] === "}") {
      pos++;
    } else {
      for (;;) {
        skip();
        if (text[pos] !== '"') fail("A key of an object literal is not a JSON string.");
        const key = string().expr;
        skip();
        if (text[pos] !== ":") fail("A colon is missing after the key.");
        pos++;
        entries.push([String((key as { value: unknown }).value), literalValue("object")]);
        skip();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "}") {
          pos++;
          break;
        }
        if (pos >= text.length) fail("A closing brace is missing.", open);
        fail("A comma or a closing brace is missing.");
      }
    }
    nesting--;
    // fromEntries makes own data properties, thus a key "__proto__" stays a key
    return leaf({ tag: "lit", value: Object.fromEntries(entries) });
  };

  const args = (op: string, start: number): Parsed => {
    const open = pos;
    enter(open);
    pos++;
    const out: Parsed[] = [];
    skip();
    if (text[pos] === ")") {
      pos++;
    } else {
      for (;;) {
        skip();
        if (text[pos] === ")" || text[pos] === ",") fail("An argument is missing.");
        out.push(binary(0));
        skip();
        if (text[pos] === ",") {
          pos++;
          skip();
          if (text[pos] === ")") fail("An argument is missing after the comma.");
          continue;
        }
        if (text[pos] === ")") {
          pos++;
          break;
        }
        if (pos >= text.length) fail("A closing parenthesis is missing.", open);
        fail("A comma or a closing parenthesis is missing.");
      }
    }
    nesting--;
    return app(op, out, start);
  };

  /** This function reads a name, then a call, a path or a keyword literal. */
  const named = (): Parsed => {
    const start = pos;
    let first: string;
    let plain = false;
    if (text[pos] === "`") {
      first = quoted();
    } else {
      first = at(NAME_AT)!;
      pos += first.length;
      plain = true;
    }
    skip();
    if (text[pos] === "(") return args(first, start);
    if (text[pos] !== "." && plain && KEYWORDS.has(first)) return leaf({ tag: "lit", value: KEYWORDS.get(first) });
    const path = [first];
    while (text[pos] === ".") {
      pos++;
      skip();
      const c = text[pos];
      if (c === "`") path.push(quoted());
      else {
        const segment = at(NAME_AT) ?? at(DIGITS_AT);
        if (segment === undefined) return fail("A segment is missing after the dot.");
        pos += segment.length;
        path.push(segment);
      }
      skip();
    }
    if (text[pos] === "(") fail("An op name has no dots. Write the name in backticks.", start);
    return leaf({ tag: "ref", path });
  };

  const primary = (): Parsed => {
    skip();
    const c = text[pos];
    if (c === undefined) return fail("An expression is missing.");
    if (c === '"') return string();
    if (c === "[") return array();
    if (c === "{") return object();
    if (c === "`" || /[A-Za-z_$]/.test(c)) return named();
    if (c === "-") {
      const start = pos;
      pos++;
      skip();
      return number(true, start);
    }
    if (/[0-9]/.test(c)) return number(false, pos);
    if (c === ".") {
      pos++;
      return leaf({ tag: "ref", path: [] });
    }
    if (c === "(") {
      const open = pos;
      enter(open);
      pos++;
      const inner = binary(0);
      skip();
      if (text[pos] !== ")") fail("A closing parenthesis is missing.", pos >= text.length ? open : pos);
      pos++;
      nesting--;
      return inner;
    }
    return fail(`This character is not valid here: ${c}`);
  };

  const operator = (): string | undefined => {
    const two = text.slice(pos, pos + 2);
    if (two === "<=" || two === ">=") return two;
    const one = text[pos];
    return one !== undefined && hasOwn(PRECEDENCE, one) ? one : undefined;
  };

  /** This function reads an infix expression by precedence climbing. Each op is left-associative. */
  function binary(minPrecedence: number): Parsed {
    let left = primary();
    for (;;) {
      skip();
      const op = operator();
      if (op === undefined) return left;
      const precedence = PRECEDENCE[op]!;
      if (precedence < minPrecedence) return left;
      const offset = pos;
      pos += op.length;
      skip();
      if (pos >= text.length) fail(`An operand is missing after ${op}.`);
      const right = binary(precedence + 1);
      left = app(op, [left, right], offset);
    }
  }

  const parse = (): Expr => {
    const result = binary(0).expr;
    skip();
    if (pos < text.length) fail("The text continues after the expression.");
    return result;
  };

  return { parse, position: (): number => pos };
};

/**
 * This function reads the text of a formula and gives the expression. It does not throw. A failure gives a
 * message and the 0-based character offset of the problem.
 */
export const parseExpr = (text: string): ParseResult => {
  const parser = makeParser(text);
  try {
    return { ok: true, expr: parser.parse() };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, message: error.message, offset: error.offset };
    if (error instanceof RangeError) return { ok: false, message: "The expression is too deep.", offset: parser.position() };
    throw error;
  }
};
