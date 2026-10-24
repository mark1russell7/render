# Changelog

## 0.2.0

- Breaking: an expression is a coeval document (`Expr` is the envelope of coeval). The tagged IR (`Lit`, `Ref`, `App`) is removed. `lit`, `ref`, `app` and `record` write the canonical documents. (#13)
- Breaking: the kernel of coeval evaluates each expression (decision D13 of coeval). The interpreter, `deps`, `forEachFreeRef`, `mapFreeRefs`, `fnParams`, `exprEquals`, `MAX_EXPR_DEPTH`, `specialForms`, `toDocument`, `fromDocument`, `isExprDocument`, `asExpr` and `ExprDocument` are removed. Use `refsOf`, `mapRefs`, `check` and `docEquals` of `@mark1russell7/coeval` with `renderWorld`. (#13)
- Breaking: `if`, `and` and `or` are the constructs of the kernel. The documents of version 0.1.1 still evaluate. A failure in the body of a `fn` fails the op that calls the function. (#13)
- New: `machineOf`, `plannerOf`, `renderWorld`, `NO_VALUE`, `checkExpr`, `evaluateIn`, `resolverThing`, `issuesOf`, `isLiteral`, `literalOf` and `opOf`. (#13)
- New: `partsOf` splits a document into the parts of its kind, with `splitParts` of the kernel. `isExprPart` and `checkExpr(doc, { names: "any" })` accept a part that reads a parameter of a `fn` around it. (#13)
- `parseExpr` gives a document, and `formatExpr` reads one. A part that the text cannot write, for example a `let`, gives `…`. (#13)
- The dependency `@mark1russell7/coeval` is `^0.4.0`. (#13)

## 0.1.1

- New: the coeval documents of the IR, the interchange form of an expression (decision D12 of coeval). `toDocument` writes the document of an expression, and `fromDocument` reads it. `fromDocument(toDocument(e))` gives `e` again, also after JSON text. (#11)
- New: `isExprDocument` checks a full document, and `asExpr` reads a document at a boundary that takes both forms. The type `ExprDocument` is the envelope of coeval. (#11)
- New: `evaluate` takes a document in place of an expression. A document that is not valid gives `none` with a `bad-expr` issue that tells the problem and its place. (#11)
- A new dependency: `@mark1russell7/coeval` `^0.1.0`. (#11)

## 0.1.0

- The first release: the IR, its static analysis, the total interpreter and the formula language.
