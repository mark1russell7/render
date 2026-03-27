import type { ComponentClass } from "@render/biblo";
import type { HydrateFn } from "./kit.js";
import { defaultSplash, defaultFlow, defaultDeref } from "@render/node";
import { lit, ref, app } from "@render/dsl";

// === Hydrate functions (atoms — must be code) ===

/** Grid hydrate: create a KeyValuePair child per object entry */
const gridHydrate: HydrateFn = (ctx, value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  for (const [k, v] of Object.entries(value)) {
    const kvpId = ctx.instantiateChild("KeyValuePair", ctx.instanceId);
    ctx.hydrate(k, kvpId);
    ctx.hydrate(v, kvpId);
  }
};

/** ExprApp hydrate: hydrate each arg as a child */
const exprAppHydrate: HydrateFn = (ctx, value) => {
  if (typeof value !== "object" || value === null) return;
  const v = value as Record<string, unknown>;
  const args = v["args"];
  if (!Array.isArray(args)) return;
  for (const arg of args) ctx.hydrate(arg, ctx.instanceId);
};

/** VStack hydrate: hydrate each array item as a child */
const vstackHydrate: HydrateFn = (ctx, value) => {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    ctx.hydrate(item, ctx.instanceId);
  }
};

// === Top type — root ===

export const Top: ComponentClass = {
  name: "Top",
  cells: {},
  methods: {
    splash: defaultSplash,
    flow: defaultFlow,
    deref: defaultDeref,
  },
};

// === Standard classes — render methods are Expr trees ===
// The "element" op is provided by the output layer (React, terminal, etc.)
// These Expr trees are transparent data — visible in the type graph.

export const Text: ComponentClass = {
  name: "Text",
  extends: "Top",
  cells: {
    value: { expr: lit("") },
  },
  methods: {
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
    render: app("kvp",
      ref("self", "children"),
      ref("self", "renderChild"),
      ref("self", "addChild")),
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
    hydrate: vstackHydrate,
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
    render: app("stack", lit("rv-hstack"),
      ref("self", "children"), ref("self", "renderChild"), ref("self", "addChild")),
  },
};

export const Grid: ComponentClass = {
  name: "Grid",
  extends: "Top",
  cells: {
    cols: { expr: lit(2), default: 2 },
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
  methods: {
    hydrate: gridHydrate,
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

// === Expr classes — self-rendering expression tree nodes ===
// The "value" cell stores the ENTIRE Expr object. Render ops extract fields.

export const ExprLit: ComponentClass = {
  name: "ExprLit",
  extends: "Top",
  cells: { value: { expr: lit(undefined) } },
  methods: {
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
    hydrate: exprAppHydrate,
    render: app("exprAppView",
      app("get", ref("self", "cells"), lit("value")),
      ref("self", "children"), ref("self", "renderChild"),
      ref("self", "setCell"), ref("self", "addChild")),
  },
};

/** All standard classes in registration order (Top first) */
export const standardClasses: readonly ComponentClass[] = [
  Top, Text, Num, Bool, KeyValuePair, VStack, HStack, Grid, HtmlElement,
  ExprLit, ExprRef, ExprApp,
];

/** Default classFor: map a runtime value to a class name */
export const defaultClassFor = (value: unknown): string => {
  if (typeof value === "string") return "Text";
  if (typeof value === "number") return "Num";
  if (typeof value === "boolean") return "Bool";
  if (Array.isArray(value)) return "VStack";
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (obj["tag"] === "lit") return "ExprLit";
    if (obj["tag"] === "ref") return "ExprRef";
    if (obj["tag"] === "app") return "ExprApp";
    return "Grid";
  }
  return "Text";
};
