# Changelog

## 0.2.2

- The dependencies of render 0.2.2, and `@mark1russell7/coeval` `^0.6.3`. No change to the API of the viewer. (#16)

## 0.2.1

- The dependencies of render 0.2.1, and `@mark1russell7/coeval` `^0.4.3`. No change to the API of the viewer. (#14)

## 0.2.0

- Breaking: the expressions of the type graph are coeval documents. The edits of a literal, a reference, an op and a formula give documents. A value dropped into the arguments of a method is a literal argument. (#13)
- New: the atom `exprFormView` shows a construct, for example `if` or `fn`: its kind, its data and each part with its key. (#13)
- An edit of a reference keeps its root, thus a parameter of a `fn` stays a parameter. An edit of an op name gives an op application, also for the name `if`. (#13)
- The dependencies `render-dsl`, `render-node`, `render-biblo` and `render-splay` 0.2.0, and `@mark1russell7/coeval` `^0.4.0`. (#13)

## 0.1.1

- New: the card of a class in the type graph takes coeval documents in place of expressions: in a cell, in a binding and in a method. The class gets the tree of the IR of each document. (#11)
- The dependencies `render-dsl`, `render-node`, `render-biblo` and `render-splay` are 0.1.1, and `render-pack` is 0.1.1. (#11)

## 0.1.0

- The first release: the React viewer, with the type graph, the canvas, summaries, formulas, undo and saved sessions.
