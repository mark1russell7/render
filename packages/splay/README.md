# @mark1russell7/render-splay

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-splay?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-splay) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

Values, instance trees and renders. `hydrate` makes an instance tree from a value, `splay` renders the tree with the methods of its classes, and `dehydrate` gives the value back. A class can give a summary with the same builder as its render, thus a view shows the boundary of each thing first.

```sh
npm i @mark1russell7/render-splay @mark1russell7/render-biblo @mark1russell7/render-node
```

```ts
import { biblo, classNodeOps, registerClasses } from "@mark1russell7/render-biblo";
import { nodeStore } from "@mark1russell7/render-node";
import { defaultClassFor, dehydrate, hydrate, splayKit, standardClasses, standardOps } from "@mark1russell7/render-splay";

const b = biblo();
const store = nodeStore({ nodeOps: classNodeOps(b), ops: standardOps });
registerClasses(b, standardClasses);

const value = { name: "render", tags: ["reactive", "live"] };
const tree = hydrate(splayKit(defaultClassFor, standardOps), b, store, value);
tree.classRef; // "Grid"
dehydrate(b, store, tree.id); // the same value
```

The output type of `splay` is generic: a kit gives the view atoms, for example React elements or text. The package also has the standard classes, the standard ops and the view policy of the level of detail.

A hydrate, render or summary method is an expression: a [coeval](https://github.com/mark1russell7/coeval) document that the kernel compiles one time and evaluates. `exprClassFor` shows an expression as a tree of its documents: `ExprLit`, `ExprRef`, `ExprApp` and `ExprForm`.

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
