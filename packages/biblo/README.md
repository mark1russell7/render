# @mark1russell7/render-biblo

[![npm](https://img.shields.io/npm/v/@mark1russell7/render-biblo?color=2346c4)](https://www.npmjs.com/package/@mark1russell7/render-biblo) [![CI](https://github.com/mark1russell7/render/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/render/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-2346c4)](https://github.com/mark1russell7/render/blob/main/LICENSE)

The classes of render. A class is a template of nodes: cells with expressions, and methods. An instance is an ID and a scope. A change of a class reaches each instance that still follows it.

```sh
npm i @mark1russell7/render-biblo @mark1russell7/render-node @mark1russell7/render-dsl
```

```ts
import { app, lit, ref } from "@mark1russell7/render-dsl";
import { biblo, classNodeOps, componentClass, instantiate, registerClass, updateClass } from "@mark1russell7/render-biblo";
import { nodeStore, readValue } from "@mark1russell7/render-node";

const ops = { concat: (...parts: unknown[]) => parts.join("") };
const badge = (label: string) =>
  componentClass("Badge", {
    label: { expr: lit(label) },
    text: { expr: app("concat", lit("[ "), ref("self", "label"), lit(" ]")) },
  });

const b = biblo();
const store = nodeStore({ nodeOps: classNodeOps(b), ops });
registerClass(b, badge("star"));
const inst = instantiate(b, store, "Badge");
const text = store.nodes.get(inst.id)!.slots.get("text")!;
readValue(store, text); // { tag: "some", value: "[ star ]" }

updateClass(b, store, badge("planet"));
readValue(store, text); // { tag: "some", value: "[ planet ]" }
```

Traits give methods to each class with a set of cells. The fingerprint of a class is a product of primes, thus the match of a trait is one division.

A class is data: each expression is a [coeval](https://github.com/mark1russell7/coeval) document, thus a class from JSON text registers as it is. An instance scopes its cells with `mapRefs` of the kernel: `self` and `parent` become node IDs, and the parameters of a `fn` stay. `updateClass` compares the expressions with `docEquals`.

## More

- [The site](https://mark1russell7.github.io/render/): the guide, live demos and the viewer.
- [The API reference](https://mark1russell7.github.io/render/reference/api/): the exports of each package.
- [The repository](https://github.com/mark1russell7/render): the source, the tests and the review of each known defect.

Each package of render is ESM, has TypeScript declarations, and works in Node.js 22.12 or later and in browsers. The license is MIT.
