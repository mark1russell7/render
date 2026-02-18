import { createElement } from "react";
import type { ReactNode, DragEvent } from "react";
import type { Ops } from "@render/dsl";
import {
  splayKit, defaultClassFor, standardOps,
} from "@render/splay";

// === Drag helpers (used by React-specific ops) ===

const classNames = new Set(["Top", "Text", "Num", "Bool", "KeyValuePair", "VStack", "HStack", "Grid", "HtmlElement"]);

const onDragStartHandler = (e: DragEvent, className: string): void => {
  e.dataTransfer.setData("text/x-classname", className);
  e.dataTransfer.effectAllowed = "copy";
};

const onDragOverHandler = (e: DragEvent): void => {
  if (e.dataTransfer.types.includes("text/x-classname")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
};

const makeOnDrop = (addChild: ((className: string) => void) | undefined) =>
  (e: DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const className = e.dataTransfer.getData("text/x-classname");
    if (className && addChild) {
      addChild(className);
    }
  };

// === React-specific ops — these are the output atoms ===

/**
 * React ops: output-specific atoms that produce ReactNodes.
 * These are blackboxed — they're the bridge between Expr and React.
 * Everything above them (the Expr trees on classes) is transparent data.
 */
export const reactOps: Ops = {
  ...standardOps,

  /**
   * element(tag, propsObj, ...children) → React.createElement
   * The fundamental React atom.
   */
  element: (tag: unknown, propsObj: unknown, ...children: unknown[]) => {
    const flatChildren = children.flat() as ReactNode[];
    return createElement(
      String(tag),
      propsObj as Record<string, unknown> | null,
      ...flatChildren,
    );
  },

  /**
   * kvp(children, renderChild, addChild) → React KVP layout
   * Renders first child as key, second as value.
   */
  kvp: (children: unknown, renderChild: unknown, _addChild: unknown) => {
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    const [keyViewId, valueViewId] = ids;
    return createElement("div", { className: "rv-kvp" },
      createElement("div", { className: "rv-kvp-key" },
        keyViewId != null ? render(keyViewId) : null),
      createElement("div", { className: "rv-kvp-value" },
        valueViewId != null ? render(valueViewId) : null),
    );
  },

  /**
   * grid(cells, children, renderChild) → React Grid layout
   */
  grid: (cells: unknown, children: unknown, renderChild: unknown) => {
    const cellsObj = cells as Record<string, unknown>;
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    const cols = typeof cellsObj["cols"] === "number" ? cellsObj["cols"] : 2;
    return createElement("div", {
      className: "rv-grid",
      style: { gridTemplateColumns: `repeat(${String(cols)}, auto)` },
    },
      ...ids.map((id) =>
        createElement("div", { key: id, className: "rv-grid-item" }, render(id)),
      ),
    );
  },

  /**
   * textView(value, setCell) → Text element, draggable if class name
   */
  textView: (value: unknown, _setCell: unknown) => {
    const str = String(value ?? "");
    if (classNames.has(str)) {
      return createElement("span", {
        className: "rv-text rv-draggable",
        draggable: true,
        onDragStart: (e: DragEvent) => { onDragStartHandler(e, str); },
      }, str);
    }
    return createElement("span", { className: "rv-text" }, str);
  },

  /** numView(value, setCell) → read-only number display */
  numView: (value: unknown, _setCell: unknown) =>
    createElement("span", { className: "rv-num" }, String(value ?? 0)),

  /** boolView(value, setCell) → read-only boolean display */
  boolView: (value: unknown, _setCell: unknown) =>
    createElement("span", { className: "rv-bool" }, value ? "true" : "false"),
};

/**
 * Editable ops — extend reactOps with interactive input variants.
 * These are used when the canvas provides mutation callbacks.
 */
export const editableReactOps: Ops = {
  ...reactOps,

  /**
   * textView — editable text input when setCell is provided
   */
  textView: (value: unknown, setCell: unknown) => {
    const str = String(value ?? "");
    // Class names are always draggable, never editable
    if (classNames.has(str)) {
      return createElement("span", {
        className: "rv-text rv-draggable",
        draggable: true,
        onDragStart: (e: DragEvent) => { onDragStartHandler(e, str); },
      }, str);
    }
    const setter = setCell as ((cellName: string, value: unknown) => void) | undefined;
    if (setter) {
      return createElement("input", {
        type: "text",
        className: "rv-text rv-editable",
        value: str,
        onChange: (e: { target: { value: string } }) => { setter("value", e.target.value); },
      });
    }
    return createElement("span", { className: "rv-text" }, str);
  },

  /**
   * numView — editable number input when setCell is provided
   */
  numView: (value: unknown, setCell: unknown) => {
    const setter = setCell as ((cellName: string, value: unknown) => void) | undefined;
    if (setter) {
      return createElement("input", {
        type: "number",
        className: "rv-num rv-editable",
        value: Number(value ?? 0),
        onChange: (e: { target: { value: string } }) => { setter("value", Number(e.target.value)); },
      });
    }
    return createElement("span", { className: "rv-num" }, String(value ?? 0));
  },

  /**
   * boolView — editable checkbox when setCell is provided
   */
  boolView: (value: unknown, setCell: unknown) => {
    const setter = setCell as ((cellName: string, value: unknown) => void) | undefined;
    if (setter) {
      return createElement("label", { className: "rv-bool rv-editable" },
        createElement("input", {
          type: "checkbox",
          checked: Boolean(value),
          onChange: (e: { target: { checked: boolean } }) => { setter("value", e.target.checked); },
        }),
        value ? "true" : "false",
      );
    }
    return createElement("span", { className: "rv-bool" }, value ? "true" : "false");
  },

  /**
   * kvp with drop zones for empty key/value slots
   */
  kvp: (children: unknown, renderChild: unknown, addChild: unknown) => {
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    const add = addChild as ((className: string) => void) | undefined;
    const [keyViewId, valueViewId] = ids;

    return createElement("div", { className: "rv-kvp" },
      createElement("div", {
        className: "rv-kvp-key",
        onDragOver: !keyViewId && add ? onDragOverHandler : undefined,
        onDrop: !keyViewId && add ? makeOnDrop(add) : undefined,
      },
        keyViewId != null
          ? render(keyViewId)
          : add
            ? createElement("div", { className: "rv-drop-zone rv-drop-zone-sm" }, "drop key")
            : null),
      createElement("div", {
        className: "rv-kvp-value",
        onDragOver: !valueViewId && add ? onDragOverHandler : undefined,
        onDrop: !valueViewId && add ? makeOnDrop(add) : undefined,
      },
        valueViewId != null
          ? render(valueViewId)
          : add
            ? createElement("div", { className: "rv-drop-zone rv-drop-zone-sm" }, "drop value")
            : null),
    );
  },

  /**
   * vstack/grid with drop zones
   */
  element: (tag: unknown, propsObj: unknown, ...children: unknown[]) => {
    const flatChildren = children.flat() as ReactNode[];
    return createElement(
      String(tag),
      propsObj as Record<string, unknown> | null,
      ...flatChildren,
    );
  },
};

/** Kit for read-only rendering (type graph) */
export const reactKit = splayKit<ReactNode>(
  defaultClassFor,
  reactOps,
  (ctx) => createElement("div", { className: "rv-unknown" },
    createElement("em", null, ctx.classRef), ": ", JSON.stringify(ctx.cells)),
);

/** Kit for editable rendering (canvas) */
export const editableKit = splayKit<ReactNode>(
  defaultClassFor,
  editableReactOps,
  (ctx) => createElement("div", { className: "rv-unknown" },
    createElement("em", null, ctx.classRef), ": ", JSON.stringify(ctx.cells)),
);
