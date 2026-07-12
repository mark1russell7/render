import type { ComponentClass } from "@render/biblo";
import { defaultSplash, defaultFlow, defaultDeref } from "@render/node";
import { lit, ref, app } from "@render/dsl";

// Hydrate methods are Expr trees — the atoms (hydrateItems, hydrateEntries)
// are closure-captured in engine.ts hydrate().

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
 * Expr-aware classFor — routes { tag: "lit"|"ref"|"app" } to ExprLit/ExprRef/ExprApp.
 * Falls back to defaultClassFor for everything else.
 * Use this when you want semantic expression rendering instead of JSON.
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
  if (typeof value === "object" && value !== null) return "Grid";
  return "Text";
};
