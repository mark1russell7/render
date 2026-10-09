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

**Why:** An inverse for each action, or a copy of the store, needs knowledge of each layer. A replay needs only determinism, and it tests that determinism at each undo.

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

