# Architecture decisions

This log records each architecture decision of render: the question, the decision and the reason. AD-1 to AD-15 come from the July roadmap. The full July text is in [`archive/2026-07/DECISIONS.md`](./archive/2026-07/DECISIONS.md). AD-16 and later come from the review of October 2026 ([`REVIEW.md`](./REVIEW.md)).

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

String class names are not a bottleneck. The engine adds prime polymorphism only when a real need comes.

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

**Question:** What does an edit in the data view do? **Decision:** The data view does not edit. **Why:** The old data view edited a copy, and the next toggle lost the edit (R-30). A write back to the instance needs a rule for each class.

## AD-25: Invalid card edits are refused

**Question:** What happens when an edit of a class card gives an invalid class? **Decision:** The session refuses it, shows the card of the current class again, and shows a notice with the reason. A new class name is refused too. **Why:** An invalid render method stopped the full viewer (R-31), and a rename needs updates of subclasses and instances.

## AD-26: The site

**Question:** How does render publish its documents? **Decision:** A site in `packages/site` with Astro and Starlight on GitHub Pages. The site makes its review and decision pages from `docs/`. **Why:** One source for each document, and live demos of the engine next to the text.
