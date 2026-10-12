import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import type { SplayCache } from "@mark1russell7/render-splay";
import { splay } from "@mark1russell7/render-splay";
import { ViewerSession } from "./session.ts";
import type { Panel } from "./session.ts";
import {
  ADD_CLASS_EVENT, ChildActionsContext, ClassNamesContext, endClassDrag, isClassDrag, takeDraggedClass, viewerKit, viewerOps,
} from "./renderers.tsx";
import type { ChildActions } from "./renderers.tsx";
import { PackedLayout } from "./PackedLayout.tsx";
import type { PackedItem } from "./PackedLayout.tsx";

/** The time of the flash of the reactivity proof, in milliseconds. */
const FLASH_MS = 600;

/** The delay of the autosave after a change, in milliseconds. */
const SAVE_DELAY_MS = 300;

/** The key of the theme in the local storage. */
const THEME_KEY = "render-viewer-theme";

/** The default key of the autosave in the local storage. */
export const SESSION_KEY = "render-viewer-session";

/**
 * The suffix of the key of a kept session. An autosave that does not load in full stays under this key, thus
 * the next autosave does not delete it. The person downloads it or discards it.
 */
export const KEPT_SUFFIX = ".kept";

/** The levels of detail that the select of a panel offers. The last one shows each level. */
const LEVELS: readonly [number, string][] = [[0, "0"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [1000, "all"]];

type Theme = "dark" | "light";

/** The local storage can be missing or blocked, thus each access is in a try block. */
const storage = {
  get: (key: string): string | null => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string): void => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // A blocked storage only loses the autosave
    }
  },
  remove: (key: string): void => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // A blocked storage has nothing to remove
    }
  },
};

/** This function gives a text to the person as a JSON file. */
const download = (name: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const initialTheme = (): Theme => {
  const saved = storage.get(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
};

/** This function tells if a keyboard event comes from a field, where the browser owns undo. */
const inField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** The select of the level of detail of a panel. */
function LevelSelect({ session, panel }: { readonly session: ViewerSession; readonly panel: Panel }): ReactNode {
  return (
    <label className="level-select" title="the number of levels that show their full view">
      detail
      <select
        aria-label={`level of detail of the ${panel === "types" ? "type graph" : "canvas"}`}
        value={String(session.level(panel))}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => { session.setLevel(panel, Number(e.target.value)); }}
      >
        {LEVELS.map(([n, label]) => <option key={n} value={String(n)}>{label}</option>)}
      </select>
    </label>
  );
}

/**
 * The viewer: the type graph (biblo) on the left and the canvas on the right.
 * The session holds all state. This component only renders it, with the splay engine and the view atoms.
 * With a `storageKey` and without a given session, the viewer saves its session in the local storage under
 * that key, and it restores it. Without a `storageKey`, the viewer saves nothing.
 */
export function App({ session: given, storageKey = null }: {
  readonly session?: ViewerSession;
  readonly storageKey?: string | null;
}): ReactNode {
  const keptKey = given === undefined && storageKey !== null ? storageKey + KEPT_SUFFIX : null;
  const [session] = useState(() => {
    const s = given ?? new ViewerSession(viewerOps);
    const raw = given === undefined && storageKey !== null ? storage.get(storageKey) : null;
    if (raw !== null && keptKey !== null) {
      let saved: unknown = null;
      try {
        saved = JSON.parse(raw) as unknown;
      } catch {
        // A damaged autosave is not a session, thus the restore refuses it
      }
      // An autosave that does not load in full stays. A kept session from before stays too: it is the older full record.
      if (s.restore(saved) !== "complete" && storage.get(keptKey) === null) storage.set(keptKey, raw);
    }
    return s;
  });
  const [kept, setKept] = useState(() => (keptKey === null ? null : storage.get(keptKey)));
  useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [childActions] = useState<ChildActions>(() => ({ remove: session.removeChild, move: session.moveChild }));
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { b, store } = session;
  const cache = session.cache as SplayCache<ReactNode>;
  const flash = session.flash;

  useEffect(() => {
    if (flash.size === 0) return;
    const timer = setTimeout(() => { session.clearFlash(); }, FLASH_MS);
    return () => { clearTimeout(timer); };
  }, [session, flash]);

  // The autosave: the record of the actions, a short time after the last change
  useEffect(() => {
    if (given !== undefined || storageKey === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The text of the last write. A change that does not change the session, for example the end of a flash, writes nothing.
    let last = storage.get(storageKey);
    const off = session.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const text = JSON.stringify(session.save());
        if (text === last) return;
        last = text;
        storage.set(storageKey, text);
      }, SAVE_DELAY_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [session, given, storageKey]);

  useEffect(() => { storage.set(THEME_KEY, theme); }, [theme]);

  // Undo and redo from the keyboard, but not in a field: a field has its own undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || inField(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        session.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        session.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [session]);

  // Enter on a class chip adds the class to the canvas
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onAdd = (e: Event): void => {
      const name = (e as CustomEvent<unknown>).detail;
      if (typeof name === "string") session.dropClass(name);
    };
    root.addEventListener(ADD_CLASS_EVENT, onAdd);
    return () => { root.removeEventListener(ADD_CLASS_EVENT, onAdd); };
  }, [session]);

  const onCanvasDragOver = useCallback((e: DragEvent) => {
    if (isClassDrag(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onCanvasDrop = useCallback((e: DragEvent) => {
    const className = takeDraggedClass(e);
    if (!className) return;
    e.preventDefault();
    session.dropClass(className);
  }, [session]);

  const exportSession = (): void => { download("render-session.json", JSON.stringify(session.save(), null, 2)); };

  const discardKept = (): void => {
    if (keptKey !== null) storage.remove(keptKey);
    setKept(null);
  };

  const importSession = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // An import is one step of the record, thus undo brings the old session back
    try {
      session.open(JSON.parse(await file.text()) as unknown);
    } catch {
      session.open(null);
    }
  };

  const render = (id: string, panel: Panel, editable: boolean): ReactNode =>
    splay(viewerKit, b, store, id, {
      mutate: editable ? session.editCell : undefined,
      addChild: editable ? session.addChild : undefined,
      replace: editable ? session.replace : undefined,
      cache,
      view: session.view(panel),
    });

  const searchBox = render(session.searchId, "types", true);
  const cards: PackedItem[] = [];
  for (const [name, card] of session.cards()) cards.push({ id: name, node: render(card, "types", true) });

  const epoch = session.epoch;
  const notice = session.notice;

  return (
    <ClassNamesContext value={session.classNames()}>
      <ChildActionsContext value={childActions}>
      <div
        ref={rootRef}
        className={`app${dragging ? " rv-dragging" : ""}`}
        data-theme={theme}
        onDragStart={(e: DragEvent) => { if (isClassDrag(e)) setDragging(true); }}
        onDragEnd={() => {
          setDragging(false);
          endClassDrag();
        }}
        onDrop={() => {
          setDragging(false);
          endClassDrag();
        }}
      >
        <header className="app-toolbar" aria-label="session">
          <strong className="app-title">render</strong>
          <button type="button" className="view-toggle" disabled={!session.canUndo} title="undo (Ctrl+Z)" onClick={() => { session.undo(); }}>undo</button>
          <button type="button" className="view-toggle" disabled={!session.canRedo} title="redo (Ctrl+Shift+Z)" onClick={() => { session.redo(); }}>redo</button>
          <span className="toolbar-gap" />
          <button type="button" className="view-toggle" title="save the session as a file" onClick={exportSession}>export</button>
          <button type="button" className="view-toggle" title="open a saved session (undo brings the old state back)" onClick={() => { fileRef.current?.click(); }}>import</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="session file" onChange={(e) => { void importSession(e); }} />
          <button type="button" className="view-toggle" title="start again with the standard classes (undo brings the old state back)" onClick={() => { session.reset(); }}>
            reset
          </button>
          <button
            type="button"
            className="view-toggle"
            aria-label={`${theme === "dark" ? "light" : "dark"} theme`}
            title="change the theme"
            onClick={() => { setTheme(theme === "dark" ? "light" : "dark"); }}
          >
            {theme === "dark" ? "light" : "dark"}
          </button>
        </header>
        <section className="panel panel-types" aria-label="type graph">
          <header className="panel-header">
            <h2>biblo</h2>
            <span className="panel-subtitle">type graph</span>
            <span className="biblo-search" title="filter the classes">filter {searchBox}</span>
            <LevelSelect session={session} panel="types" />
          </header>
          {notice !== null && (
            <div className="rv-notice" role="status">
              <span>{notice}</span>
              <button type="button" className="view-toggle" aria-label="dismiss" onClick={() => { session.dismissNotice(); }}>×</button>
            </div>
          )}
          {kept !== null && (
            <div className="rv-notice rv-kept" role="status" aria-label="kept session">
              <span>A saved session did not load in full. The viewer kept a copy of it.</span>
              <span className="rv-notice-actions">
                <button type="button" className="view-toggle" onClick={() => { download("render-session-kept.json", kept); }}>download</button>
                <button type="button" className="view-toggle" onClick={discardKept}>discard</button>
              </span>
            </div>
          )}
          <div className="panel-body">
            {cards.length > 0
              ? <PackedLayout items={cards} />
              : <em className="canvas-empty">no class matches the search</em>}
            <div className="atoms-section" aria-label="traits">{render(session.traitsId, "types", false)}</div>
            <div className="atoms-section" aria-label="atoms">{render(session.atomsId, "types", false)}</div>
          </div>
        </section>
        <section className="panel panel-canvas" aria-label="canvas" onDragOver={onCanvasDragOver} onDrop={onCanvasDrop}>
          <header className="panel-header">
            <h2>canvas</h2>
            <span className="panel-subtitle">drag or add a class</span>
            <select
              className="canvas-add"
              aria-label="add a class to the canvas"
              title="add an instance of a class to the canvas"
              value=""
              onChange={(e: ChangeEvent<HTMLSelectElement>) => { if (e.target.value !== "") session.dropClass(e.target.value); }}
            >
              <option value="">+ add</option>
              {session.classNames().map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <LevelSelect session={session} panel="canvas" />
            {epoch !== null && (
              <span className="epoch-stats" title="the nodes that the last epoch evaluated, and the nodes in the store">
                {epoch.evaluated} / {epoch.total} nodes
                {epoch.cyclic > 0 && (
                  <span className="cycle-badge" title="the nodes on a dependency cycle: they evaluate again until their values are stable">
                    {" "}· cycle {epoch.cyclic}
                  </span>
                )}
              </span>
            )}
          </header>
          <div className="panel-body">
            {session.canvas.length === 0
              ? <div className="canvas-empty">Drag a class name from the type graph to make an instance. You can also select a class in the add menu.</div>
              : (
                <div className="canvas-items">
                  {session.canvas.map((id) => {
                    const mode = session.viewMode(id);
                    const dataRoot = session.dataRoot(id);
                    const content = mode === "data"
                      ? (dataRoot === undefined ? <em>no data</em> : render(dataRoot, "canvas", true))
                      : render(id, "canvas", true);
                    return (
                      <article key={id} className={`canvas-item${flash.has(id) ? " rv-flash" : ""}${mode === "data" ? " canvas-item-data" : ""}`} data-instance={id}>
                        <div className="canvas-item-header">
                          <span>{b.instances.get(id)?.classRef ?? id}</span>
                          <button type="button" className="view-toggle" onClick={() => { session.toggleView(id); }}>
                            {mode === "rendered" ? "data" : "rendered"}
                          </button>
                          <button type="button" className="view-toggle canvas-item-remove" aria-label="remove" title="remove" onClick={() => { session.removeCanvasItem(id); }}>
                            ×
                          </button>
                        </div>
                        {content ?? <em>empty</em>}
                      </article>
                    );
                  })}
                </div>
              )}
          </div>
        </section>
      </div>
      </ChildActionsContext>
    </ClassNamesContext>
  );
}
