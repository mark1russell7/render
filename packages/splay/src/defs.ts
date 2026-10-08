import type { ComponentClass } from "@render/biblo";
import { defaultSplash, defaultFlow, defaultDeref } from "@render/node";
import { lit, ref, app } from "@render/dsl";
import type { DehydrateCtx } from "./kit.ts";

// The hydrate methods are Expr trees. Their atoms (hydrateItems, hydrateEntries) come from `hydrate` in engine.ts.

// === The dehydrate atoms: each class knows how to unwrap itself ===

const dehydrateValue = (ctx: DehydrateCtx): unknown => ctx.cells["value"];

const dehydrateList = (ctx: DehydrateCtx): unknown =>
  ctx.children.map((id) => ctx.dehydrateChild(id));

/** A `KeyValuePair` unwraps to a `[key, value]` pair. The dehydrate method of `Grid` reads the pairs. */
const dehydratePair = (ctx: DehydrateCtx): unknown => {
  const [keyId, valId] = ctx.children;
  return [
    keyId != null ? ctx.dehydrateChild(keyId) : undefined,
    valId != null ? ctx.dehydrateChild(valId) : undefined,
  ];
};

/**
 * A `Grid` makes an object from the `[key, value]` pairs of its children. A key that is a number becomes text.
 * A child that is not a pair has no field.
 */
const dehydrateEntries = (ctx: DehydrateCtx): unknown => {
  const entries: [string, unknown][] = [];
  for (const childId of ctx.children) {
    const pair = ctx.dehydrateChild(childId);
    if (Array.isArray(pair) && (typeof pair[0] === "string" || typeof pair[0] === "number")) {
      entries.push([String(pair[0]), pair[1]]);
    }
  }
  // fromEntries makes own data properties, thus a key "__proto__" does not change the prototype
  return Object.fromEntries(entries);
};

const dehydrateApp = (ctx: DehydrateCtx): unknown => {
  const exprObj = ctx.cells["value"] as { tag: "app"; op: string } | undefined;
  return {
    tag: "app",
    op: exprObj?.op ?? "?",
    args: ctx.children.map((id) => ctx.dehydrateChild(id)),
  };
};

const dehydrateCells = (ctx: DehydrateCtx): unknown => ctx.cells;

// === Top: the root of all classes. It gives the defaults of the reactive methods and of dehydrate. ===

export const Top: ComponentClass = {
  name: "Top",
  cells: {},
  methods: {
    splash: defaultSplash,
    flow: defaultFlow,
    deref: defaultDeref,
    dehydrate: dehydrateCells,
  },
};

// === The standard classes. Their render methods are Expr trees: transparent data that the type graph shows. ===
// The output layer (React, a terminal, a test) gives the view atoms, for example textView and stack.

export const Text: ComponentClass = {
  name: "Text",
  extends: "Top",
  cells: {
    value: { expr: lit("") },
  },
  methods: {
    dehydrate: dehydrateValue,
    render: app("textView",
      app("get", ref("self", "cells"), lit("value")),
      ref("self", "setCell")),
  },
};

export const Num: ComponentClass = {
  name: "Num",
  extends: "Top",
  cells: {
    value: { expr: lit(0) },
  },
  methods: {
    dehydrate: dehydrateValue,
    render: app("numView",
      app("get", ref("self", "cells"), lit("value")),
      ref("self", "setCell")),
  },
};

export const Bool: ComponentClass = {
  name: "Bool",
  extends: "Top",
  cells: {
    value: { expr: lit(false) },
  },
  methods: {
    dehydrate: dehydrateValue,
    render: app("boolView",
      app("get", ref("self", "cells"), lit("value")),
      ref("self", "setCell")),
  },
};

export const KeyValuePair: ComponentClass = {
  name: "KeyValuePair",
  extends: "Top",
  cells: {
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
  methods: {
    dehydrate: dehydratePair,
    render: app("kvp",
      ref("self", "children"),
      ref("self", "renderChild"),
      ref("self", "addChild"),
      ref("self", "readChildCells")),
  },
};

export const VStack: ComponentClass = {
  name: "VStack",
  extends: "Top",
  cells: {
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
  methods: {
    dehydrate: dehydrateList,
    hydrate: app("hydrateItems", ref("self", "value"), ref("self", "instanceId")),
    render: app("stack", lit("rv-vstack"),
      ref("self", "children"), ref("self", "renderChild"), ref("self", "addChild")),
  },
};

export const HStack: ComponentClass = {
  name: "HStack",
  extends: "Top",
  cells: {
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
  methods: {
    dehydrate: dehydrateList,
    render: app("stack", lit("rv-hstack"),
      ref("self", "children"), ref("self", "renderChild"), ref("self", "addChild")),
  },
};

export const Grid: ComponentClass = {
  name: "Grid",
  extends: "Top",
  cells: {
    cols: { expr: lit(2) },
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
  methods: {
    dehydrate: dehydrateEntries,
    hydrate: app("hydrateEntries", ref("self", "value"), ref("self", "instanceId")),
    render: app("grid",
      ref("self", "cells"),
      ref("self", "children"),
      ref("self", "renderChild"),
      ref("self", "addChild")),
  },
};

export const HtmlElement: ComponentClass = {
  name: "HtmlElement",
  extends: "Top",
  cells: {
    tag: { expr: lit("div") },
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
  methods: {
    render: app("stack", lit("rv-html"),
      ref("self", "children"), ref("self", "renderChild"), ref("self", "addChild")),
  },
};

// === The Expr classes: expression trees that render themselves ===
// The value cell holds the full Expr object, and the view atoms read its fields.

export const ExprLit: ComponentClass = {
  name: "ExprLit",
  extends: "Top",
  cells: { value: { expr: lit(undefined) } },
  methods: {
    dehydrate: dehydrateValue,
    render: app("exprLitView",
      app("get", ref("self", "cells"), lit("value")),
      ref("self", "setCell")),
  },
};

export const ExprRef: ComponentClass = {
  name: "ExprRef",
  extends: "Top",
  cells: { value: { expr: lit(undefined) } },
  methods: {
    dehydrate: dehydrateValue,
    render: app("exprRefView",
      app("get", ref("self", "cells"), lit("value")),
      ref("self", "setCell")),
  },
};

export const ExprApp: ComponentClass = {
  name: "ExprApp",
  extends: "Top",
  cells: { value: { expr: lit(undefined) } },
  methods: {
    dehydrate: dehydrateApp,
    hydrate: app("hydrateItems",
      app("get", ref("self", "value"), lit("args")),
      ref("self", "instanceId")),
    render: app("exprAppView",
      app("get", ref("self", "cells"), lit("value")),
      ref("self", "children"), ref("self", "renderChild"),
      ref("self", "setCell"), ref("self", "addChild")),
  },
};

/**
 * This function is the `classFor` that knows expressions. It sends `lit`, `ref` and `app` objects to
 * `ExprLit`, `ExprRef` and `ExprApp`, and all other values to `defaultClassFor`.
 * With it, an expression renders as a tree of ops and not as JSON.
 */
export const exprClassFor = (value: unknown): string => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj["tag"] === "lit") return "ExprLit";
    if (obj["tag"] === "ref") return "ExprRef";
    if (obj["tag"] === "app") return "ExprApp";
  }
  return defaultClassFor(value);
};

/** The standard classes, in the order of registration (`Top` first). */
export const standardClasses: readonly ComponentClass[] = [
  Top, Text, Num, Bool, KeyValuePair, VStack, HStack, Grid, HtmlElement,
  ExprLit, ExprRef, ExprApp,
];

/** This function is the default `classFor`: it gives the class name for a JavaScript value. */
export const defaultClassFor = (value: unknown): string => {
  if (typeof value === "string") return "Text";
  if (typeof value === "number") return "Num";
  if (typeof value === "boolean") return "Bool";
  if (Array.isArray(value)) return "VStack";
  if (typeof value === "object" && value !== null) return "Grid";
  return "Text";
};
