# Architecture decisions

This log records each architecture decision of render: the question, the decision and the reason. AD-1 to AD-15 come from the July roadmap. AD-16 and later come from the review of October 2026 ([`REVIEW.md`](./REVIEW.md)).

## AD-1: A branch for the roadmap

The July roadmap changed the engine in many phases. All its work went to the branch `roadmap`, and the merge to `main` was the decision of the owner. Thus `main` stayed known-good.

## AD-2: A write changes the expression

`setValue` writes `lit(value)` as the expression of the node. A write to a derived node makes it an input node, like a value that a person types over a formula. Thus a later evaluation cannot revert a write.

## AD-3: No default value in a cell template

`CellDef.default` is removed. The expression is the source of truth, thus it is also the default.

## AD-4: The contract of NodeOps

`splash` gives `true` when the value changed, `flow` gives the nodes that a change makes dirty, and `deref` is the one path resolver. **Changed in October 2026:** `splash` takes an `Optional`, because `none` is a value (AD-19).

## AD-5: The interpreter takes a resolver

`evaluate(expr, resolver, ops, issues?)` takes a function from a path to an `Optional`. There is one path semantic for all layers, and no context object to materialize.

## AD-6: Issues and not a result type

The interpreter collects `EvalIssue` records when the caller gives an array. The result type stays `Optional`. Thus each `none` has a cause, and the call sites do not change.

## AD-7: Class methods as NodeOps in biblo

`classNodeOps(b)` gives NodeOps that use the `splash`, `flow` and `deref` methods of the class of each node. The node layer knows nothing of biblo, thus the layers stay in their order.

## AD-8: Lazy special forms

The interpreter evaluates `if`, `and` and `or` lazily, before it looks for an op. `fn` makes a lambda, thus `map` works with pure expressions. October 2026 adds the `record` form.

## AD-9: The semantics of the seat package in node

The node layer has structural seats and `setSlot`, which is the rewalk of the seat package. The seat package stays as a library of path subscriptions over plain values. **Changed in October 2026:** `setSlot` makes the record of the container again (AD-20).

## AD-10: Prime polymorphism is deferred

String class names are not a bottleneck. The engine adds prime polymorphism only when a real need comes. **Changed in October 2026:** the need came with views for compositions. Class names stay strings, and traits use prime fingerprints (AD-30).

## AD-11: Draggable class names

July: a set of class names, which the app kept in sync with the registry, made a text draggable. **Changed in October 2026:** the set is removed. The keys of the class cards are `ClassName` instances. Thus a draggable name is a position in the type graph, not a text content (AD-25, R-27).

## AD-12: Dehydrate is a class method

Each standard class has a dehydrate method, and the extends chain resolves it like hydrate and render. The engine has no knowledge of a specific class.

## AD-13: Playwright for the viewer

July: plain driver scripts in `scripts/`. October 2026: a Playwright test suite in `packages/viewer/e2e` replaces them, and CI starts it.

## AD-14: Ordered epochs

An epoch evaluates its closure in topological order, thus a diamond with arms of different length cannot read an old value. Each node evaluates at most one time in each epoch.

## AD-15: Expansion lives in node

`expandNode` makes each field of an object value a slot node. **Changed in October 2026:** the expanded node becomes a container whose expression is the record of its slots. A write to it collapses the expansion (AD-20, R-09).

## AD-16: The template monorepo

**Question:** Which shape for the repository? **Decision:** The shape of the shared template: pnpm 12, TypeScript 7, Vitest 5, the configs of `@mark1russell7/cue`, and packages that other packages use as source. **Why:** One shape for all repositories of the owner, no build step between packages, and the same checks in CI.

## AD-17: The store owns its semantics

**Question:** Where do the NodeOps and the op registry live? **Decision:** In the store: `nodeStore({ nodeOps, ops })`. **Why:** Before, each call gave its own NodeOps. Thus two callers could evaluate one store with different semantics (R-14).

## AD-18: Writes flush unless batched

**Question:** Who makes a store consistent after a write? **Decision:** The write. It touches what it changes, and a flush rewires and evaluates at its end. `batch` defers the flush to the end of a transaction. **Why:** A host can forget `wireSeats` or `resolveAll`, and a full resolution after each action was slow.

## AD-19: None propagates

**Question:** What does a node hold when its expression has no result? **Decision:** `none`, and the change propagates like each other change. **Why:** Before, the node kept its old value, thus the value and the expression disagreed (R-07).

## AD-20: Containers are records of their slots

**Question:** What is the value of a node with slots? **Decision:** The record of its slot values, through a generated `record` expression. A write to a container collapses it. **Why:** One rule replaces the read-time materialization and the dirty rule of the ancestors, and a write cannot hide behind old slots (R-09, R-11).

## AD-21: Ownership and removal

**Question:** What does a removal remove? **Decision:** The node and the slot nodes that it owns (`parent`). The other holders lose their slots, and the readers evaluate again. **Why:** A removal left readers with old values and slots that pointed at nothing (R-08).

## AD-22: Instances follow their class

**Question:** Does an edit of a class reach its live instances? **Decision:** Yes. `updateClass` gives the new expression to each instance cell that still has the old one. A cell with an edit or a binding of its own keeps it. **Why:** Classes are templates, and the viewer edits classes and instances in the two directions.

## AD-23: The session model of the viewer

**Question:** Where does the state of the viewer live? **Decision:** In `ViewerSession`, outside React, which the view reads with `useSyncExternalStore`. **Why:** The old component read a mutable engine from a ref during the render, and its flows had no tests. The session has headless tests.

## AD-24: The data view is read-only

**Question:** What does an edit in the data view do? **Decision:** The data view does not edit. **Why:** The old data view edited a copy, and the next toggle lost the edit (R-30). A write back to the instance needs a rule for each class. **Changed in the second pass:** the rule exists (AD-36).

## AD-25: Invalid card edits are refused

**Question:** What happens when an edit of a class card gives an invalid class? **Decision:** The session refuses it, shows the card of the current class again, and shows a notice with the reason. A new class name is refused too. **Why:** An invalid render method stopped the full viewer (R-31), and a rename needs updates of subclasses and instances. **Changed in the second pass:** `renameClass` does these updates, thus a card renames a user class (AD-37).

## AD-26: The site

**Question:** How does render publish its documents? **Decision:** A site in `packages/site` with Astro and Starlight, on GitHub Pages. The site makes its review and decision pages from `docs/`. **Why:** One source for each document, and live demos of the engine next to the text.

## AD-27: Cycles iterate to a stable value

**Question:** How does an epoch evaluate a cycle? **Decision:** The epoch orders the strongly connected components (Tarjan). The members of a cycle evaluate again until they are stable, up to 100 rounds. **Why:** With Kahn's algorithm, a reader of a cycle could evaluate before the cycle (R-32). A spreadsheet also iterates a circular reference with a limit.

## AD-28: Ownership is explicit

**Question:** Which container owns a node? **Decision:** Only the container that a write names with `own`, or the container that made the node (an expansion, an instance). A shared node is not owned. A container that drops an owned node removes it. **Why:** Ownership by the first container that took a node left orphans after a slot change. Also, a removal could remove a node that the user made (R-46).

## AD-29: Bound cells stay bound

**Question:** How does `updateClass` know that a cell has a binding? **Decision:** The biblo records the bound cells of each instance. **Why:** A comparison of expressions cannot tell a binding from a default with the same value (R-47).

## AD-30: Traits with prime fingerprints

**Question:** How does a view apply to each class with a structure, for example each class with the cells `x` and `y`? **Decision:** A trait gives methods to each class with a set of cells. Each cell and each typed cell gets a unique prime. A trait applies when its fingerprint divides the fingerprint of the class, and only the most specific traits count. A method that two of them give is ambiguous: no trait gives it, and the viewer shows the ambiguity. The traits are between the root of the extends chain and the other classes of the chain.

**Why:** The extends chain gives one parent to a class, but a view belongs to a structure. With divisibility, the order of the cells does not matter, and an ambiguity is explicit and not silent.

## AD-31: The targets op

**Question:** How does a custom `deref` stay reactive? **Decision:** `NodeOps` gets a fourth op, `targets`: the nodes that a read goes through, and its terminal node. The engine seats each reader on them, and the order of an epoch uses them too. A class with its own `deref` gives its own `targets`. **Why:** The engine followed the default slots for the seats. A `deref` that read another node (an alias) missed each change of that node.

## AD-32: Summaries are class methods

**Question:** How does a view abstract an instance to its boundary? **Decision:** A class can have a `summary` method next to `render`. It is an expression with the same builder and the same render context. `Top` gives a generic summary: the class name and a brief text of the dehydrated value. A leaf gives its render as its summary, thus it does not collapse.

**Why:** A summary that is a method is data. The type graph shows it, a person edits it, the extends chain resolves it, and a trait can give it. A separate summary language is a second builder.

## AD-33: A view policy and levels

**Question:** Which instances show their summary? **Decision:** `splay` takes a view policy: `isExpanded(id, level)` and `setExpanded`. The level of an instance is the number of collapsible instances above it. `viewPolicy(levels, overrides)` expands each level below `levels`, and the choices of a person have precedence. The `frame` of the kit wraps each collapsible instance, for example with a disclosure control.

**Why:** A level that counts only collapsible instances is a level of detail, not a depth of the tree. A pair or a leaf does not use a level. Without a policy, `splay` renders each full view, thus the old callers see no change.

## AD-34: The formula language

**Question:** How does a person read and write an expression without its JSON form? **Decision:** `formatExpr` and `parseExpr` give a text form of the IR: JSON literals, dotted paths, calls, and infix ops with three levels of precedence. A name that is not plain goes in backticks. For each valid expression, the parse of its format gives it again. **Why:** The tree view is exact but long, and a one-line formula is the natural summary of an op application. The text form maps one to one to the IR, thus it is the same builder, not a new language.

## AD-35: Undo replays a record of actions

**Question:** How does the viewer undo an action? **Decision:** The session records each action that changes the model. Undo builds the model again and replays the record without the last action. The IDs are deterministic, thus a replay gives the same IDs, and the choices of the level of detail stay. The record is also the saved session (in the browser, and as a file).

**Why:** An inverse for each action needs knowledge of each layer. A replay needs only determinism, and it tests that determinism at each undo.

## AD-36: The data view writes back

**Question:** What does an edit in the data view do? **Decision:** It changes the item. A class with a `value` cell or a hydrate method gets the dehydrated data again (`rehydrate`). A class without them dehydrates to its cells, thus each field goes back to its cell. A user class also gets the new value as the default of its cell.

**Why:** The data view shows the dehydrated value, thus hydrate is its inverse. `rehydrate` keeps the ID and the class of the item, and it keeps the children that do not come from the value. An edit goes directly to its twin: the instance of the item at the same place, with the same value. This applies to a value, an add, a removal, a move and a replacement. Thus the classes of the item stay.

## AD-37: A card renames a user class

**Question:** What does a new name in a class card do? **Decision:** For a user class, `renameClass` renames the class, its subclasses, its typed cells and its live instances. A standard class keeps its name, because the kits dispatch to it. A name in use is refused. **Why:** The rename was the last edit of a card that the viewer refused.

## AD-38: A drag does not move the layout

**Question:** Where does a person drop a class? **Decision:** On a container. An empty container shows a drop zone, because it has no other area. A container with children is itself the target: a drag marks it with an outline, and its add menu is in its corner. The add menu is the path of the keyboard.

**Why:** A drop zone in each container made the views long. A zone that appears at the start of a drag moves the layout under the pointer.

## AD-39: The children of a container

**Question:** How does a person remove a child or change its place? **Decision:** Each child of an editable container has controls: move it earlier, move it later, and remove it. The last child also has the add menu of its container. The controls are an overlay at the corner of the child, and they show on a hover or a focus. The session records `delete` and `move` like each other action.

**Why:** The viewer could add a child, but it could not take one back. An overlay takes no width from the layout, thus a card at the full level stays inside its panel.

## AD-40: Checkpoints for undo

**Question:** How does undo stay fast in a long session? **Decision:** The node layer gives `forkStore`, and the class layer gives `forkBiblo`: independent copies with the same counters. After each 25 recorded actions, the session keeps a copy of its model. Undo copies the nearest checkpoint and replays only the actions after it. Undo removes the checkpoints after the new end of the record.

**Why:** A full replay took 0.3 seconds after 300 actions. The expressions, the values and the classes are immutable, thus a copy shares them, and a copy of the model costs a few milliseconds. A test compares each undo from a checkpoint with a replay from the start.

## AD-41: A saved session names each instance by its place

**Question:** How does a saved session apply to a later version of the viewer? **Decision:** Each recorded action keeps the place of its instance from before the action. A place is a root, the positions of the children from the root, and the class of the instance. A root is the entry of a class in the type graph, a canvas item, its data view, the search box or the type graph.

A restore finds the instance of each place, and it refuses a place whose instance has another class. The first action that does not apply stops the replay, and the actions before it stay. A saved session of version 1 has no places, thus it applies only to the same initial model.

**Why:** An ID depends on the number of instances before it. A new atom or a new standard class changes each later ID. Thus a record of IDs applied to the wrong instances, or the viewer refused it. Without the places, the autosave of each person was lost at a change of the model. An autosave that does not load in full stays under another key, and the page offers a download.

## AD-42: The viewer on each browser and on a touch screen

**Question:** How does the viewer work without a drag, and in each browser? **Decision:** The canvas has an add menu of the classes. A tap gives the focus to a child of a container, thus its controls show. A coarse pointer gets controls of at least 28 pixels, and they go below their child. The page keeps the class of its own drag, and a drop reads it before the drag data. The browser tests run in Chromium, Firefox and WebKit, and on a phone with WebKit and a phone with Chromium.

**Why:** A touch screen has no hover, and most touch browsers start no drag. WebKit keeps only the standard types of the drag data, thus a drop in WebKit found no class.

## AD-43: An import is one step of the record

**Question:** How does an import keep the session from before it? **Decision:** An import adds a reset and the actions of the file to the record. Each action of the file is joined to the step before it. Undo and redo take a full step, thus one undo takes back the full import. The saved session keeps the steps (`joined`). An autosave at the start of the viewer replaces the record, because the record is empty.

**Why:** Before, an import replaced the record. A wrong file thus deleted the work of the person, and the next autosave deleted it from the browser too. A reset was already an action of the record, thus undo brought the old state back. An import works the same way.

## AD-44: The public API of the first release

**Question:** Which parts of the API change before the first release on npm, because a later change breaks the users? **Decision:** The packages publish as `@mark1russell7/render-<name>`, because another npm user has the scope `@render`. The `value` of a public `Node` is read only, and a `splash` op writes it through a `SplashTarget`. An op of `Ops` can declare the types of its parameters. The `App` of the viewer saves to the browser only with a `storageKey`. A hydration that fails throws.

**Why:** An independent review of the API before the release found these points. A writable `value` let a caller skip the propagation. A default storage key made two viewers on one page write over each other. A partial tree without an error hid the failure. The versions start at `0.1.0`, thus a later change of the API is a new minor version.

## AD-45: Expressions as coeval documents

**Question:** Which form does an expression have outside of render, for example in a store, in a file or in another language? **Decision:** The interchange form is a document of [coeval](https://github.com/mark1russell7/coeval), with the rules of its decision D12. `toDocument` writes the document of an expression, and `fromDocument` reads it. The interpreter keeps the tagged IR, and the formula language stays the text form of the IR.

**Superseded in October 2026:** AD-46 removes the tagged IR. The document is the expression, and the kernel of coeval evaluates it.

- A reference starts at `names` when an enclosing `fn` binds its first segment. Else it starts at `world`. A host finds `self` and `parent` by name, thus they are `world` paths.
- `record` and `fn` are the shared constructs. `if`, `and`, `or` and the ops of the registry, `call` included, are op applications, because D12 does not name them as constructs.
- A form that a construct cannot keep exactly stays an op application. Thus each tree of the IR has a document, and the round trip is exact.
- The root of a document is always an envelope. Thus a boundary that takes both forms can tell them apart. A literal at the root is a `lit` envelope.
- `undefined` and the numbers that JSON cannot write are the extensions `["ext", "undefined"]` and `["ext", "number"]`.
- A term with a `name` or `own` entries is not valid. A `world` path whose first step is a parameter is not valid, because render reads the parameter first.
- Each entry point that takes an expression from data also takes a document. These are `evaluate`, `addNode`, `setExpr`, the class registry and the card of a class in the viewer. A tree of the IR stays the same object.

**Why:** One document model lets a tool read, check, show and change the terms of each language with one set of code. A document that is not valid fails as a malformed tree fails: `none` with a `bad-expr` issue. Thus the interpreter stays total.

## AD-46: Expressions evaluate through the coeval kernel

**Question:** Where are the evaluator, the scope analysis and the checks of an expression? **Decision:** A coeval document is the one form of an expression in each package. The kernel of coeval evaluates it, finds its references and checks it, by its decision D13. On 2026-10-21, the owner asked for this change. The shared machinery is in coeval one time, with one set of tests. The project render keeps only its own parts: the formula language, the ops, the store of nodes and the epochs.

This decision supersedes the clause of AD-45 that keeps the tagged IR.

- The machine of render is the formula kit of the kernel with the profile of render. The truth of a value is the truth of JavaScript, and `and` and `or` give the value that decided.
- An `if` without `else` gives `undefined`. A `record` leaves out a field that fails. The nesting has a limit of 1000 documents.
- `if`, `and` and `or` are the constructs of D13. The documents of version 0.1.1 (`["ops", "if"]`, `["ops", "and"]` and `["ops", "or"]`) still evaluate.
- The kernel compiles an expression one time. A node compiles its expression at a write, and each epoch evaluates the plan.
- The store is the host thing of the root `world`, and it gives each path to its `deref` op in one call. The navigation is plain, thus a value with the shape of a reference stays a value.
- `refsOf` gives the reads of a node, `mapRefs` scopes the cells of an instance, `docEquals` compares two expressions, and `check` validates one.
- The view of a construct, for example `if` or `fn`, gets its parts from the split of the kernel (`splitParts`). Thus the view, the evaluator and the checks see the same parts.
- The tagged IR, the interpreter, `deps`, `forEachFreeRef`, `mapFreeRefs`, `exprEquals`, `toDocument` and `fromDocument` are removed.
- A failure in the body of a `fn` fails the op that calls the function. Before, the function gave `undefined`.
- A value is a literal argument of a document. Thus a drop of a value class into the arguments of a method makes a valid method.
- The formula language cannot write some constructs of the kernel, for example `let`. `formatExpr` writes `…` for such a part.

**Why:** AD-45 shared only the documents. Each language kept its own evaluator, scope walker and checks, thus the same rules had several copies and several sets of tests. With one kernel, one correction corrects each language. Three releases of the kernel came from this work:

- `0.2.2`: a host thing answers a path of keys on the quick path of a resolution.
- `0.3.0`: a profile can give `undefined` as the value of an `if` without `else`.
- `0.3.2`: a compilation without a trace is approximately two times faster.

The packages of render depend on `^0.4.0`. A host with other languages on the same version has one copy of the kernel.
