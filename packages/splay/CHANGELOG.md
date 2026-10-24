# Changelog

## 0.2.0

- Breaking: an expression method is a coeval document, and the kernel evaluates it. `exprClassFor` sends each valid document to `ExprLit`, `ExprRef`, `ExprApp` or the new `ExprForm` (another construct, for example `if` or `fn`). An argument of an `ExprApp` that is a bare literal gets the class of its value. (#13)
- The ops of hydration are kept for each kit, biblo and store, thus the plans of the hydrate methods compile one time. (#13)
- The dependencies `render-dsl`, `render-node` and `render-biblo` 0.2.0, and `@mark1russell7/coeval` `^0.3.2`. (#13)

## 0.1.1

- The dependencies `render-dsl`, `render-node` and `render-biblo` are 0.1.1, thus a class that splay registers can have coeval documents. No change to the API of splay. (#11)

## 0.1.0

- The first release: hydrate, splay and dehydrate, the level of detail, the standard classes and the standard ops.
