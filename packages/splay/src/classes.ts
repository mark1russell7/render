import type { ComponentClass } from "@render/biblo";
import { lit, ref, app } from "@render/dsl";

/**
 * Core component classes for the standard viewer system.
 *
 * Leaf viewers: Text, Number, Boolean
 * Composite viewers: KeyValuePair, ObjectViewer, ListView
 * Layout: VStack, HStack, Grid
 * Raw: HtmlElement
 */

// === Leaf viewers ===

export const Text: ComponentClass = {
  name: "Text",
  cells: {
    value: { expr: lit("") },
    width: { expr: app("textWidth", ref("self", "value")) },
    height: { expr: app("textHeight", ref("self", "value")) },
  },
};

export const Num: ComponentClass = {
  name: "Num",
  cells: {
    value: { expr: lit(0) },
    width: { expr: app("textWidth", app("toString", ref("self", "value"))) },
    height: { expr: app("textHeight", app("toString", ref("self", "value"))) },
  },
};

export const Bool: ComponentClass = {
  name: "Bool",
  cells: {
    value: { expr: lit(false) },
    width: { expr: app("textWidth", app("toString", ref("self", "value"))) },
    height: { expr: app("textHeight", app("toString", ref("self", "value"))) },
  },
};

// === Composite viewers ===

/**
 * KeyValuePair: two stacked viewers.
 *
 * [ key   ]
 * [       ]
 * [ value ]
 * [       ]
 *
 * Width = max of the two children's widths.
 * Height = sum of the two children's heights.
 * Both children forced to the same width (the max).
 */
export const KeyValuePair: ComponentClass = {
  name: "KeyValuePair",
  cells: {
    key: { expr: lit(undefined) },
    value: { expr: lit(undefined) },
    keyView: {
      expr: lit(undefined),
      type: "Text",
      bindings: { value: ref("parent", "key") },
    },
    valueView: {
      expr: lit(undefined),
      type: "Text",
      bindings: { value: ref("parent", "value") },
    },
    width: {
      expr: app("max",
        ref("self", "keyView", "width"),
        ref("self", "valueView", "width"),
      ),
    },
    height: {
      expr: app("+",
        ref("self", "keyView", "height"),
        ref("self", "valueView", "height"),
      ),
    },
  },
};

// === Layouts ===

/**
 * VStack: vertical list of children.
 * Width = max of children widths.
 * Height = sum of children heights.
 *
 * Variable children — layout aggregation computed in splay renderer,
 * not in reactive cells (reactive aggregation ops come later).
 */
export const VStack: ComponentClass = {
  name: "VStack",
  cells: {
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
};

/**
 * HStack: horizontal list of children.
 * Width = sum of children widths.
 * Height = max of children heights.
 */
export const HStack: ComponentClass = {
  name: "HStack",
  cells: {
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
};

/**
 * Grid: rows × cols layout.
 * Each column width = max of that column's children widths.
 * Each row height = max of that row's children heights.
 * Total width = sum of column widths. Total height = sum of row heights.
 *
 * cols cell controls column count. Children fill left-to-right, top-to-bottom.
 */
export const Grid: ComponentClass = {
  name: "Grid",
  cells: {
    cols: { expr: lit(2), default: 2 },
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
};

// === Raw ===

export const HtmlElement: ComponentClass = {
  name: "HtmlElement",
  cells: {
    tag: { expr: lit("div") },
    width: { expr: lit(0) },
    height: { expr: lit(0) },
  },
};

/** All standard classes in registration order */
export const standardClasses: readonly ComponentClass[] = [
  Text, Num, Bool, KeyValuePair, VStack, HStack, Grid, HtmlElement,
];
