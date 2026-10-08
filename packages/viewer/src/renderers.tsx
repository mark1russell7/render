import { createElement, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import type { EvalIssue, Ops } from "@render/dsl";
import type { RenderCtx } from "@render/splay";
import { exprClassFor, splayKit, standardOps, textOf } from "@render/splay";

type SetCellFn = (cellName: string, value: unknown) => void;
type RenderChildFn = (id: string) => ReactNode;
type AddChildFn = (className: string) => void;

/** The MIME type of a class name in a drag. */
export const CLASS_DRAG_TYPE = "text/x-classname";

// === Inline edit ===

/** The result of the parse of a draft: a value to write, or `null` to keep the old value. */
type Parse = (draft: string) => { readonly value: unknown } | null;

/**
 * An inline edit: a click shows an input. Enter or a blur writes the draft, and Escape cancels.
 * A draft without a change writes nothing.
 * The blur is the one place that commits, thus the commit occurs one time. Enter and Escape only end the focus.
 * A draft that the parse refuses changes nothing.
 */
function InlineEdit(props: {
  readonly className: string;
  readonly display: string;
  readonly draft: string;
  readonly parse: Parse;
  readonly setCell: SetCellFn;
  readonly inputType?: string;
  readonly empty?: boolean;
}): ReactNode {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    const start = (): void => { setDraft(props.draft); };
    return createElement("span", {
      className: `${props.className} rv-clickable${props.empty === true ? " rv-empty" : ""}`,
      role: "button",
      tabIndex: 0,
      title: "click to edit",
      onClick: start,
      onKeyDown: (e: { key: string }) => { if (e.key === "Enter") start(); },
    }, props.display);
  }

  return createElement("input", {
    autoFocus: true,
    type: props.inputType ?? "text",
    className: `${props.className} rv-editing`,
    "aria-label": "edit value",
    value: draft,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); },
    onFocus: (e: { currentTarget: HTMLInputElement }) => { e.currentTarget.select(); },
    onBlur: (e: { currentTarget: HTMLInputElement }) => {
      // Escape cancels, and a draft without a change writes nothing: a click in and out is not an edit
      const unchanged = e.currentTarget.dataset["cancel"] === "true" || e.currentTarget.value === props.draft;
      setDraft(null);
      const parsed = unchanged ? null : props.parse(e.currentTarget.value);
      if (parsed !== null) props.setCell("value", parsed.value);
    },
    onKeyDown: (e: { key: string; currentTarget: HTMLInputElement; preventDefault: () => void }) => {
      if (e.key === "Enter") e.currentTarget.blur();
      if (e.key === "Escape") {
        e.preventDefault();
        e.currentTarget.dataset["cancel"] = "true";
        e.currentTarget.blur();
      }
    },
  });
}

const parseText: Parse = (draft) => ({ value: draft });

/** A number edit writes only a finite number. An empty draft, or a draft that is not a number, keeps the old value. */
const parseNumber: Parse = (draft) => {
  const n = Number(draft);
  return draft.trim() === "" || !Number.isFinite(n) ? null : { value: n };
};

/** The literals that JSON cannot write. The text of each one reads back as the same value. */
const SPECIAL_LITERALS: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ["undefined", undefined],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
]);

/** A literal edit reads JSON, or a special literal. A draft that is neither is a string. */
const parseLiteral: Parse = (draft) => {
  const trimmed = draft.trim();
  if (SPECIAL_LITERALS.has(trimmed)) return { value: { tag: "lit", value: SPECIAL_LITERALS.get(trimmed) } };
  try {
    return { value: { tag: "lit", value: JSON.parse(draft) as unknown } };
  } catch {
    return { value: { tag: "lit", value: draft } };
  }
};

/** A reference edit reads a path with dots between the segments. An empty segment is not valid. */
const parseRef: Parse = (draft) => {
  const path = draft.split(".").map((s) => s.trim());
  return path.some((s) => s === "") ? null : { value: { tag: "ref", path } };
};

/** This function gives the text of a literal. A special literal gives its own name, and not the `null` of JSON. */
const literalText = (v: unknown): string => {
  if (v === undefined) return "undefined";
  if (typeof v === "number" && !Number.isFinite(v)) return String(v);
  return JSON.stringify(v) ?? textOf(v);
};

// === Colors of the keys ===

/** The FNV-1a hash of a text. */
const hash = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** This function gives the color of a key text. The hue comes from a hash of the text, thus a key has the same color in each session. */
const colorForKey = (key: string): string => `hsla(${String(hash(key) % 360)}, 38%, 38%, 0.85)`;

const keyContent = (keyViewId: string, readChildCells: unknown): string => {
  if (typeof readChildCells === "function") {
    const v = (readChildCells as (id: string) => Record<string, unknown>)(keyViewId)["value"];
    if (v !== undefined) return textOf(v);
  }
  return keyViewId;
};

// === Drag and drop ===

const onDragOver = (e: DragEvent): void => {
  if (e.dataTransfer.types.includes(CLASS_DRAG_TYPE)) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
};

const dropOn = (add: AddChildFn) => (e: DragEvent): void => {
  const className = e.dataTransfer.getData(CLASS_DRAG_TYPE);
  if (!className) return;
  e.preventDefault();
  e.stopPropagation();
  add(className);
};

const dropProps = (add: AddChildFn | undefined): Record<string, unknown> =>
  add ? { onDragOver, onDrop: dropOn(add) } : {};

const dropZone = (add: AddChildFn | undefined, label: string, small = false): ReactNode =>
  add ? createElement("div", { key: "__drop", className: `rv-drop-zone${small ? " rv-drop-zone-sm" : ""}` }, label) : null;

const ids = (children: unknown): readonly string[] => (Array.isArray(children) ? (children as string[]) : []);
const renderer = (renderChild: unknown): RenderChildFn =>
  typeof renderChild === "function" ? (renderChild as RenderChildFn) : () => null;
const setter = (setCell: unknown): SetCellFn | undefined =>
  typeof setCell === "function" ? (setCell as SetCellFn) : undefined;
const adder = (addChild: unknown): AddChildFn | undefined =>
  typeof addChild === "function" ? (addChild as AddChildFn) : undefined;
const field = (obj: unknown, key: string): unknown =>
  obj !== null && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;

// === The view atoms ===

/**
 * The view atoms of the viewer. They are the bridge from `Expr` render methods to React, and the only
 * opaque part of a render. Each atom is editable when the render gives `setCell` or `addChild`, and read-only
 * otherwise. Thus one kit serves the editable panels and the read-only data views.
 */
export const viewerOps: Ops = {
  ...standardOps,

  /** This atom makes a React element: `element(tag, props, ...children)`. */
  element: (tag, props, ...children) =>
    createElement(textOf(tag), props !== null && typeof props === "object" ? props : null, ...(children.flat() as ReactNode[])),

  /** This atom renders a text. */
  textView: (value, setCell) => {
    const text = textOf(value);
    const set = setter(setCell);
    if (!set) return createElement("span", { className: "rv-text" }, text);
    return createElement(InlineEdit, { className: "rv-text", display: text === "" ? "…" : text, draft: text, parse: parseText, setCell: set, empty: text === "" });
  },

  /** This atom renders the name of a class as a chip that a person can drag to the canvas. `Top` is abstract, thus not draggable. */
  classChip: (name) => {
    const text = textOf(name);
    if (text === "Top") return createElement("span", { className: "rv-text rv-class-name", title: "the abstract root class" }, text);
    return createElement("span", {
      className: "rv-text rv-class-name rv-draggable",
      draggable: true,
      title: `drag ${text} to the canvas`,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.setData(CLASS_DRAG_TYPE, text);
        e.dataTransfer.effectAllowed = "copy";
      },
    }, text);
  },

  /** This atom renders a read-only label. */
  labelView: (text) => createElement("span", { className: "rv-text rv-label" }, textOf(text)),

  /** This atom renders a number. */
  numView: (value, setCell) => {
    const text = textOf(value ?? 0);
    const set = setter(setCell);
    if (!set) return createElement("span", { className: "rv-num" }, text);
    return createElement(InlineEdit, { className: "rv-num", display: text, draft: text, parse: parseNumber, setCell: set, inputType: "number" });
  },

  /** This atom renders a boolean. */
  boolView: (value, setCell) => {
    const set = setter(setCell);
    const text = value === true ? "true" : "false";
    if (!set) return createElement("span", { className: "rv-bool" }, text);
    return createElement("label", { className: "rv-bool-edit" },
      createElement("input", {
        type: "checkbox",
        checked: value === true,
        onChange: (e: { target: { checked: boolean } }) => { set("value", e.target.checked); },
      }),
      text,
    );
  },

  /** This atom renders a key and a value. The color of the key comes from its text. */
  kvp: (children, renderChild, addChild, readChildCells) => {
    const [keyId, valueId] = ids(children);
    const render = renderer(renderChild);
    const add = adder(addChild);
    const color = keyId === undefined ? undefined : colorForKey(keyContent(keyId, readChildCells));
    return createElement("div", { className: "rv-kvp" },
      createElement("div", {
        className: "rv-kvp-key",
        style: color === undefined ? undefined : { backgroundColor: color },
        ...(keyId === undefined ? dropProps(add) : {}),
      }, keyId === undefined ? dropZone(add, "drop key", true) : render(keyId)),
      createElement("div", {
        className: "rv-kvp-value",
        ...(valueId === undefined ? dropProps(add) : {}),
      }, valueId === undefined ? dropZone(add, "drop value", true) : render(valueId)),
    );
  },

  /** This atom renders children in a stack. `className` selects the direction. */
  stack: (className, children, renderChild, addChild) => {
    const render = renderer(renderChild);
    const add = adder(addChild);
    return createElement("div", { className: textOf(className), ...dropProps(add) },
      ...ids(children).map((id) => render(id)),
      dropZone(add, "drop to add"),
    );
  },

  /** This atom renders children in a grid. The cell `cols` gives the number of columns. */
  grid: (cells, children, renderChild, addChild) => {
    const render = renderer(renderChild);
    const add = adder(addChild);
    const cols = field(cells, "cols");
    return createElement("div", {
      className: "rv-grid",
      style: { gridTemplateColumns: `repeat(${String(typeof cols === "number" && cols > 0 ? cols : 2)}, auto)` },
      ...dropProps(add),
    },
      ...ids(children).map((id) => createElement("div", { key: id, className: "rv-grid-item" }, render(id))),
      dropZone(add, "drop to add"),
    );
  },

  /** This atom renders a literal expression. */
  exprLitView: (expr, setCell) => {
    const text = literalText(field(expr, "value"));
    const set = setter(setCell);
    if (!set) return createElement("span", { className: "rv-expr-lit" }, text);
    return createElement(InlineEdit, { className: "rv-expr-lit", display: text, draft: text, parse: parseLiteral, setCell: set });
  },

  /** This atom renders a reference expression as a dotted path. */
  exprRefView: (expr, setCell) => {
    const path = field(expr, "path");
    const text = Array.isArray(path) ? path.map(String).join(".") : "";
    const set = setter(setCell);
    if (!set) return createElement("span", { className: "rv-expr-ref" }, text);
    return createElement(InlineEdit, { className: "rv-expr-ref", display: text, draft: text, parse: parseRef, setCell: set });
  },

  /** This atom renders an op application: the op name, then its arguments. */
  exprAppView: (expr, children, renderChild, setCell, addChild) => {
    const op = textOf(field(expr, "op") ?? "?");
    const render = renderer(renderChild);
    const set = setter(setCell);
    const add = adder(addChild);
    const opView = set
      ? createElement(InlineEdit, {
          className: "rv-expr-op",
          display: `${op}(`,
          draft: op,
          parse: (draft: string) => (draft.trim() === "" ? null : { value: { tag: "app", op: draft.trim(), args: field(expr, "args") ?? [] } }),
          setCell: set,
        })
      : createElement("span", { className: "rv-expr-op" }, `${op}(`);
    return createElement("div", { className: "rv-expr-app" },
      opView,
      createElement("div", { className: "rv-expr-args", ...dropProps(add) }, ...ids(children).map((id) => render(id))),
      createElement("span", { className: "rv-expr-op" }, ")"),
    );
  },
};

const issueText = (issue: EvalIssue): string =>
  [issue.code, issue.op, issue.path?.join("."), issue.message === undefined ? undefined : `(${issue.message})`]
    .filter((part) => part !== undefined)
    .join(": ");

/**
 * The fallback render. It renders a class without a render method, and a failed `Expr` render. For a failure,
 * it shows the causes (`ctx.issues`), thus an error is visible and not a blank.
 */
export const fallbackRender = (ctx: RenderCtx<ReactNode>): ReactNode => {
  if (ctx.issues !== undefined && ctx.issues.length > 0) {
    return createElement("div", { className: "rv-unknown rv-error", role: "alert" },
      createElement("em", null, `${ctx.classRef}: the render failed`),
      ...ctx.issues.slice(0, 4).map((issue, i) => createElement("div", { key: i, className: "rv-error-issue" }, issueText(issue))),
    );
  }
  return createElement("div", { className: "rv-unknown" }, createElement("em", null, ctx.classRef), ": ", JSON.stringify(ctx.cells));
};

/** The kit of the viewer. */
export const viewerKit = splayKit<ReactNode>(exprClassFor, viewerOps, fallbackRender);
