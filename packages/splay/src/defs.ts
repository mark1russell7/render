import type { ComponentClass } from "@render/biblo";
import type { HydrateFn } from "./kit.js";
import { defaultSplash, defaultFlow, defaultDeref } from "@render/node";
import { lit } from "@render/dsl";

// === Hydrate functions ===

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

/**
 * Top is the root of the class hierarchy.
 * Every class implicitly extends Top.
 * It defines default methods for all system behaviors:
 *
 * - splash: write a value, return affected seats (node layer)
 * - flow:   determine what to propagate next (node layer)
 * - deref:  resolve a path from a node (node layer)
 * - hydrate: build children from a value (splay layer)
 * - render:  produce output (set per output type — React, terminal, etc.)
 *
 * Subclasses override only what they refine. The extends chain
 * resolves most-specific-wins.
 */
export const Top: ComponentClass = {
  name: "Top",
  cells: {},
  methods: {
    splash: defaultSplash,
    flow: defaultFlow,
    deref: defaultDeref,
    // hydrate: undefined — default is no-op (leaf node)
    // render: undefined — set per output type
  },
};

// === Standard classes — all extend Top ===

export const Text: ComponentClass = {
  name: "Text",
  extends: "Top",
  cells: {
    value: { expr: lit("") },
  },
};

export const Num: ComponentClass = {
  name: "Num",
  extends: "Top",
  cells: {
    value: { expr: lit(0) },
  },
};

export const Bool: ComponentClass = {
  name: "Bool",
  extends: "Top",
  cells: {
    value: { expr: lit(false) },
  },
};

export const KeyValuePair: ComponentClass = {
  name: "KeyValuePair",
  extends: "Top",
  cells: {
    width: { expr: lit(0) },
    height: { expr: lit(0) },
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
  },
};

export const HStack: ComponentClass = {
  name: "HStack",
  extends: "Top",
  cells: {
    width: { expr: lit(0) },
    height: { expr: lit(0) },
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
