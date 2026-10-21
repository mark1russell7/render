# Changelog

## 0.1.1

- New: a class from data can have coeval documents in place of expressions. `registerClass`, `registerClasses` and `updateClass` read the expression and the bindings of each cell into the IR, and each method that is a valid document. `registerTrait` reads the methods, and `instantiate` reads the bindings. A class without documents stays the same object. (#11)
- `CellDef` and `ComponentClass` have a type parameter for the form of the expressions. Its default is `Expr`, thus the types without a parameter do not change. (#11)

## 0.1.0

- The first release: the class registry, the instance store, the traits and the class-level `NodeOps`.
