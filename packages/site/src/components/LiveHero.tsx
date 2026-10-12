/**
 * The live hero of the home page. It holds a real render store of nine nodes and shows the store as a graph.
 * Each tick writes a new quantity, and the store starts one epoch. The graph lights each node that the epoch
 * evaluated, in the order of the evaluation. A node whose value did not change stops the epoch on its path.
 * The card reads three nodes of the store, thus the store renders an interface.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { app, deps, formatExpr, lit, ref } from "@mark1russell7/render-dsl";
import type { Expr } from "@mark1russell7/render-dsl";
import { addNode, batch, nodeStore, readValue, setValue } from "@mark1russell7/render-node";
import type { NodeStore } from "@mark1russell7/render-node";
import { standardOps } from "@mark1russell7/render-splay";

/** A node of the store. `w` is the width of its box, for a long value. */
type Spec = { readonly id: string; readonly expr: Expr; readonly w?: number };

const PRICE = 18;
const FREE_AT = 80;
const MAX_QTY = 6;

const SPECS: readonly Spec[] = [
  { id: "qty", expr: lit(2) },
  { id: "price", expr: lit(PRICE) },
  { id: "subtotal", expr: app("*", ref("qty"), ref("price")) },
  { id: "off", expr: app("if", app(">=", ref("subtotal"), lit(60)), lit(10), lit(0)) },
  { id: "total", expr: app("-", ref("subtotal"), ref("off")) },
  { id: "label", expr: app("concat", lit("$"), app("str", ref("total"))) },
  { id: "bar", expr: app("min", app("/", ref("total"), lit(FREE_AT)), lit(1)) },
  { id: "free", expr: app(">=", ref("total"), lit(FREE_AT)) },
  { id: "note", expr: app("if", ref("free"), lit("free shipping"), lit("shipping $5")), w: 142 },
];

/** The edges of the graph come from the static dependencies of each expression. */
const EDGES: readonly (readonly [string, string])[] = SPECS.flatMap((s) =>
  deps(s.expr).flatMap((path) => (path[0] === undefined ? [] : [[path[0], s.id] as const])));

/** The level of a node is the length of the longest path to it from a node without dependencies. */
const LEVELS: ReadonlyMap<string, number> = (() => {
  const level = new Map<string, number>();
  for (const s of SPECS) {
    const from = EDGES.filter(([, to]) => to === s.id).map(([f]) => level.get(f) ?? 0);
    level.set(s.id, from.length === 0 ? 0 : Math.max(...from) + 1);
  }
  return level;
})();

const NW = 86;
const NH = 48;
const GAP_MAIN = 18;
const GAP_CROSS = 12;
const PAD = 8;

const widthOf = (id: string): number => SPECS.find((s) => s.id === id)?.w ?? NW;

type Box = { readonly x: number; readonly y: number; readonly w: number };
type Layout = { readonly width: number; readonly height: number; readonly boxes: ReadonlyMap<string, Box>; readonly across: boolean };

/** This function places the nodes by level: in columns when `across` is true, else in rows. */
const layout = (across: boolean): Layout => {
  const byLevel = new Map<number, string[]>();
  for (const s of SPECS) {
    const l = LEVELS.get(s.id) ?? 0;
    byLevel.set(l, [...(byLevel.get(l) ?? []), s.id]);
  }
  const levels = [...byLevel.keys()].toSorted((a, b) => a - b);
  // The size of a node along the main axis and across it
  const mainOf = (id: string): number => (across ? widthOf(id) : NH);
  const crossOf = (id: string): number => (across ? NH : widthOf(id));
  const span = (ids: readonly string[]): number => ids.reduce((n, id) => n + crossOf(id), 0) + (ids.length - 1) * GAP_CROSS;
  const crossSize = Math.max(...levels.map((l) => span(byLevel.get(l) ?? [])));
  const boxes = new Map<string, Box>();
  let m = PAD;
  for (const l of levels) {
    const ids = byLevel.get(l) ?? [];
    let c = PAD + (crossSize - span(ids)) / 2;
    for (const id of ids) {
      boxes.set(id, across ? { x: m, y: c, w: widthOf(id) } : { x: c, y: m, w: widthOf(id) });
      c += crossOf(id) + GAP_CROSS;
    }
    m += Math.max(...ids.map(mainOf)) + GAP_MAIN;
  }
  const mainSize = m - GAP_MAIN + PAD;
  return across
    ? { width: mainSize, height: crossSize + 2 * PAD, boxes, across }
    : { width: crossSize + 2 * PAD, height: mainSize, boxes, across };
};

const WIDE = layout(true);
const TALL = layout(false);

const makeStore = (): NodeStore => {
  const store = nodeStore({ ops: standardOps });
  batch(store, () => {
    for (const s of SPECS) addNode(store, s.expr, s.id);
  });
  return store;
};

const valueOf = (store: NodeStore, id: string): unknown => {
  const v = readValue(store, id);
  return v.tag === "some" ? v.value : undefined;
};

const snapshot = (store: NodeStore): ReadonlyMap<string, unknown> => new Map(SPECS.map((s) => [s.id, valueOf(store, s.id)]));

/** This function gives the short text of a value in a node. */
const show = (v: unknown): string => {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string") return `"${v}"`;
  return String(v);
};

type Epoch = {
  readonly n: number;
  readonly written: string;
  readonly order: readonly string[];
  readonly changed: ReadonlySet<string>;
  readonly before: ReadonlyMap<string, unknown>;
  readonly ms: number;
};

/** The preference of the person for less motion, as an external store for `useSyncExternalStore`. */
const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (onChange: () => void): (() => void) => {
  const media = window.matchMedia(REDUCE);
  media.addEventListener("change", onChange);
  return () => { media.removeEventListener("change", onChange); };
};
const lessMotion = (): boolean => window.matchMedia(REDUCE).matches;
const motionOnServer = (): boolean => false;

const STEP_MS = 120;
const TICK_MS = 2400;
const FIRST_TICK_MS = 700;

/** The live hero. */
export default function LiveHero(): ReactElement {
  const [store] = useState(makeStore);
  const [qty, setQty] = useState(2);
  const [epoch, setEpoch] = useState<Epoch | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  // The choice of the person, or null: then the store plays, unless the person asks for less motion
  const [choice, setChoice] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);
  const still = useSyncExternalStore(subscribeMotion, lessMotion, motionOnServer);
  const playing = choice ?? !still;
  const rootRef = useRef<HTMLElement>(null);
  const qtyRef = useRef(2);
  const direction = useRef(1);
  // With less motion, the graph shows the full epoch at once
  const step = still ? (epoch?.order.length ?? 0) : revealedCount;

  const write = useCallback((next: number): void => {
    qtyRef.current = next;
    const before = snapshot(store);
    const t0 = performance.now();
    setValue(store, "qty", next);
    const ms = performance.now() - t0;
    const stats = store.epochStats;
    setQty(next);
    setEpoch((e) => ({
      n: (e?.n ?? 0) + 1,
      written: "qty",
      order: stats === null ? [] : [...stats.evaluated].filter((id) => id !== "qty"),
      changed: stats?.changed ?? new Set(),
      before,
      ms,
    }));
    setRevealedCount(0);
  }, [store]);

  // The store pauses when the hero is off the screen or the tab is hidden
  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const observer = new IntersectionObserver(([entry]) => { setVisible(entry?.isIntersecting ?? true); });
    observer.observe(el);
    const onVisibility = (): void => { setVisible(document.visibilityState === "visible"); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Each tick writes the next quantity: up to the maximum, then down again
  useEffect(() => {
    if (!playing || !visible) return;
    const tick = (): void => {
      const q = qtyRef.current;
      if (q + direction.current > MAX_QTY || q + direction.current < 1) direction.current = -direction.current;
      write(q + direction.current);
    };
    const first = setTimeout(tick, FIRST_TICK_MS);
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [playing, visible, write]);

  // The graph reveals the evaluated nodes one at a time, in the order of the epoch
  useEffect(() => {
    if (still || epoch === null || revealedCount >= epoch.order.length) return;
    const timer = setTimeout(() => { setRevealedCount((n) => n + 1); }, STEP_MS);
    return () => { clearTimeout(timer); };
  }, [epoch, revealedCount, still]);

  const revealed = (id: string): boolean => {
    if (epoch === null || id === epoch.written) return true;
    const i = epoch.order.indexOf(id);
    return i === -1 || i < step;
  };
  const shown = (id: string): unknown => (epoch !== null && !revealed(id) ? epoch.before.get(id) : valueOf(store, id));
  const current = epoch !== null && step > 0 && step <= epoch.order.length ? epoch.order[step - 1] : undefined;
  const done = epoch === null || step >= epoch.order.length;

  const stateOf = (id: string): string => {
    if (epoch === null) return "idle";
    if (id === epoch.written) return "written";
    const i = epoch.order.indexOf(id);
    if (i === -1 || i >= step) return "idle";
    if (i === step - 1 && !done) return "current";
    return epoch.changed.has(id) ? "changed" : "same";
  };

  const edgeState = (from: string, to: string): string => {
    const s = stateOf(to);
    if (s === "idle" || epoch === null) return "idle";
    const cause = from === epoch.written || epoch.changed.has(from);
    return cause ? (s === "current" ? "flow" : "lit") : "idle";
  };

  const specOf = (id: string): Spec | undefined => SPECS.find((s) => s.id === id);
  const captionId = focus ?? current ?? null;
  const caption = (() => {
    if (captionId === null) {
      if (epoch === null) return "Each node holds an expression. Point at a node to see it.";
      const stopped = epoch.order.filter((id) => !epoch.changed.has(id)).length;
      return stopped === 0
        ? `The write to qty changed each of its ${String(epoch.order.length)} readers.`
        : `${String(stopped)} ${stopped === 1 ? "node gave" : "nodes gave"} the same value, thus the epoch stopped there.`;
    }
    const spec = specOf(captionId);
    return spec === undefined ? "" : `${captionId} = ${formatExpr(spec.expr)}  →  ${show(shown(captionId))}`;
  })();

  const graph = (l: Layout): ReactElement => (
    <svg
      className={`rh-graph ${l.across ? "rh-across" : "rh-down"}`}
      viewBox={`0 0 ${String(l.width)} ${String(l.height)}`}
      role="group"
      aria-label="the nodes of the store, by level"
    >
      <defs>
        <marker id={`rh-arrow-${l.across ? "a" : "d"}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" className="rh-arrowhead" />
        </marker>
      </defs>
      {EDGES.map(([from, to]) => {
        const a = l.boxes.get(from);
        const b = l.boxes.get(to);
        if (a === undefined || b === undefined) return null;
        const [x1, y1, x2, y2] = l.across
          ? [a.x + a.w, a.y + NH / 2, b.x, b.y + NH / 2]
          : [a.x + a.w / 2, a.y + NH, b.x + b.w / 2, b.y];
        const d = l.across
          ? `M${String(x1)},${String(y1)} C${String((x1 + x2) / 2)},${String(y1)} ${String((x1 + x2) / 2)},${String(y2)} ${String(x2 - 2)},${String(y2)}`
          : `M${String(x1)},${String(y1)} C${String(x1)},${String((y1 + y2) / 2)} ${String(x2)},${String((y1 + y2) / 2)} ${String(x2)},${String(y2 - 2)}`;
        return <path key={`${from}-${to}`} d={d} className="rh-edge" data-state={edgeState(from, to)} markerEnd={`url(#rh-arrow-${l.across ? "a" : "d"})`} />;
      })}
      {SPECS.map((s) => {
        const b = l.boxes.get(s.id);
        if (b === undefined) return null;
        const order = epoch?.order.indexOf(s.id) ?? -1;
        const label = `${s.id} = ${formatExpr(s.expr)}, value ${show(shown(s.id))}`;
        return (
          <g
            key={s.id}
            className="rh-node"
            data-state={stateOf(s.id)}
            data-source={s.expr.tag === "lit" ? "" : undefined}
            transform={`translate(${String(b.x)},${String(b.y)})`}
            tabIndex={0}
            role="img"
            aria-label={label}
            onMouseEnter={() => { setFocus(s.id); }}
            onMouseLeave={() => { setFocus(null); }}
            onFocus={() => { setFocus(s.id); }}
            onBlur={() => { setFocus(null); }}
          >
            <rect width={b.w} height={NH} rx={6} />
            <text x={10} y={19} className="rh-id">{s.id}</text>
            <text x={10} y={39} className={typeof shown(s.id) === "string" ? "rh-value rh-string" : "rh-value"}>{show(shown(s.id))}</text>
            {order !== -1 && order < step && (
              <g className="rh-order" transform={`translate(${String(b.w - 2)},2)`}>
                <circle r={9} />
                <text textAnchor="middle" dominantBaseline="central">{order + 1}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );

  const bar = shown("bar");
  const meter = typeof bar === "number" ? bar : 0;
  const free = shown("free") === true;
  const stopped = epoch === null ? 0 : epoch.order.filter((id) => !epoch.changed.has(id)).length;

  return (
    <section ref={rootRef} className="rh-live not-content" aria-label="A live render store">
      <header className="rh-head">
        <span className="rh-dot" data-on={playing && visible ? "" : undefined} aria-hidden="true" />
        <strong>A live render store</strong>
        <span className="rh-epoch">{epoch === null ? "ready" : `epoch ${String(epoch.n)}`}</span>
      </header>
      <div className="rh-stage">
        {graph(WIDE)}
        {graph(TALL)}
      </div>
      <div className="rh-out">
        <div className="rh-card" role="group" aria-label="the card that the store renders">
          <div className="rh-card-top">
            <span>{String(shown("qty"))} × ${PRICE}</span>
            <strong>{String(shown("label"))}</strong>
          </div>
          <div className="rh-meter" role="meter" aria-label="the way to free shipping" aria-valuemin={0} aria-valuemax={1} aria-valuenow={meter}>
            <span style={{ inlineSize: `${String(Math.round(meter * 100))}%` }} />
          </div>
          <div className="rh-note" data-free={free ? "" : undefined}>{String(shown("note"))}</div>
          <p className="rh-card-caption">The store renders this card from <code>label</code>, <code>bar</code> and <code>note</code>.</p>
        </div>
        <div className="rh-trace">
          <p className="rh-caption">{caption}</p>
          <dl className="rh-stats">
            <div><dt>evaluated</dt><dd>{epoch === null ? "–" : `${String(epoch.order.length)} of ${String(SPECS.length - 1)}`}</dd></div>
            <div><dt>stopped</dt><dd>{epoch === null ? "–" : String(stopped)}</dd></div>
            <div><dt>time</dt><dd>{epoch === null ? "–" : epoch.ms < 0.01 ? "<0.01 ms" : `${epoch.ms.toFixed(2)} ms`}</dd></div>
          </dl>
          <div className="rh-controls">
            <button type="button" className="rh-btn" aria-label="decrease qty" disabled={qty <= 1} onClick={() => { setChoice(false); write(qty - 1); }}>−</button>
            <span className="rh-qty">qty = {qty}</span>
            <button type="button" className="rh-btn" aria-label="increase qty" disabled={qty >= MAX_QTY} onClick={() => { setChoice(false); write(qty + 1); }}>+</button>
            <button type="button" className="rh-btn rh-play" aria-pressed={playing} onClick={() => { setChoice(!playing); }}>
              {playing ? "pause" : "play"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
