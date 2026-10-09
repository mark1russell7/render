import type { ComponentClass, Trait } from "@render/biblo";
import { defaultSplash, defaultFlow, defaultDeref, defaultTargets } from "@render/node";
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

// === The summaries: the boundary of an instance, built with the same builder as the render ===
// The output layer gives the view atoms of the summaries, for example summaryView and formulaView.

/** This expression reads a cell of the instance: `get(self.cells, name)`. */
const cell = (name: string) => app("get", ref("self", "cells"), lit(name));

/** The generic summary: the class name and a short text of the dehydrated value, for example `Grid { a, b }`. */
const genericSummary = app("summaryView", ref("self", "classRef"), app("brief", app("call", ref("self", "dehydrate"))));

// === Top: the root of all classes. It gives the defaults of the reactive methods, of dehydrate and of summary. ===

export const Top: ComponentClass = {
  name: "Top",
  cells: {},
  methods: {
    splash: defaultSplash,
    flow: defaultFlow,
    deref: defaultDeref,
    targets: defaultTargets,
    dehydrate: dehydrateCells,
    summary: genericSummary,
  },
};

// === The standard classes. Their render methods are Expr trees: transparent data that the type graph shows. ===
// The output layer (React, a terminal, a test) gives the view atoms, for example textView and stack.
// A leaf gives its render as its summary: it is already one line, thus it does not collapse.

const textRender = app("textView", cell("value"), ref("self", "setCell"));

export const Text: ComponentClass = {
  name: "Text",
  extends: "Top",
  cells: {
    value: { expr: lit("") },
  },
  methods: {
    dehydrate: dehydrateValue,
    render: textRender,
    summary: textRender,
  },
};

const numRender = app("numView", cell("value"), ref("self", "setCell"));

export const Num: ComponentClass = {
  name: "Num",
  extends: "Top",
  cells: {
    value: { expr: lit(0) },
  },
  methods: {
    dehydrate: dehydrateValue,
    render: numRender,
    summary: numRender,
  },
};

const boolRender = app("boolView", cell("value"), ref("self", "setCell"));

export const Bool: ComponentClass = {
  name: "Bool",
  extends: "Top",
  cells: {
    value: { expr: lit(false) },
  },
  methods: {
    dehydrate: dehydrateValue,
    render: boolRender,
    summary: boolRender,
  },
};

// A pair does not collapse: its value collapses, and its key stays visible.
const kvpRender = app("kvp",
  ref("self", "children"),
  ref("self", "renderChild"),
  ref("self", "addChild"),
  ref("self", "readChildCells"));

export const KeyValuePair: ComponentClass = {
  name: "KeyValuePair",
  extends: "Top",
  cells: {
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
  methods: {
    dehydrate: dehydratePair,
    render: kvpRender,
    summary: kvpRender,
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
    summary: app("summaryView",
      app("concat", lit("<"), app("str", cell("tag")), lit(">")),
      app("brief", ref("self", "children"))),
  },
};

// === The Expr classes: expression trees that render themselves ===
// The value cell holds the full Expr object, and the view atoms read its fields.

const exprLitRender = app("exprLitView", cell("value"), ref("self", "setCell"));

export const ExprLit: ComponentClass = {
  name: "ExprLit",
  extends: "Top",
  // The default is a valid expression, thus a new ExprLit (a drop into the arguments of an op) is valid too
  cells: { value: { expr: lit(lit(0)) } },
  methods: {
    dehydrate: dehydrateValue,
    render: exprLitRender,
    summary: exprLitRender,
  },
};

const exprRefRender = app("exprRefView", cell("value"), ref("self", "setCell"));

export const ExprRef: ComponentClass = {
  name: "ExprRef",
  extends: "Top",
  cells: { value: { expr: lit(ref("self", "cells")) } },
  methods: {
    dehydrate: dehydrateValue,
    render: exprRefRender,
    summary: exprRefRender,
  },
};

export const ExprApp: ComponentClass = {
  name: "ExprApp",
  extends: "Top",
  cells: { value: { expr: lit(app("array")) } },
  methods: {
    dehydrate: dehydrateApp,
    hydrate: app("hydrateItems",
      app("get", ref("self", "value"), lit("args")),
      ref("self", "instanceId")),
    render: app("exprAppView",
      cell("value"),
      ref("self", "children"), ref("self", "renderChild"),
      ref("self", "setCell"), ref("self", "addChild")),
    // The summary is the formula of the tree on one line. A host with `replace` makes it editable as text.
    summary: app("formulaView", app("call", ref("self", "dehydrate")), ref("self", "replace")),
  },
};

/**
 * This function is the `classFor` that knows expressions. It sends `lit`, `ref` and `app` objects with the
 * exact shape of an expression node to `ExprLit`, `ExprRef` and `ExprApp`. It sends all other values to `defaultClassFor`.
 * With it, an expression renders as a tree of ops and not as JSON.
 */
export const exprClassFor = (value: unknown): string => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).toSorted().join(",");
    // Only the exact shape of an expression node: other data with a tag field renders as data, without a loss
    if (obj["tag"] === "lit" && keys === "tag,value") return "ExprLit";
    if (obj["tag"] === "ref" && keys === "path,tag" && Array.isArray(obj["path"]) && obj["path"].every((p) => typeof p === "string")) return "ExprRef";
    if (obj["tag"] === "app" && keys === "args,op,tag" && typeof obj["op"] === "string" && Array.isArray(obj["args"])) return "ExprApp";
  }
  return defaultClassFor(value);
};

/** The standard classes, in the order of registration (`Top` first). */
export const standardClasses: readonly ComponentClass[] = [
  Top, Text, Num, Bool, KeyValuePair, VStack, HStack, Grid, HtmlElement,
  ExprLit, ExprRef, ExprApp,
];

// === The standard traits: summaries for each class with a structure, whatever its extends chain ===

/** The trait of a point: a class with the cells `x` and `y` shows them as a pair, for example `(3, 4)`. */
export const PointTrait: Trait = {
  name: "Point",
  requires: ["x", "y"],
  methods: {
    summary: app("summaryView", ref("self", "classRef"),
      app("concat", lit("("), app("str", cell("x")), lit(", "), app("str", cell("y")), lit(")"))),
  },
};

/** The trait of a labeled class: a class with the cell `label` shows its label. */
export const LabeledTrait: Trait = {
  name: "Labeled",
  requires: ["label"],
  methods: {
    summary: app("summaryView", ref("self", "classRef"), app("str", cell("label"))),
  },
};

/** The standard traits. A class with the cells `x`, `y` and `label` gets an ambiguous summary, thus the summary of `Top`. */
export const standardTraits: readonly Trait[] = [PointTrait, LabeledTrait];

/** This function is the default `classFor`: it gives the class name for a JavaScript value. */
export const defaultClassFor = (value: unknown): string => {
  if (typeof value === "string") return "Text";
  if (typeof value === "number") return "Num";
  if (typeof value === "boolean") return "Bool";
  if (Array.isArray(value)) return "VStack";
  if (typeof value === "object" && value !== null) return "Grid";
  return "Text";
};
