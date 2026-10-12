# @mark1russell7/render-node

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-node?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-node) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

The reactive store of render. Each value is a node with an expression. One write starts one epoch. The store evaluates each reader of the node in topological order, and it stops at each value that does not change.

```sh
npm i @mark1russell7/render-node @mark1russell7/render-dsl @mark1russell7/render-splay
```

```ts
import { app, lit, ref } from "@mark1russell7/render-dsl";
import { addNode, batch, nodeStore, readValue, setValue } from "@mark1russell7/render-node";
import { standardOps } from "@mark1russell7/render-splay";

const store = nodeStore({ ops: standardOps });
addNode(store, lit(2), "w");
addNode(store, lit(4), "h");
addNode(store, app("*", ref("w"), ref("h")), "area");

setValue(store, "w", 3);
readValue(store, "area"); // { tag: "some", value: 12 }
store.epochStats; // the nodes that the write evaluated and changed

// A batch makes many writes one epoch
batch(store, () => {
  setValue(store, "w", 5);
  setValue(store, "h", 5);
});
```

A node can be a container of named slots, and a reference reads through the slots. The `NodeOps` of a store (`splash`, `flow`, `deref` and `targets`) are its extension points.

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
