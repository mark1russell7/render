# Changelog

## 0.1.1

- New: the coeval documents of the IR, the interchange form of an expression (decision D12 of coeval). `toDocument` writes the document of an expression, and `fromDocument` reads it. `fromDocument(toDocument(e))` gives `e` again, also after JSON text. (#11)
- New: `isExprDocument` checks a full document, and `asExpr` reads a document at a boundary that takes both forms. The type `ExprDocument` is the envelope of coeval. (#11)
- New: `evaluate` takes a document in place of an expression. A document that is not valid gives `none` with a `bad-expr` issue that tells the problem and its place. (#11)
- A new dependency: `@mark1russell7/coeval` `^0.1.0`. (#11)

## 0.1.0

- The first release: the IR, its static analysis, the total interpreter and the formula language.
