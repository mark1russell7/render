import { createElement, useState, useRef, useEffect } from "react";
import type { ReactNode, DragEvent } from "react";
import type { Ops } from "@render/dsl";
import {
  splayKit, defaultClassFor, standardOps,
} from "@render/splay";

// === Click-to-edit components ===

type SetCellFn = (cellName: string, value: unknown) => void;

function EditableText({ value, setCell }: { value: unknown; setCell: SetCellFn | undefined }): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const str = String(value ?? "");

  if (!setCell) {
    return createElement("span", { className: "rv-text" }, str);
  }

  if (!editing) {
    return createElement("span", {
      className: `rv-text rv-clickable${str === "" ? " rv-empty" : ""}`,
      onClick: () => { setDraft(str); setEditing(true); },
    }, str || "…");
  }

  const commit = (): void => { setCell("value", draft); setEditing(false); };

  return createElement("input", {
    ref: inputRef,
    type: "text",
    className: "rv-text rv-editing",
    value: draft,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); },
    onBlur: commit,
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") setEditing(false);
    },
  });
}

function EditableNum({ value, setCell }: { value: unknown; setCell: SetCellFn | undefined }): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const num = String(value ?? 0);

  if (!setCell) {
    return createElement("span", { className: "rv-num" }, num);
  }

  if (!editing) {
    return createElement("span", {
      className: "rv-num rv-clickable",
      onClick: () => { setDraft(num); setEditing(true); },
    }, num);
  }

  const commit = (): void => { setCell("value", Number(draft)); setEditing(false); };

  return createElement("input", {
    ref: inputRef,
    type: "number",
    className: "rv-num rv-editing",
    value: draft,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); },
    onBlur: commit,
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") setEditing(false);
    },
  });
}

// === Color hash (ported from Graph/Graph color.service) ===

const colorCache = new Map<string, string>();
let goldenState = Math.random();

const nextGolden = (): number => {
  goldenState = (goldenState + 0.618033988749895) % 1;
  return goldenState;
};

const colorForKey = (key: string): string => {
  const cached = colorCache.get(key);
  if (cached) return cached;
  const r0 = nextGolden() * 255;
  const factor = 0.14;
  const g0 = r0 * (1 + factor * (nextGolden() * 2 - 1));
  const b0 = r0 * (1 + factor * (nextGolden() * 2 - 1));
  const grey = 0.66;
  const color = `rgba(${r0 * grey},${g0 * grey},${b0 * grey},0.8)`;
  colorCache.set(key, color);
  return color;
};

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
    const keyColor = keyViewId != null ? colorForKey(keyViewId) : undefined;
    return createElement("div", { className: "rv-kvp" },
      createElement("div", {
        className: "rv-kvp-key",
        style: keyColor ? { backgroundColor: keyColor } : undefined,
      }, keyViewId != null ? render(keyViewId) : null),
      createElement("div", { className: "rv-kvp-value" },
        valueViewId != null ? render(valueViewId) : null),
    );
  },

  /**
   * stack(className, children, renderChild, addChild) → container div with children
   * Used by VStack, HStack, HtmlElement.
   */
  stack: (className: unknown, children: unknown, renderChild: unknown, _addChild: unknown) => {
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    return createElement("div", { className: String(className) },
      ...ids.map((id) => render(id)),
    );
  },

  /**
   * grid(cells, children, renderChild, addChild) → React Grid layout
   */
  grid: (cells: unknown, children: unknown, renderChild: unknown, _addChild: unknown) => {
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

  textView: (value: unknown, setCell: unknown) => {
    const str = String(value ?? "");
    if (classNames.has(str)) {
      return createElement("span", {
        className: "rv-text rv-draggable",
        draggable: true,
        onDragStart: (e: DragEvent) => { onDragStartHandler(e, str); },
      }, str);
    }
    return createElement(EditableText, {
      value,
      setCell: setCell as SetCellFn | undefined,
    });
  },

  numView: (value: unknown, setCell: unknown) =>
    createElement(EditableNum, {
      value,
      setCell: setCell as SetCellFn | undefined,
    }),

  boolView: (value: unknown, setCell: unknown) => {
    const setter = setCell as SetCellFn | undefined;
    if (setter) {
      return createElement("label", { className: "rv-bool-edit" },
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

  kvp: (children: unknown, renderChild: unknown, addChild: unknown) => {
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    const add = addChild as ((className: string) => void) | undefined;
    const [keyViewId, valueViewId] = ids;
    const keyColor = keyViewId != null ? colorForKey(keyViewId) : undefined;

    return createElement("div", { className: "rv-kvp" },
      createElement("div", {
        className: "rv-kvp-key",
        style: keyColor ? { backgroundColor: keyColor } : undefined,
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
   * stack with drop zones for VStack/HStack/HtmlElement
   */
  stack: (className: unknown, children: unknown, renderChild: unknown, addChild: unknown) => {
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    const add = addChild as ((className: string) => void) | undefined;
    return createElement("div", {
      className: String(className),
      onDragOver: add ? onDragOverHandler : undefined,
      onDrop: add ? makeOnDrop(add) : undefined,
    },
      ...ids.map((id) => render(id)),
      add ? createElement("div", { key: "__drop", className: "rv-drop-zone" }, "drop to add") : null,
    );
  },

  /**
   * grid with drop zones
   */
  grid: (cells: unknown, children: unknown, renderChild: unknown, addChild: unknown) => {
    const cellsObj = cells as Record<string, unknown>;
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    const add = addChild as ((className: string) => void) | undefined;
    const cols = typeof cellsObj["cols"] === "number" ? cellsObj["cols"] : 2;
    return createElement("div", {
      className: "rv-grid",
      style: { gridTemplateColumns: `repeat(${String(cols)}, auto)` },
      onDragOver: add ? onDragOverHandler : undefined,
      onDrop: add ? makeOnDrop(add) : undefined,
    },
      ...ids.map((id) =>
        createElement("div", { key: id, className: "rv-grid-item" }, render(id)),
      ),
      add ? createElement("div", { key: "__drop", className: "rv-drop-zone" }, "drop to add") : null,
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
