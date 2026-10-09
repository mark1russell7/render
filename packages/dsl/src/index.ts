export { type Lit, type Ref, type App, type Expr, lit, ref, app, record, isExpr, exprEquals, MAX_EXPR_DEPTH } from "./ir.ts";
export { type Chain, chain } from "./chain.ts";
export { type DepPath, deps } from "./deps.ts";
export { fnParams, forEachFreeRef, mapFreeRefs } from "./scope.ts";
export { type Ops, type Resolver, type EvalIssue, evaluate, objectResolver, specialForms } from "./eval.ts";
export { type ParseResult, formatExpr, parseExpr } from "./formula.ts";
