# @mark1russell7/render-dsl

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-dsl?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-dsl) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

The expression language of render. An expression is plain data with three node types: `lit`, `ref` and `app`. This package gives the IR, its static analysis and a total interpreter. It also gives a formula syntax that parses to the IR and back, and the coeval documents of the IR.

```sh
npm i @mark1russell7/render-dsl
```

```ts
import { app, deps, evaluate, formatExpr, lit, objectResolver, parseExpr, ref } from "@mark1russell7/render-dsl";

const ops = { "*": (a: number, b: number) => a * b };
const area = app("*", ref("box", "width"), lit(2));

evaluate(area, objectResolver({ box: { width: 21 } }), ops); // { tag: "some", value: 42 }
evaluate(area, objectResolver({}), ops); // { tag: "none" }: the path box.width has no value
deps(area); // [["box", "width"]]
formatExpr(area); // "box.width * 2"
parseExpr("max(2, 3) * 4"); // { ok: true, expr: app("*", app("max", ...), lit(4)) }
```

The interpreter does not throw. A missing path, an unknown op or an op that throws gives `none`, and an optional list of issues tells the cause.

## Documents

The interchange form of an expression is a [coeval](https://github.com/mark1russell7/coeval) document: an envelope `{ type, value }`. Each language that uses coeval writes the same idea as the same document.

```ts
import { app, evaluate, fromDocument, lit, objectResolver, ref, toDocument } from "@mark1russell7/render-dsl";

const ops = { "*": (a: number, b: number) => a * b };
const scaled = app("fn", lit(["x"]), app("*", ref("x"), ref("scale")));
const doc = toDocument(scaled);
// { type: "fn", value: { params: ["x"], body: { type: ["ops", "*"], value: [
//   { type: "ref", value: ["names", "x"] }, { type: "ref", value: ["world", "scale"] } ] } } }
fromDocument(doc); // { tag: "some", value: scaled }
evaluate(toDocument(app("*", ref("w"), lit(2))), objectResolver({ w: 21 }), ops); // { tag: "some", value: 42 }
```

- A literal is its JSON value. A literal with the shape of an envelope is `{ type: "lit", value }`, and the root of a document is always an envelope.
- A reference starts at `names` for a parameter of an enclosing `fn`, and at `world` for each other name.
- An op application is `{ type: ["ops", ...keys], value: [...args] }`. The forms `record` and `fn` are the constructs `record` and `fn`.
- `undefined`, `NaN`, `Infinity`, `-Infinity` and `-0` are the extensions `["ext", "undefined"]` and `["ext", "number"]`.

`fromDocument(toDocument(e))` gives `e` again, also after JSON text. `evaluate` takes a document in place of an expression. `fromDocument` is total: a document that is not valid gives `none` with a `bad-expr` issue that tells the problem and its place. `isExprDocument` checks a full document, and `asExpr` reads a document at a boundary that takes both forms.

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
