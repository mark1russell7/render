# @mark1russell7/render-dsl

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-dsl?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-dsl) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

The expression language of render. An expression is a [coeval](https://github.com/mark1russell7/coeval) document: an envelope `{ type, value }`. The kernel of coeval evaluates it, finds its references and checks it. This package gives the machine of render on that kernel, the builders of the documents and the formula language.

```sh
npm i @mark1russell7/render-dsl
```

```ts
import { app, evaluate, formatExpr, lit, objectResolver, parseExpr, ref } from "@mark1russell7/render-dsl";

const ops = { "*": (a: number, b: number) => a * b };
const area = app("*", ref("box", "width"), lit(2));
// { type: ["ops", "*"], value: [{ type: "ref", value: ["world", "box", "width"] }, 2] }

evaluate(area, objectResolver({ box: { width: 21 } }), ops); // { tag: "some", value: 42 }
evaluate(area, objectResolver({}), ops); // { tag: "none" }: the path box.width has no value
formatExpr(area); // "box.width * 2"
parseExpr("max(2, 3) * 4"); // { ok: true, expr: the document of the formula }
```

The evaluation does not throw. A missing path, an unknown op or an op that throws gives `none`, and an optional list of issues tells the cause.

## The documents

Each language that uses coeval writes the same idea as the same document (decision D12 of coeval). The builders `lit`, `ref`, `app` and `record` write the canonical document of an expression.

- A literal is its value in a position that holds terms. A literal with the shape of an envelope, and a literal at the root, is `{ type: "lit", value }`.
- A reference starts at `names` for a parameter of an enclosing `fn`, and at `world` for each other name. The host finds a `world` name, for example a node ID or `self`.
- An op application is `{ type: ["ops", ...keys], value: [...args] }`.
- `if`, `and`, `or`, `fn` and `record` are the constructs of the kernel, for example `{ type: "if", value: { test, then, else } }`. A form that its construct cannot hold stays an op application.
- `undefined`, `NaN`, `Infinity`, `-Infinity` and `-0` are the extensions `["ext", "undefined"]` and `["ext", "number"]`.

## The kernel

render has no interpreter of its own (decision D13 of coeval). The machine of render is the formula kit of the kernel with the profile of render:

- The truth of a value is the truth of JavaScript. `and` and `or` give the value that decided.
- An `if` without `else` gives `undefined`. A `record` leaves out a field whose value fails.
- The values are data: a value with the shape of a reference stays a value.
- A path starts at `names` or `world`. The nesting has a limit of 1000 documents.

`plannerOf(ops)` compiles each expression one time, and the plan evaluates it many times. `checkExpr` and `isExpr` check a document with the static kit of the kernel. `renderWorld` is the world of the kinds, for `refsOf`, `mapRefs` and `walk` of the kernel. The documents of version 0.1.1 (`["ops", "if"]`, `["ops", "and"]` and `["ops", "or"]`) still evaluate.

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
