# Changelog

## 0.1.1

- New: `addNode` and `setExpr` take a coeval document in place of an expression. The node keeps the tree of the IR. A document that is not valid gives `none`, as a malformed tree does. (#11)

## 0.1.0

- The first release: the reactive store, the ordered epochs and the `NodeOps` extension points.
