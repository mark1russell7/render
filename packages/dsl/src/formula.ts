/**
 * The formula language: the text form of an expression. The parser gives a coeval document, and the formatter reads one.
 *
 * - A literal is JSON, or `undefined`, `NaN`, `Infinity` or `-Infinity`.
 * - A reference is a path with dots: `self.cells`. A segment that is not a name goes in backticks: `` self.`my key` ``.
 *   Inside `fn(["x"], ...)`, a path that starts with `x` reads the parameter (`names`). Each other path reads the
 *   host (`world`).
 * - An application is a call: `textView(get(self.cells, "value"), self.setCell)`. The forms `if`, `and`, `or`, `fn`
 *   and `record` are the constructs of the kernel (`app`).
 * - The ops `* /`, `+ -` and `< > <= >=` with two arguments are infix, in that order of precedence.
 */
import type { Envelope, Json } from "@mark1russell7/coeval";
import { isEnvelope, isKey, typePath } from "@mark1russell7/coeval";
import type { Expr } from "./expr.ts";
import { app, lit, literalOf, opOf, ref } from "./expr.ts";

/** The deepest nesting of the text and of a document that the formatter writes. It is the depth limit of the kernel. */
const MAX_DEPTH = 1000;

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

/** The text of a part that the formula language cannot write, for example a `let`. The parser refuses it. */
const NO_TEXT = "…";

/** This function gives the text of a reference, or `undefined` when the text cannot write it. */
const refText = (value: Json, scope: ReadonlySet<string>): string | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const [root, ...steps] = value as readonly Json[];
  if (!steps.every(isKey)) return undefined;
  const path = steps.map(String);
  const head = path[0];
  // A names path reads a parameter of an enclosing fn. A world path must not have the name of such a parameter.
  if (root === "names") return head !== undefined && scope.has(head) ? pathText(path) : undefined;
  if (root === "world") return head !== undefined && scope.has(head) ? undefined : pathText(path);
  return undefined;
};

/** This function gives the name of an op or a form in the text: in backticks when it is not a plain name. */
const nameText = (name: string): string => (NAME.test(name) ? name : quote(name));

/** This function gives the text of a term in a position with the minimum precedence. */
const formatAt = (term: unknown, minPrecedence: number, depth: number, scope: ReadonlySet<string>): string => {
  if (depth > MAX_DEPTH) return NO_TEXT;
  if (!isEnvelope(term)) return literalText(term);
  const literal = literalOf(term);
  if (literal !== undefined) return literalText(literal.value);
  const doc = term as Envelope;
  const keys = typePath(doc.type);
  const value = doc.value as unknown;
  const call = (name: string, args: readonly unknown[], inner: ReadonlySet<string> = scope): string =>
    `${nameText(name)}(${args.map((a) => formatAt(a, 0, depth + 1, inner)).join(", ")})`;
  if (doc.name !== undefined || doc.own !== undefined || keys === undefined) return NO_TEXT;
  const op = opOf(doc);
  if (op !== undefined) {
    if (!Array.isArray(value)) return NO_TEXT;
    const precedence = value.length === 2 && hasOwn(PRECEDENCE, op) ? PRECEDENCE[op] : undefined;
    if (precedence === undefined) return call(op, value);
    const text = `${formatAt(value[0], precedence, depth + 1, scope)} ${op} ${formatAt(value[1], precedence + 1, depth + 1, scope)}`;
    return precedence < minPrecedence ? `(${text})` : text;
  }
  const kind = keys.length === 1 ? String(keys[0]) : "";
  const fields = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
  switch (kind) {
    case "ref":
      return refText(doc.value, scope) ?? NO_TEXT;
    case "and":
    case "or":
      return Array.isArray(value) ? call(kind, value) : NO_TEXT;
    case "if": {
      if (fields === undefined || !hasOwn(fields, "test") || !hasOwn(fields, "then")) return NO_TEXT;
      if (Object.keys(fields).some((k) => k !== "test" && k !== "then" && k !== "else")) return NO_TEXT;
      return call("if", hasOwn(fields, "else") ? [fields["test"], fields["then"], fields["else"]] : [fields["test"], fields["then"]]);
    }
    case "fn": {
      const params = fields?.["params"];
      if (fields === undefined || Object.keys(fields).length !== 2 || !hasOwn(fields, "body")) return NO_TEXT;
      if (!Array.isArray(params) || !params.every((p) => typeof p === "string")) return NO_TEXT;
      const inner = new Set([...scope, ...(params as readonly string[])]);
      return `fn(${JSON.stringify(params)}, ${formatAt(fields["body"], 0, depth + 1, inner)})`;
    }
    case "record": {
      if (fields === undefined) return NO_TEXT;
      const parts = Object.entries(fields).map(([name, field]) => `${JSON.stringify(name)}, ${formatAt(field, 0, depth + 1, scope)}`);
      return `record(${parts.join(", ")})`;
    }
    default:
      return NO_TEXT;
  }
};

/**
 * This function gives the canonical one-line text of an expression. `parseExpr` reads the text back to an equal
 * document. Three limits apply. A literal that JSON cannot write gives `undefined`, and a special value inside an
 * array or an object gives its JSON form. A part that the text cannot write gives `…`, which is not valid text.
 * Examples are a `let`, a `list`, a `call` construct and a part deeper than 1000 levels.
 */
export const formatExpr = (e: Expr): string => formatAt(e, 0, 0, new Set());

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
    if (++nesting > MAX_DEPTH) fail(`The expression is deeper than ${String(MAX_DEPTH)} levels.`, offset);
  };
  const apply = (op: string, args: readonly Parsed[], offset: number): Parsed => {
    const height = 1 + args.reduce((h, a) => Math.max(h, a.height), 0);
    if (height > MAX_DEPTH) fail(`The expression is deeper than ${String(MAX_DEPTH)} levels.`, offset);
    return { expr: app(op, ...args.map((a) => a.expr)), height };
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
      return leaf(lit(JSON.parse(text.slice(start, pos)) as unknown));
    } catch {
      return fail("The string is not valid JSON.", start);
    }
  };

  const number = (negative: boolean, start: number): Parsed => {
    const digits = at(NUMBER);
    if (digits !== undefined) {
      pos += digits.length;
      const n = Number(digits);
      return leaf(lit(negative ? -n : n));
    }
    const name = at(NAME_AT);
    if (name === "Infinity" || name === "NaN") {
      pos += name.length;
      const n = KEYWORDS.get(name) as number;
      return leaf(lit(negative ? -n : n));
    }
    return fail("A minus sign is valid only before a number. For another value, write 0 - x.", start);
  };

  /** This function reads the elements of an array or an object literal. Each element must be a literal. */
  const literalValue = (kind: "array" | "object"): unknown => {
    skip();
    const start = pos;
    const element = literalOf(binary(0).expr);
    if (element === undefined) {
      return fail(
        kind === "array"
          ? "An element of an array literal is not a literal. Write array(...) for computed elements."
          : "A value of an object literal is not a literal. Write record(...) for computed values.",
        start,
      );
    }
    return element.value;
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
    return leaf(lit(values));
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
    return leaf(lit(Object.fromEntries(entries)));
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
    return apply(op, out, start);
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
    if (text[pos] !== "." && plain && KEYWORDS.has(first)) return leaf(lit(KEYWORDS.get(first)));
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
    return leaf(ref(...path));
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
      return leaf(ref());
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
      left = apply(op, [left, right], offset);
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
