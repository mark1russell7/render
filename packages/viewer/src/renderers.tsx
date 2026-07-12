import { createElement, useState, useRef, useEffect } from "react";
import type { ReactNode, DragEvent } from "react";
import type { Ops } from "@render/dsl";
import {
  splayKit, exprClassFor, standardOps, standardClasses,
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
      if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
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
      if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
    },
  });
}

// === Expr click-to-edit components ===

function EditableExprLit({ exprObj, setCell }: { exprObj: unknown; setCell: SetCellFn | undefined }): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const expr = exprObj as { tag: "lit"; value: unknown } | null;
  const val = expr?.value;
  const display = val === undefined ? "undefined" : JSON.stringify(val);

  if (!setCell) {
    return createElement("span", { className: "rv-expr-lit" }, display);
  }

  if (!editing) {
    return createElement("span", {
      className: "rv-expr-lit rv-clickable",
      onClick: () => { setDraft(display); setEditing(true); },
    }, display);
  }

  const commit = (): void => {
    let parsed: unknown;
    try { parsed = JSON.parse(draft); } catch { parsed = draft; }
    setCell("value", { tag: "lit", value: parsed });
    setEditing(false);
  };

  return createElement("input", {
    ref: inputRef,
    type: "text",
    className: "rv-expr-lit rv-editing",
    value: draft,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); },
    onBlur: commit,
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
    },
  });
}

function EditableExprRef({ exprObj, setCell }: { exprObj: unknown; setCell: SetCellFn | undefined }): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const expr = exprObj as { tag: "ref"; path: readonly string[] } | null;
  const pathStr = expr?.path?.join(".") ?? "";

  if (!setCell) {
    return createElement("span", { className: "rv-expr-ref" }, pathStr);
  }

  if (!editing) {
    return createElement("span", {
      className: "rv-expr-ref rv-clickable",
      onClick: () => { setDraft(pathStr); setEditing(true); },
    }, pathStr);
  }

  const commit = (): void => {
    setCell("value", { tag: "ref", path: draft.split(".") });
    setEditing(false);
  };

  return createElement("input", {
    ref: inputRef,
    type: "text",
    className: "rv-expr-ref rv-editing",
    value: draft,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); },
    onBlur: commit,
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
    },
  });
}

function EditableExprOp({ exprObj, setCell }: { exprObj: unknown; setCell: SetCellFn | undefined }): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const expr = exprObj as { tag: "app"; op: string } | null;
  const op = expr?.op ?? "?";

  if (!setCell) {
    return createElement("span", { className: "rv-expr-op" }, `${op}(`);
  }

  if (!editing) {
    return createElement("span", {
      className: "rv-expr-op rv-clickable",
      onClick: () => { setDraft(op); setEditing(true); },
    }, `${op}(`);
  }

  const commit = (): void => {
    setCell("value", { tag: "app", ...expr, op: draft });
    setEditing(false);
  };

  return createElement("span", { className: "rv-expr-op" },
    createElement("input", {
      ref: inputRef,
      type: "text",
      className: "rv-expr-op rv-editing",
      value: draft,
      onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); },
      onBlur: commit,
      onKeyDown: (e: { key: string; preventDefault: () => void }) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
      },
    }),
    "(",
  );
}

// === Color hash (ported from Graph/Graph color.service) ===
// Golden ratio approach — persisted to localStorage so same key = same color across sessions.

const STORAGE_KEY = "rv-color-cache";
const COLOR_CACHE_MAX = 512;

const loadColorCache = (): Map<string, string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Map(JSON.parse(raw) as [string, string][]);
  } catch { /* ignore */ }
  return new Map();
};

const colorCache = loadColorCache();
let goldenState = Math.random();

const nextGolden = (): number => {
  goldenState = (goldenState + 0.618033988749895) % 1;
  return goldenState;
};

const persistCache = (): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...colorCache]));
  } catch { /* ignore */ }
};

/**
 * Color for a CONTENT key (e.g. the key text of a KVP) — stable across
 * sessions and rebuilds because the key is content, not an instance id.
 * LRU-capped so localStorage can't grow without bound.
 */
const colorForKey = (key: string): string => {
  const cached = colorCache.get(key);
  if (cached) {
    // refresh LRU position
    colorCache.delete(key);
    colorCache.set(key, cached);
    return cached;
  }
  const r0 = nextGolden() * 255;
  const factor = 0.14;
  const g0 = r0 * (1 + factor * (nextGolden() * 2 - 1));
  const b0 = r0 * (1 + factor * (nextGolden() * 2 - 1));
  const grey = 0.66;
  const color = `rgba(${r0 * grey},${g0 * grey},${b0 * grey},0.8)`;
  colorCache.set(key, color);
  while (colorCache.size > COLOR_CACHE_MAX) {
    const oldest = colorCache.keys().next().value;
    if (oldest === undefined) break;
    colorCache.delete(oldest);
  }
  persistCache();
  return color;
};

type ReadChildCellsFn = (childId: string) => Record<string, unknown>;

/** Stable content key for a KVP's key child: its value cell if readable */
const kvpKeyContent = (keyViewId: string, readChildCells: unknown): string => {
  if (typeof readChildCells === "function") {
    const cells = (readChildCells as ReadChildCellsFn)(keyViewId);
    const v = cells["value"];
    if (v !== undefined) return String(v);
  }
  return keyViewId;
};

// === Drag helpers (used by React-specific ops) ===

/**
 * Names that render as draggable class chips. Seeded with the standard
 * classes; the App syncs it from the live registry whenever classes
 * change, so user-created classes are draggable too (AD-11).
 */
const draggableClassNames = new Set(standardClasses.map(c => c.name));

export const setDraggableClassNames = (names: Iterable<string>): void => {
  draggableClassNames.clear();
  for (const n of names) draggableClassNames.add(n);
  draggableClassNames.delete("Top"); // abstract root — not instantiable UI
};

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
   * kvp(children, renderChild, addChild, readChildCells) → React KVP layout
   * Renders first child as key, second as value.
   */
  kvp: (children: unknown, renderChild: unknown, _addChild: unknown, readChildCells?: unknown) => {
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    const [keyViewId, valueViewId] = ids;
    const keyColor = keyViewId != null
      ? colorForKey(kvpKeyContent(keyViewId, readChildCells))
      : undefined;
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
    if (draggableClassNames.has(str)) {
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

  /** exprLitView(exprObj, setCell) → display literal value */
  exprLitView: (exprObj: unknown, _setCell: unknown) => {
    const expr = exprObj as { tag: "lit"; value: unknown } | null;
    const val = expr?.value;
    const display = val === undefined ? "undefined" : JSON.stringify(val);
    return createElement("span", { className: "rv-expr-lit" }, display);
  },

  /** exprRefView(exprObj, setCell) → display ref path */
  exprRefView: (exprObj: unknown, _setCell: unknown) => {
    const expr = exprObj as { tag: "ref"; path: readonly string[] } | null;
    return createElement("span", { className: "rv-expr-ref" }, expr?.path?.join(".") ?? "");
  },

  /** exprAppView(exprObj, children, renderChild, setCell, addChild) → display op(args) */
  exprAppView: (exprObj: unknown, children: unknown, renderChild: unknown, _setCell: unknown, _addChild: unknown) => {
    const expr = exprObj as { tag: "app"; op: string } | null;
    const op = expr?.op ?? "?";
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    return createElement("div", { className: "rv-expr-app" },
      createElement("span", { className: "rv-expr-op" }, `${op}(`),
      createElement("div", { className: "rv-expr-args" },
        ...ids.map(id => render(id)),
      ),
      createElement("span", { className: "rv-expr-op" }, ")"),
    );
  },
};

/**
 * Editable ops — extend reactOps with interactive input variants.
 * These are used when the canvas provides mutation callbacks.
 */
export const editableReactOps: Ops = {
  ...reactOps,

  textView: (value: unknown, setCell: unknown) => {
    const str = String(value ?? "");
    if (draggableClassNames.has(str)) {
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

  kvp: (children: unknown, renderChild: unknown, addChild: unknown, readChildCells?: unknown) => {
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    const add = addChild as ((className: string) => void) | undefined;
    const [keyViewId, valueViewId] = ids;
    const keyColor = keyViewId != null
      ? colorForKey(kvpKeyContent(keyViewId, readChildCells))
      : undefined;

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

  exprLitView: (exprObj: unknown, setCell: unknown) =>
    createElement(EditableExprLit, {
      exprObj,
      setCell: setCell as SetCellFn | undefined,
    }),

  exprRefView: (exprObj: unknown, setCell: unknown) =>
    createElement(EditableExprRef, {
      exprObj,
      setCell: setCell as SetCellFn | undefined,
    }),

  exprAppView: (exprObj: unknown, children: unknown, renderChild: unknown, setCell: unknown, addChild: unknown) => {
    const ids = children as string[];
    const render = renderChild as (id: string) => ReactNode;
    const add = addChild as ((className: string) => void) | undefined;
    return createElement("div", { className: "rv-expr-app" },
      createElement(EditableExprOp, {
        exprObj,
        setCell: setCell as SetCellFn | undefined,
      }),
      createElement("div", {
        className: "rv-expr-args",
        onDragOver: add ? onDragOverHandler : undefined,
        onDrop: add ? makeOnDrop(add) : undefined,
      },
        ...ids.map(id => render(id)),
      ),
      createElement("span", { className: "rv-expr-op" }, ")"),
    );
  },
};

/**
 * Fallback renderer: shown for classes without a render method AND for
 * Expr renders that failed — in which case ctx.issues says why
 * (unknown op, missing path, thrown op). Errors are visible, not blank.
 */
const fallbackRender = (ctx: {
  classRef: string;
  cells: Readonly<Record<string, unknown>>;
  issues?: readonly { code: string; op?: string; path?: readonly string[]; message?: string }[] | undefined;
}): ReactNode => {
  if (ctx.issues && ctx.issues.length > 0) {
    return createElement("div", { className: "rv-unknown rv-error" },
      createElement("em", null, `${ctx.classRef} render failed`),
      ...ctx.issues.slice(0, 4).map((issue, i) =>
        createElement("div", { key: i, className: "rv-error-issue" },
          `${issue.code}${issue.op ? `: ${issue.op}` : ""}${issue.path ? `: ${issue.path.join(".")}` : ""}${issue.message ? ` (${issue.message})` : ""}`,
        ),
      ),
    );
  }
  return createElement("div", { className: "rv-unknown" },
    createElement("em", null, ctx.classRef), ": ", JSON.stringify(ctx.cells));
};

/** Kit for read-only rendering (type graph) */
export const reactKit = splayKit<ReactNode>(
  exprClassFor,
  reactOps,
  fallbackRender,
);

/** Kit for editable rendering (canvas) */
export const editableKit = splayKit<ReactNode>(
  exprClassFor,
  editableReactOps,
  fallbackRender,
);
