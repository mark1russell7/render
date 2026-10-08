# render

render is a reactive expression engine whose user interface renders its own expressions. Each value is a node with an expression, and a change propagates to the readers of the node in one ordered epoch. Classes are templates of nodes, and the viewer edits classes and instances in the same type graph.

```ts
import { app, lit, ref } from "@render/dsl";
import { addNode, nodeStore, readValue, setValue } from "@render/node";
import { standardOps } from "@render/splay";

const store = nodeStore({ ops: standardOps });
addNode(store, lit(2), "w");
addNode(store, lit(4), "h");
addNode(store, app("*", ref("w"), ref("h")), "area");

readValue(store, "area"); // { tag: "some", value: 8 }
setValue(store, "w", 3);
readValue(store, "area"); // { tag: "some", value: 12 }
store.epochStats; // the nodes that the write evaluated and changed
```

## Packages

| Package | Contents |
| --- | --- |
| [`@render/optional`](./packages/optional) | The `Optional` type of total evaluation: `none` or `some` |
| [`@render/dsl`](./packages/dsl) | The expression IR (`lit`, `ref`, `app`), its static analysis and its interpreter |
| [`@render/node`](./packages/node) | The reactive store: nodes, seats, slots, ordered epochs and the `NodeOps` extension points |
| [`@render/biblo`](./packages/biblo) | The class registry, the instance store and the class-level `NodeOps` |
| [`@render/splay`](./packages/splay) | Hydrate, splay and dehydrate, the standard classes and the standard ops |
| [`@render/pack`](./packages/pack) | Rectangle packing for the layout of the viewer |
| [`@render/seat`](./packages/seat) | Reactive path subscriptions over plain values |
| [`@render/viewer`](./packages/viewer) | The React viewer: the type graph and the canvas |
| [`@render/site`](./packages/site) | The documentation site, with live demos and the viewer |
| [`@render/cli`](./packages/cli) | The workspace commands of the template |

## Commands

```sh
pnpm install
pnpm dev                              # the viewer, with the dev server of Vite
pnpm check                            # the type check, Oxlint, the coverage, the tests and ste-lint
pnpm test:e2e                         # the browser tests of the viewer (Playwright)
pnpm bench                            # the speed lane (report only)
pnpm package add <name> --preset=ts   # make a new package
```

## Documents

- [`docs/REVIEW.md`](./docs/REVIEW.md): the review of October 2026, the plan of record
- [`docs/DECISIONS.md`](./docs/DECISIONS.md): the architecture decisions
- [`docs/archive/2026-07`](./docs/archive/2026-07): the audit, the roadmap and the decisions of July 2026
- The site: <https://mark1russell7.github.io/render/>

## Writing style

The prose of this repository follows ASD-STE100 Simplified Technical English (STE). STE is a style target. ASD does not certify this repository. The project glossary is in `ste.config.json`. Keep a local copy of the STE dictionary in `.ste/`, and do not commit it.

## Disclosure

An AI model (Claude, from Anthropic) wrote most of the text and the code of this repository, under the direction of the author. The STEMG of ASD-STE100 asks for this disclosure in its white paper on STE and artificial intelligence (June 2026).
