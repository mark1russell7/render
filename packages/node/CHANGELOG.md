# Changelog

## 0.2.1

- The dependency `render-dsl` 0.2.1, and `@mark1russell7/coeval` `^0.4.3`. No change to the API of node. (#14)

## 0.2.0

- Breaking: the expression of a node is a coeval document, and the kernel of coeval evaluates it. A node compiles its expression one time at a write, and each epoch evaluates the plan. `addNode` and `setExpr` take an `Expr` (a document). (#13)
- The store is the host thing of the root `world`: the kernel gives each path to the `deref` op in one call. A store value with the shape of a reference stays a value. (#13)
- The reads of a node are its free `world` references (`refsOf` of the kernel). New: `readsOf` and the type `DepPath`. The expression of a container is a `record` construct. (#13)
- The dependencies `render-dsl` 0.2.0 and `@mark1russell7/coeval` `^0.4.0`. (#13)

## 0.1.1

- New: `addNode` and `setExpr` take a coeval document in place of an expression. The node keeps the tree of the IR. A document that is not valid gives `none`, as a malformed tree does. (#11)

## 0.1.0

- The first release: the reactive store, the ordered epochs and the `NodeOps` extension points.
