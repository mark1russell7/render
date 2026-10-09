import { createContext, createElement, useContext, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import type { EvalIssue, Ops } from "@render/dsl";
import { formatExpr, isExpr, parseExpr } from "@render/dsl";
import type { RenderCtx } from "@render/splay";
import { briefOf, exprClassFor, splayKit, standardOps, textOf } from "@render/splay";

type SetCellFn = (cellName: string, value: unknown) => void;
type RenderChildFn = (id: string) => ReactNode;
type AddChildFn = (className: string) => void;

/** The MIME type of a class name in a drag. */
export const CLASS_DRAG_TYPE = "text/x-classname";

/** The name of the DOM event of a class chip that a person adds to the canvas with the keyboard. Its detail is the class name. */
export const ADD_CLASS_EVENT = "rv-add-class";

/** The names of the classes that a person can add, for the add menus. The app gives them. */
export const ClassNamesContext = createContext<readonly string[]>([]);

/** The actions on a child instance: remove it, or move it to a position. The app gives them. */
export type ChildActions = {
  readonly remove: (instanceId: string) => void;
  readonly move: (instanceId: string, index: number) => void;
};

/** The actions on the children of an editable container. Without them, a child has no controls. */
export const ChildActionsContext = createContext<ChildActions | null>(null);

// === Inline edit ===

/** The result of the parse of a draft: a value to write, `null` to keep the old value, or the reason of a refusal. */
type Parsed = { readonly value: unknown } | { readonly error: string } | null;
type Parse = (draft: string) => Parsed;

/**
 * An inline edit: a click shows an input. Enter or a blur writes the draft, and Escape cancels.
 * A draft without a change writes nothing.
 * The blur is the one place that commits, thus the commit occurs one time. Enter and Escape only end the focus.
 *
 * A draft that the parse refuses changes nothing. When the parse gives a reason, Enter shows it and the input stays.
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
  const [error, setError] = useState<string | null>(null);

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

  const input = createElement("input", {
    autoFocus: true,
    type: props.inputType ?? "text",
    className: `${props.className} rv-editing`,
    "aria-label": "edit value",
    "aria-invalid": error !== null,
    title: error ?? undefined,
    size: Math.max(4, Math.min(80, draft.length + 1)),
    value: draft,
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      setError(null);
    },
    onFocus: (e: { currentTarget: HTMLInputElement }) => { e.currentTarget.select(); },
    onBlur: (e: { currentTarget: HTMLInputElement }) => {
      // Escape cancels, and a draft without a change writes nothing: a click in and out is not an edit
      const unchanged = e.currentTarget.dataset["cancel"] === "true" || e.currentTarget.value === props.draft;
      setDraft(null);
      setError(null);
      const parsed = unchanged ? null : props.parse(e.currentTarget.value);
      if (parsed !== null && "value" in parsed) props.setCell("value", parsed.value);
    },
    onKeyDown: (e: { key: string; currentTarget: HTMLInputElement; preventDefault: () => void }) => {
      if (e.key === "Enter") {
        const parsed = e.currentTarget.value === props.draft ? null : props.parse(e.currentTarget.value);
        if (parsed !== null && "error" in parsed) {
          setError(parsed.error);
          return;
        }
        e.currentTarget.blur();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.currentTarget.dataset["cancel"] = "true";
        e.currentTarget.blur();
      }
    },
  });
  if (error === null) return input;
  return createElement("span", { className: "rv-edit-error-wrap" },
    input,
    createElement("span", { className: "rv-edit-error", role: "alert" }, error));
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

/** A formula edit reads the formula language. A syntax error gives its reason and its position. */
export const parseFormula: Parse = (draft) => {
  const result = parseExpr(draft);
  return result.ok ? { value: result.expr } : { error: `${result.message} (at ${String(result.offset)})` };
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

// === Drag and drop, and the add menu ===

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

/**
 * The add menu of a container: a select of the class names. It is the keyboard path to `addChild`, next to
 * the drop. The menu shows on a hover or a focus of its container.
 */
function AddMenu({ add }: { readonly add: AddChildFn }): ReactNode {
  const names = useContext(ClassNamesContext);
  if (names.length === 0) return null;
  return createElement("select", {
    className: "rv-add",
    "aria-label": "add a child",
    title: "add a child of a class",
    value: "",
    onChange: (e: { target: { value: string } }) => { if (e.target.value !== "") add(e.target.value); },
  },
    createElement("option", { value: "" }, "+"),
    ...names.map((n) => createElement("option", { key: n, value: n }, n)));
}

/** This function makes one control of a child: a small button with a label for assistive technology. */
const childTool = (label: string, symbol: string, disabled: boolean, act: () => void): ReactNode =>
  createElement("button", {
    type: "button",
    className: "rv-child-tool",
    "aria-label": label,
    title: label,
    disabled,
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      act();
    },
  }, symbol);

/**
 * A child of an editable container, with its controls: move it earlier, move it later, and remove it. The last
 * child also has the add menu of its container. The controls show on a hover or a focus of the child. They stay
 * in the tab order.
 */
function ChildItem(props: {
  readonly id: string;
  readonly index: number;
  readonly count: number;
  readonly horizontal: boolean;
  readonly add: AddChildFn | undefined;
  readonly children?: ReactNode;
}): ReactNode {
  const actions = useContext(ChildActionsContext);
  if (!actions) return props.children;
  const { id, index, count, horizontal } = props;
  return createElement("div", { className: "rv-child" },
    createElement("div", { className: "rv-child-body" }, props.children),
    createElement("span", { className: "rv-child-tools" },
      childTool("move child earlier", horizontal ? "◂" : "▴", index === 0, () => { actions.move(id, index - 1); }),
      childTool("move child later", horizontal ? "▸" : "▾", index >= count - 1, () => { actions.move(id, index + 1); }),
      childTool("remove child", "×", false, () => { actions.remove(id); }),
      props.add === undefined ? null : createElement(AddMenu, { add: props.add })));
}

/** This function renders the children of a container. An editable container gives each child its controls. */
const childViews = (children: unknown, render: RenderChildFn, add: AddChildFn | undefined, horizontal = false): ReactNode[] => {
  const list = ids(children);
  return list.map((id, index) => (add
    ? createElement(ChildItem, { key: id, id, index, count: list.length, horizontal, add: index === list.length - 1 ? add : undefined }, render(id))
    : render(id)));
};

/**
 * The add controls of an empty container: a drop zone, because the container has no other area for a drop, and
 * the add menu. A container with children is itself the drop target, and its last child has the add menu. Thus
 * a drag does not move the layout.
 */
const addControls = (add: AddChildFn | undefined, label: string, empty: boolean): ReactNode => {
  if (!add || !empty) return null;
  return createElement("div", { key: "__add", className: "rv-add-row" },
    createElement("div", { className: "rv-drop-zone" }, label),
    createElement(AddMenu, { add }));
};

/** The hole of a pair without a key or a value. It is always visible, because the pair is not complete. */
const hole = (add: AddChildFn | undefined, label: string): ReactNode =>
  add
    ? createElement("div", { className: "rv-hole" },
        createElement("div", { className: "rv-drop-zone rv-drop-zone-sm" }, label),
        createElement(AddMenu, { add }))
    : null;

const ids = (children: unknown): readonly string[] => (Array.isArray(children) ? (children as string[]) : []);
const renderer = (renderChild: unknown): RenderChildFn =>
  typeof renderChild === "function" ? (renderChild as RenderChildFn) : () => null;
const setter = (setCell: unknown): SetCellFn | undefined =>
  typeof setCell === "function" ? (setCell as SetCellFn) : undefined;
const adder = (addChild: unknown): AddChildFn | undefined =>
  typeof addChild === "function" ? (addChild as AddChildFn) : undefined;
const field = (obj: unknown, key: string): unknown =>
  obj !== null && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
const names = (list: unknown): string[] => (Array.isArray(list) ? list.map(textOf) : []);

/** One part of the boundary of a class: a label and a list of names. An empty list shows nothing. */
const boundaryPart = (label: string, list: unknown): ReactNode => {
  const items = names(list);
  return items.length === 0
    ? null
    : createElement("span", { className: "rv-boundary-part" },
        createElement("span", { className: "rv-boundary-label" }, label),
        " ",
        items.join(", "));
};

// === The view atoms ===

/**
 * The view atoms of the viewer. They are the bridge from `Expr` render methods to React, and the only
 * opaque part of a render. Each atom is editable when the render gives `setCell`, `addChild` or `replace`, and
 * read-only otherwise. Thus one kit serves the editable panels and the read-only views.
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

  /**
   * This atom renders the name of a class as a chip that a person can drag to the canvas, with the names of its
   * traits. Enter on the chip adds the class to the canvas. `Top` is abstract, thus not draggable.
   */
  classChip: (name, traits) => {
    const text = textOf(name);
    const badges = names(traits).map((t) => createElement("span", { key: t, className: "rv-trait", title: `the trait ${t} applies` }, t));
    if (text === "Top") return createElement("span", { className: "rv-text rv-class-name", title: "the abstract root class" }, text, ...badges);
    return createElement("span", {
      className: "rv-text rv-class-name rv-draggable",
      draggable: true,
      tabIndex: 0,
      title: `drag ${text} to the canvas, or press Enter`,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.setData(CLASS_DRAG_TYPE, text);
        e.dataTransfer.effectAllowed = "copy";
      },
      onKeyDown: (e: { key: string; currentTarget: HTMLElement }) => {
        if (e.key === "Enter") e.currentTarget.dispatchEvent(new CustomEvent(ADD_CLASS_EVENT, { bubbles: true, detail: text }));
      },
    }, text, ...badges);
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
      }, keyId === undefined ? hole(add, "drop key") : render(keyId)),
      createElement("div", {
        className: "rv-kvp-value",
        ...(valueId === undefined ? dropProps(add) : {}),
      }, valueId === undefined ? hole(add, "drop value") : render(valueId)),
    );
  },

  /** This atom renders children in a stack. `className` selects the direction. */
  stack: (className, children, renderChild, addChild) => {
    const render = renderer(renderChild);
    const add = adder(addChild);
    return createElement("div", { className: `${textOf(className)} rv-container`, ...dropProps(add) },
      ...childViews(children, render, add, textOf(className) === "rv-hstack"),
      addControls(add, "drop to add", ids(children).length === 0),
    );
  },

  /** This atom renders children in a grid. The cell `cols` gives the number of columns. */
  grid: (cells, children, renderChild, addChild) => {
    const render = renderer(renderChild);
    const add = adder(addChild);
    const cols = field(cells, "cols");
    return createElement("div", {
      className: "rv-grid rv-container",
      style: { gridTemplateColumns: `repeat(${String(typeof cols === "number" && cols > 0 ? cols : 2)}, auto)` },
      ...dropProps(add),
    },
      ...childViews(children, render, add).map((view, i) => createElement("div", { key: ids(children)[i], className: "rv-grid-item" }, view)),
      addControls(add, "drop to add", ids(children).length === 0),
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
      createElement("div", { className: "rv-expr-args rv-container", ...dropProps(add) },
        ...childViews(children, render, add),
        addControls(add, "drop an argument", ids(children).length === 0)),
      createElement("span", { className: "rv-expr-op" }, ")"),
    );
  },

  // === The summary atoms ===

  /** This atom renders a summary: a class name and a short text, for example `Grid { a, b }`. */
  summaryView: (label, text) =>
    createElement("span", { className: "rv-summary" },
      createElement("span", { className: "rv-summary-class" }, textOf(label)),
      " ",
      createElement("span", { className: "rv-summary-text" }, textOf(text))),

  /** This atom renders an expression as its formula on one line. With `replace`, a click edits the formula as text. */
  formulaView: (expr, replace) => {
    const text = isExpr(expr) ? formatExpr(expr) : briefOf(expr);
    if (typeof replace !== "function") return createElement("code", { className: "rv-formula" }, text);
    const rep = replace as (value: unknown) => void;
    return createElement(InlineEdit, {
      className: "rv-formula",
      display: text,
      draft: text,
      parse: parseFormula,
      setCell: (_cell: string, value: unknown) => { rep(value); },
    });
  },

  /** This atom renders the boundary of a class: its parent, the names of its cells and of its methods. */
  boundaryView: (ext, cells, methods) =>
    createElement("span", { className: "rv-boundary" },
      typeof ext === "string" && ext !== ""
        ? createElement("span", { className: "rv-boundary-part" },
            createElement("span", { className: "rv-boundary-label" }, "extends"), " ", ext)
        : null,
      boundaryPart("cells", cells),
      boundaryPart("methods", methods)),
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

/**
 * The frame of each collapsible instance: a disclosure control before its output. The control expands a summary
 * to the full view, and collapses the full view to the summary. Without a toggle, the output stays as it is.
 */
export const lodFrame = (ctx: RenderCtx<ReactNode>, output: ReactNode): ReactNode => {
  const toggle = ctx.toggle;
  if (!toggle) return output;
  const expanded = ctx.detail === "full";
  return createElement("div", { className: `rv-lod rv-lod-${ctx.detail}`, "data-lod": ctx.instanceId },
    createElement("button", {
      type: "button",
      className: "rv-disclosure",
      "aria-expanded": expanded,
      "aria-label": `${expanded ? "collapse" : "expand"} ${ctx.classRef}`,
      title: expanded ? "show the summary" : "show the full view",
      onClick: (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        toggle();
      },
    }, expanded ? "▾" : "▸"),
    createElement("div", { className: "rv-lod-body" }, output));
};

/** The kit of the viewer. */
export const viewerKit = splayKit<ReactNode>(exprClassFor, viewerOps, fallbackRender, lodFrame);
