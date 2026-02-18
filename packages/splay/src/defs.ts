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
    render: app("element", lit("div"),
      app("props", lit("className"), lit("rv-vstack")),
      app("map", ref("self", "children"), ref("self", "renderChild"))),
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
    render: app("element", lit("div"),
      app("props", lit("className"), lit("rv-hstack")),
      app("map", ref("self", "children"), ref("self", "renderChild"))),
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
      ref("self", "renderChild")),
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
    render: app("element",
      app("if",
        app("get", ref("self", "cells"), lit("tag")),
        app("get", ref("self", "cells"), lit("tag")),
        lit("div")),
      app("props", lit("className"), lit("rv-html")),
      app("map", ref("self", "children"), ref("self", "renderChild"))),
  },
};

/** All standard classes in registration order (Top first) */
export const standardClasses: readonly ComponentClass[] = [
  Top, Text, Num, Bool, KeyValuePair, VStack, HStack, Grid, HtmlElement,
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
