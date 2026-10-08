import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { DragEvent, ReactNode } from "react";
import type { SplayCache } from "@render/splay";
import { splay } from "@render/splay";
import { ViewerSession } from "./session.ts";
import { CLASS_DRAG_TYPE, viewerKit, viewerOps } from "./renderers.tsx";
import { PackedLayout } from "./PackedLayout.tsx";
import type { PackedItem } from "./PackedLayout.tsx";

/** The time of the flash of the reactivity proof, in milliseconds. */
const FLASH_MS = 600;

/**
 * The viewer: the type graph (biblo) on the left and the canvas on the right.
 * The session holds all state. This component only renders it, with the splay engine and the view atoms.
 */
export function App({ session: given }: { readonly session?: ViewerSession }): ReactNode {
  const [session] = useState(() => given ?? new ViewerSession(viewerOps));
  useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { b, store } = session;
  const cache = session.cache as SplayCache<ReactNode>;
  const flash = session.flash;

  useEffect(() => {
    if (flash.size === 0) return;
    const timer = setTimeout(() => { session.clearFlash(); }, FLASH_MS);
    return () => { clearTimeout(timer); };
  }, [session, flash]);

  const onCanvasDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(CLASS_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onCanvasDrop = useCallback((e: DragEvent) => {
    const className = e.dataTransfer.getData(CLASS_DRAG_TYPE);
    if (!className) return;
    e.preventDefault();
    session.dropClass(className);
  }, [session]);

  const render = (id: string, editable: boolean): ReactNode =>
    splay(viewerKit, b, store, id, editable ? session.editCell : undefined, editable ? session.addChild : undefined, cache);

  const searchBox = render(session.searchId, true);
  const cards: PackedItem[] = [];
  for (const [name, card] of session.cards()) cards.push({ id: name, node: render(card, true) });

  const epoch = session.epoch;
  const notice = session.notice;

  return (
    <div className="app">
      <section className="panel panel-types" aria-label="type graph">
        <header className="panel-header">
          <h2>biblo</h2>
          <span className="panel-subtitle">type graph</span>
          <span className="biblo-search" title="filter the classes">{searchBox}</span>
          <button type="button" className="view-toggle" title="start again with the standard classes" onClick={() => { session.reset(); }}>
            reset
          </button>
        </header>
        {notice !== null && (
          <div className="rv-notice" role="status">
            <span>{notice}</span>
            <button type="button" className="view-toggle" aria-label="dismiss" onClick={() => { session.dismissNotice(); }}>×</button>
          </div>
        )}
        <div className="panel-body">
          {cards.length > 0
            ? <PackedLayout items={cards} />
            : <em className="canvas-empty">no class matches the search</em>}
        </div>
      </section>
      <section className="panel panel-canvas" aria-label="canvas" onDragOver={onCanvasDragOver} onDrop={onCanvasDrop}>
        <header className="panel-header">
          <h2>canvas</h2>
          <span className="panel-subtitle">drop a class here</span>
          {epoch !== null && (
            <span className="epoch-stats" title="the nodes that the last epoch evaluated, and the nodes in the store">
              {epoch.evaluated} / {epoch.total} nodes
            </span>
          )}
        </header>
        <div className="panel-body">
          {session.canvas.length === 0
            ? <div className="canvas-empty">Drag a class name from the type graph to make an instance.</div>
            : (
              <div className="canvas-items">
                {session.canvas.map((id) => {
                  const mode = session.viewMode(id);
                  const dataRoot = session.dataRoot(id);
                  const content = mode === "data"
                    ? (dataRoot === undefined ? <em>no data</em> : render(dataRoot, false))
                    : render(id, true);
                  return (
                    <article key={id} className={`canvas-item${flash.has(id) ? " rv-flash" : ""}`} data-instance={id}>
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
  );
}
