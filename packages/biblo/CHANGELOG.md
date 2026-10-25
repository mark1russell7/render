# Changelog

## 0.2.2

- The dependencies `render-dsl` and `render-node` 0.2.2, and `@mark1russell7/coeval` `^0.6.3`. No change to the API of biblo. (#16)

## 0.2.1

- `updateClass` compares a host value of a document, for example a date, by identity (`docEquals` of coeval 0.4.3). Thus a cell with an edit keeps the edit, also when the edit has an equal date. (#14)
- The dependencies `render-dsl` and `render-node` 0.2.1, and `@mark1russell7/coeval` `^0.4.3`. (#14)

## 0.2.0

- Breaking: a class is data. Its expressions are coeval documents, and `registerClass`, `registerTrait`, `updateClass` and `instantiate` keep them as they are. `CellDef` and `ComponentClass` have no type parameter. (#13)
- An instance scopes its cells with `mapRefs` of the kernel, and `updateClass` compares the expressions with `docEquals`. (#13)
- The dependencies `render-dsl` and `render-node` 0.2.0, and `@mark1russell7/coeval` `^0.4.0`. (#13)

## 0.1.1

- New: a class from data can have coeval documents in place of expressions. `registerClass`, `registerClasses` and `updateClass` read the expression and the bindings of each cell into the IR, and each method that is a valid document. `registerTrait` reads the methods, and `instantiate` reads the bindings. A class without documents stays the same object. (#11)
- `CellDef` and `ComponentClass` have a type parameter for the form of the expressions. Its default is `Expr`, thus the types without a parameter do not change. (#11)

## 0.1.0

- The first release: the class registry, the instance store, the traits and the class-level `NodeOps`.
