# The review of October 2026

This document is the plan of record of render. It records the review of October 2026, the defects that the review found, the changes to the architecture, and the open items.

The review examined all packages after the July roadmap. The method had four parts:

1. A reader examined each file of each package.
2. Scratch tests against the old code showed each suspected engine defect before a fix.
3. A Playwright probe drove the old viewer (the `roadmap` commit) to show each suspected defect of the viewer.
4. After the fixes, an independent reviewer without the context of the work looked for defects in the new code. It found `R-32` to `R-48`, each with a scratch test.

Each defect has an ID (`R-01` to `R-48`). Each fixed defect has a regression test that names its ID, thus the site can show the status of each test.

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
| R-32 | node | A node that read a cycle, but was not on it, could evaluate before the cycle and keep an old value, and the stats named it as cyclic | The epoch orders the strongly connected components (Tarjan). The members of a cycle evaluate again until they are stable, with a limit of 100 rounds |
| R-33 | node | A reader of a missing slot of its own container had a value seat on the container, thus a false cycle kept old values after the removal of a slot | A path that stops at a container reads a missing slot: it gives `none` and gets only a structural seat |
| R-34 | node | `expandNode` inside a batch used the value from before the batch, thus it reverted a write of the batch | Inside a batch, the expansion waits for the epoch of the batch |
| R-35 | biblo | A typed cell of its own class (or a cycle of classes) recursed without a limit and left thousands of instances | A typed cell whose class is above it on the chain of typed cells is a plain cell |
| R-36 | biblo | `updateClass` ignored each change of a typed cell | `updateClass` adds, removes and replaces typed cells, and it sends a change of bindings to the cells of the child |
| R-37 | node | An op that threw during an epoch lost the rest of the epoch for all time | The dirty nodes that the epoch did not evaluate stay pending, and the next flush evaluates them |
| R-38 | viewer | A click into a value and out of it wrote the value again: `undefined` became the text "undefined", and `NaN` became `null` | A draft without a change writes nothing, and the special literals read back as themselves |
| R-39 | splay | A drop of `ExprLit` or `ExprRef` into the arguments of an op was always refused | The expression classes have valid default expressions |
| R-40 | biblo | `updateClass` did not update a cell with a deep expression, because `valueEquals` stops at 32 levels | `updateClass` compares expressions with `exprEquals` |
| R-41 | biblo, viewer | A cell or a method named `__proto__` became the prototype of the record and was lost | The records come from `Object.fromEntries` |
| R-42 | viewer | The splay memo kept the entries of destroyed instances | The session deletes the memo entries of instances that no longer exist |
| R-43 | viewer | An edit of the default of `Text` changed the search box | The search box has a binding, thus it does not follow the class |
| R-44 | dsl, node | A very deep tree or a cyclic object gave a `RangeError` | The interpreter has a depth limit, `deps` uses no recursion, and an expansion keeps a cyclic field as a leaf |
| R-45 | splay | `exprClassFor` read each object with a tag as an expression, thus a data view changed data with a tag field | Only the exact shape of an expression node is an expression |
| R-46 | node | A container became the owner of each node that it took first, and a slot change left an owned node as an orphan | Ownership is explicit (`setSlot` with `own`), and a container that drops an owned node removes it |
| R-47 | biblo | `updateClass` changed a bound cell when the binding was equal to the default, and it removed a shared cell node | The biblo records the bound cells, and a removed cell only unlinks a shared node |
| R-48 | node, dsl | An error of the function of a batch was lost when the flush also failed, and `if(cond)` without a branch gave a value | The batch keeps the first error, and `if` needs a `then` branch |

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

The `parent` of a node is the container that owns it. Ownership is explicit: `setSlot` with `own` gives it, and the engine and the biblo use it for the nodes that they make. A container can share a node that another container owns, and `heldBy` records each container with a slot to a node. `removeNode` removes the node and its owned subtree, detaches each slot that points into the subtree, and evaluates the readers that stay. A container that drops a node that it owns removes it (R-46).

### Forward references

A read whose root is not in the store waits in an index of the store. When a node with that ID comes, the engine rewires the waiting readers and evaluates them (R-13). Thus the nodes of a batch can read each other in any order.

### The epoch machine

An epoch finds the closure of its frontier through `flow`. It orders the strongly connected components of the closure topologically (Tarjan), and it evaluates each dirty node in that order. A node outside a cycle evaluates one time. The members of a cycle evaluate again until their values are stable, up to 100 rounds, like the iterative calculation of a spreadsheet (R-32). `EpochStats.cyclic` names only the members of cycles, and `EpochStats.changed` names the nodes whose value changed.

The machine keeps its state in scratch fields of the nodes, with the epoch number as a stamp. Thus it does no hashing for each node. When an op throws, the dirty nodes that the epoch did not evaluate stay pending (R-37).

### Class to instance sync

`updateClass` registers a new version of a class and updates the live instances of the class and of its subclasses. An instance cell that still has the old expression of the class gets the new expression. A cell with an edit of its own keeps it, and the biblo records each bound cell, thus a binding stays too (R-47). Typed cells follow the class as well: a new type gives a new child, and new bindings reach the cells of the child (R-36). Thus the sync works in the two directions: an edit on the canvas changes the class, and an edit of the class reaches the canvas.

### The viewer session model

`ViewerSession` holds the state of the viewer outside React. It routes each edit by the place of the instance: the search box, a class card or a canvas item. The React view reads it with `useSyncExternalStore` and reads no ref during the render. Headless tests examine each flow of the viewer without a browser.

### Level of detail

The second pass of October 2026 closed the open items of the first pass, and it added level of detail (AD-32, AD-33). A class can have a `summary` method with the same builder as its render. A view policy selects the summary or the full view of each instance, and a person drills down one instance at a time. The class cards of the viewer show the boundary of each class at first: its parent, its cells and its methods. Each method is a formula on one line (AD-34), and a click edits it as text.

Traits give views to each class with a structure (AD-30). Each cell gets a unique prime, and a trait applies when its fingerprint divides the fingerprint of the class. The `targets` op of the store makes a custom `deref` reactive (AD-31).

The viewer records each action, thus undo and redo replay the record (AD-35). The record is also the saved session: the browser keeps it, and a file exports it. The data view writes back to its item (AD-36), and a card renames its user class (AD-37). A change of a class deletes only the memo entries of its instances.

## Performance

The native bench (`pnpm bench`) uses a store of 2204 nodes: a value of 50 objects with 5 fields.

| Measurement | Time |
| --- | --- |
| Epoch of one leaf edit | 1.5 µs |
| Hydrate of the value | 2.5 ms |
| `resolveAll` of the settled store | 1.5 ms |
| Splay of the full tree, cold memo | 0.5 ms |
| Splay of the full tree, warm memo | 0.06 µs |

The July numbers came from a different harness and from a different store, thus they do not compare directly with these numbers.

## Open items

The second pass closed five items of the first pass:

| Item | Status |
| --- | --- |
| Prime polymorphism was deferred (AD-10) | Closed: traits with prime fingerprints (AD-30) |
| A custom `deref` resolved only through slots, or an epoch missed a change | Closed: the `targets` op gives the nodes of a read (AD-31) |
| The viewer refused the rename of a class | Closed: a card renames a user class (AD-37) |
| The data view of a canvas item was read-only | Closed: an edit in it goes back to the item (AD-36) |
| After each class update, the viewer cleared the full splay memo | Closed: it deletes only the entries of the instances of the class and of its subclasses |

These limits stay, by design:

- A cycle that does not become stable stops after 100 rounds in each epoch. The epoch reports its members, and the viewer shows a badge. The values of the last round stay.
- An expression deeper than 1000 levels gives `none` with a `bad-expr` issue.
- The dependencies stay static (`deps`). A `targets` op gives the nodes of each static path, not the paths of a computed key.
- A value edit in the data view goes to the twin instance of the item, thus the classes stay. A structural edit (an add or a replacement) hydrates the data again with `classFor`. Thus after it, a child of a user class in a stack comes back as a child of the standard class of its value.
- Undo replays the full record from the start. A long session pays one replay for each undo. A saved session applies only to a viewer with the same initial model (its baseline).

## Checks

- `pnpm check` does the type check, Oxlint, the coverage, the tests and `ste-lint`.
- `pnpm test:e2e` tests the viewer in Chromium.
- `pnpm bench` gives the speed lane. It only reports, and no time limit fails it.

The coverage floor of the engine packages is 95% of the statements, 87% of the branches, 98% of the functions and 97% of the lines. A run under the floor fails.
