# @mark1russell7/render-dsl

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-dsl?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-dsl) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

The expression language of render. An expression is plain data with three node types: `lit`, `ref` and `app`. This package gives the IR, its static analysis, a total interpreter, and a formula syntax that parses to the IR and back.

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

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
