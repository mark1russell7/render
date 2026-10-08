import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Rect, pack } from "@render/pack";

/** One card of the packed layout. */
export type PackedItem = { readonly id: string; readonly node: ReactNode };

type Position = { readonly x: number; readonly y: number; readonly w: number };
type Layout = { readonly width: number; readonly height: number; readonly positions: ReadonlyMap<string, Position> };

const GAP = 4;

const sameLayout = (a: Layout | null, b: Layout | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.width !== b.width || a.height !== b.height || a.positions.size !== b.positions.size) return false;
  for (const [id, p] of a.positions) {
    const q = b.positions.get(id);
    if (!q || q.x !== p.x || q.y !== p.y || q.w !== p.w) return false;
  }
  return true;
};

/** This function measures the cards of the hidden layer and packs them into the width of the panel. */
const measure = (layer: HTMLElement, items: readonly PackedItem[]): Layout | null => {
  const rects: Rect<string>[] = [];
  for (const item of items) {
    const card = layer.querySelector(`:scope > [data-class-id="${CSS.escape(item.id)}"]`);
    const bounds = card?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) continue;
    const r = new Rect<string>();
    r.id = item.id;
    r.size.set(bounds.width + GAP, bounds.height + GAP);
    rects.push(r);
  }
  if (rects.length === 0) return null;
  const outer = new Rect<string>();
  outer.size.set(layer.parentElement?.clientWidth ?? 400, 0);
  outer.fixedWidth = true;
  pack(rects, outer);
  const positions = new Map<string, Position>();
  for (const r of rects) {
    if (r.id !== undefined) positions.set(r.id, { x: r.position.x, y: r.position.y, w: r.size.x - GAP });
  }
  return { width: outer.size.x, height: outer.size.y, positions };
};

/**
 * A layout that packs cards of different sizes into the width of its panel.
 *
 * A hidden layer always renders all cards, thus the layout can measure each card, also a card that comes
 * after the first layout. A `ResizeObserver` watches the panel and each card, thus the layout packs again
 * when the panel or a card changes its size. A layout that is equal to the current one changes nothing.
 */
export function PackedLayout({ items }: { readonly items: readonly PackedItem[] }): ReactNode {
  const layerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = measure(layer, items);
      setLayout((prev) => (sameLayout(prev, next) ? prev : next));
    });
    if (layer.parentElement) observer.observe(layer.parentElement);
    for (const child of Array.from(layer.children)) observer.observe(child);
    return () => { observer.disconnect(); };
  }, [items]);

  return (
    <div className="rv-packed">
      <div ref={layerRef} className="rv-packed-measure" aria-hidden="true">
        {items.map((item) => (
          <div key={item.id} data-class-id={item.id} className="rv-packed-item">{item.node}</div>
        ))}
      </div>
      {layout && (
        <div className="rv-packed-container" style={{ width: layout.width, height: layout.height }}>
          {items.map((item) => {
            const pos = layout.positions.get(item.id);
            return pos ? (
              <div key={item.id} data-class-id={item.id} className="rv-packed-item" style={{ left: pos.x, top: pos.y, width: pos.w }}>
                {item.node}
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
