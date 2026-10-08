# The review of October 2026

This document is the plan of record of render. It records the review of October 2026, the defects that the review found, the changes to the architecture, and the open items.

The review examined all packages after the July roadmap. The method had three parts:

1. A reader examined each file of each package.
2. Scratch tests against the old code showed each suspected engine defect before a fix.
3. A Playwright probe drove the old viewer (the `roadmap` commit) to show each suspected defect of the viewer.

Each defect has an ID (`R-01` to `R-31`). Each fixed defect has a regression test that names its ID, thus the site can show the status of each test. The July audit is in [`archive/2026-07/REVIEW.md`](./archive/2026-07/REVIEW.md).

## Defects

| ID | Package | Defect | Fix |
| --- | --- | --- | --- |
| R-01 | dsl | `objectResolver` read inherited properties, thus `ref("a", "constructor")` gave a function of `Object.prototype` | The resolver reads only own properties |
| R-02 | dsl | The op lookup read `Object.prototype`, thus `app("constructor", lit(1))` gave `Object(1)` | The interpreter reads only own ops, and an inherited name is an `unknown-op` |
| R-03 | dsl | The frame of a `fn` form was a plain object, thus `ref("toString")` in a lambda body found the inherited function and not the outer value | The frame is a `Map` |
| R-04 | dsl | `deps` gave the parameters of a `fn` form as dependencies | `deps` gives only the free references |
| R-05 | dsl | `evaluate` threw a `TypeError` on a malformed tree, thus a malformed render method stopped the render | `evaluate` is total: a malformed node gives `none` and a `bad-expr` issue |
| R-06 | splay | `props` and the dehydrate of `Grid` with the key `__proto__` changed the prototype of the result | `Object.fromEntries` makes own data properties |
| R-07 | node | A node kept its old value when its expression stopped to resolve, and its readers kept their old values too | `none` is a value: `splash` takes an `Optional`, and the change propagates |
| R-08 | node, biblo | `removeNode` and `destroyInstance` left the readers with old values and left a slot that pointed at a removed node | The removal detaches each slot and evaluates the readers, which become `none` |
| R-09 | node | After `expandNode`, a write to the node did not reach its readers, because the old slots hid the new value | A write to a container collapses it first |
| R-10 | node | `expandNode` overwrote an existing node when its generated ID was already in use | `addNode` takes the ID as a hint and does not overwrite a node |
| R-11 | node | `setSlot` did not evaluate the readers of the ancestors, and it left the old child with its old parent | The container gets a new record, and the old child loses its owner |
| R-12 | node | `resolveAll` evaluated a node that reads itself 2N times, and the sorts used `Array.shift` | `resolveAll` is one ordered epoch, and the queues use an index |
| R-13 | node | A reader that came before its target did not find the target when the target came | A read with a missing root waits in an index and gets rewired |
| R-14 | node | Each call gave its own `NodeOps`, thus two callers could evaluate one store with different semantics | The store owns its `NodeOps` and its op registry |
| R-15 | node | `valueEquals` found an inherited key as present | The comparison reads only own keys |
| R-16 | biblo | `instantiate` ignored a binding of the caller for a typed cell | The binding makes the typed cell a plain cell |
| R-17 | biblo | The scope rewrite changed a `fn` parameter with the name `self` or `parent` | The rewrite changes only free references |
| R-18 | biblo | An instance had no values until the caller started `wireSeats` and `resolveAll` | `instantiate` and `destroyInstance` keep the store consistent |
| R-19 | node, biblo | The ID counters were global to the module, thus all stores and registries shared them | Each store and each biblo has its own counter |
| R-20 | biblo | `classNodeOps` made the method table again on each op, and the owner came from the ID text | The tables have a cache that `registerClass` clears, and `ownerOf` walks the slot tree |
| R-21 | biblo | `resolveScope` was dead code with semantics that `instantiate` did not have | The function is removed |
| R-22 | splay | The math ops and `map` gave a result for a value of an incorrect type, without an issue | The ops throw a typed error, which becomes an `op-threw` issue |
| R-23 | splay | The op `get` read inherited properties | The op reads only own fields |
| R-24 | splay | `eq` compared plain data by reference, unlike the change detection of the engine | `eq` uses `valueEquals`, the structural equality of the engine |
| R-25 | seat | `touch` with an empty path threw, an empty seat path had no tail, and `resolve` read inherited properties | `touch([])` walks each path from the root, an empty path throws a `RangeError`, and the walk reads own fields |
| R-26 | pack | Without fixed sizes, the outer rectangle was narrower than the widest rectangle | The start width is not less than the widest rectangle |
| R-27 | viewer | A text equal to a class name became a drag chip, and a person could not edit it again | The class keys of the type graph are `ClassName` instances: a chip is a position, not a text |
| R-28 | viewer | An empty number edit wrote 0 | The number edit refuses an empty draft and a draft that is not a number |
| R-29 | viewer | An edit of a render method in the type graph did not reach the canvas | A class update clears the splay memo, and the live instances follow the class |
| R-30 | viewer | An edit in the data view changed a copy, and the next toggle lost it | The data view is read-only |
| R-31 | viewer | A drop of a class into the arguments of a method, then an edit of that card, stopped the full viewer | The interpreter is total (R-05), and the session refuses an invalid card edit with a notice |

## Architecture changes

### The store owns its semantics

A store gets its `NodeOps` and its op registry when it is made: `nodeStore({ nodeOps, ops })`. Before, each write and each resolution took these values as arguments. Thus two callers could evaluate one store with different semantics (R-14). At this time, all writes of a store use the same `splash`, `flow` and `deref`.

### Writes keep the store consistent

Each write changes the structure at once and touches the nodes that it changes. A flush then rewires the touched nodes and does one ordered epoch over them. Outside a batch, each write flushes at its end. `batch(store, fn)` is the transaction: all writes in `fn` evaluate in one epoch at the end, and `fillMany` is a batch. A host does not start `wireSeats` or `resolveAll` after an action.

### None is a value

An expression that does not resolve gives `none`, and `splash` writes it like each other result. A change from a value to `none`, or back, propagates to the readers. Thus the value of each node agrees with its expression after each epoch (R-07, R-08).

### Containers are records of their slots

A node with slots is a container. Its expression is a generated `record` form over its slots, thus its value is the record of the slot values. This change removes the read-time materialization and the rule that made the readers of each ancestor dirty. A reader of a container is a normal value reader. A write to a container collapses it: the owned slots are removed, and the new expression replaces the record (R-09).

### Ownership and removal

The `parent` of a node is the container that owns it. A container can share a node that another container owns. `removeNode` removes the node and its owned subtree, detaches each slot that points into the subtree, and evaluates the readers that stay.

### Forward references

A read whose root is not in the store waits in an index of the store. When a node with that ID comes, the engine rewires the waiting readers and evaluates them (R-13). Thus the nodes of a batch can read each other in any order.

### The epoch machine

An epoch finds the closure of its frontier through `flow`, sorts it with Kahn's algorithm, and evaluates each dirty node one time in that order. The machine keeps its state in scratch fields of the nodes, with the epoch number as a stamp. Thus it does no hashing for each node. The nodes on a cycle come after the sorted part, and `EpochStats.cyclic` names them. `EpochStats.changed` names the nodes whose value changed.

### Class to instance sync

`updateClass` registers a new version of a class and updates the live instances of the class and of its subclasses. An instance cell that still has the old expression of the class gets the new expression. A cell with an edit or a binding of its own keeps it. Thus the sync works in the two directions: an edit on the canvas changes the class, and an edit of the class reaches the canvas.

### The viewer session model

`ViewerSession` holds the state of the viewer outside React. It routes each edit by the place of the instance: the search box, a class card or a canvas item. The React view reads it with `useSyncExternalStore` and reads no ref during the render. Headless tests examine each flow of the viewer without a browser.

## Performance

The native bench (`pnpm bench`) uses a store of 2204 nodes: a value of 50 objects with 5 fields.

| Measurement | Time |
| --- | --- |
| Epoch of one leaf edit | 1.1 µs |
| Hydrate of the value | 4.8 ms |
| `resolveAll` of the settled store | 3.9 ms |
| Splay of the full tree, cold memo | 0.5 ms |
| Splay of the full tree, warm memo | 0.06 µs |

The July numbers came from a different harness and from a different store, thus they do not compare directly with these numbers.

## Open items

- Prime polymorphism stays deferred (AD-10). String class names are not a bottleneck at this time.
- The dependencies are static (`deps`), not dynamic. A custom `deref` must resolve through slots like the default op, or an epoch can miss a change.
- The viewer refuses the rename of a class.
- The data view of a canvas item is read-only.
- After each class update, the viewer clears the full splay memo, thus all cards render again.
- The nodes on a cycle evaluate one time in each epoch. The engine does not iterate a cycle to a fixpoint.

## Checks

- `pnpm check` does the type check, Oxlint, the coverage, the tests and `ste-lint`.
- `pnpm test:e2e` tests the viewer in Chromium.
- `pnpm bench` gives the speed lane. It only reports, and no time limit fails it.

The coverage floor of the engine packages is 95% of the statements, 87% of the branches, 98% of the functions and 97% of the lines. A run under the floor fails.
