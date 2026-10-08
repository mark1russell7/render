/**
 * The epoch explorer. It holds a small store of five nodes and shows it as a graph. A write to `a` starts an
 * epoch. The graph numbers each node that the epoch evaluates, in the order of the evaluation.
 * It fills each node whose value changed. Thus the order of the epoch and its pruning are visible.
 */
import { useState, type ReactElement } from "react";
import { app, lit, ref } from "@render/dsl";
import type { Expr } from "@render/dsl";
import { addNode, batch, nodeStore, readValue, setValue } from "@render/node";
import type { NodeStore } from "@render/node";
import { standardOps } from "@render/splay";
import { formatExpr, formatValue } from "../lib/format.ts";

type Spec = { readonly id: string; readonly expr: Expr; readonly x: number; readonly y: number; readonly w?: number };

const SPECS: readonly Spec[] = [
  { id: "a", expr: lit(3), x: 20, y: 110 },
  { id: "b", expr: app("abs", ref("a")), x: 180, y: 30 },
  { id: "c", expr: app("*", ref("b"), lit(2)), x: 340, y: 30 },
  { id: "d", expr: app("+", ref("a"), ref("c")), x: 500, y: 110 },
  { id: "e", expr: app("if", app(">", ref("d"), lit(0)), lit("up"), lit("down")), x: 650, y: 110, w: 168 },
];
const EDGES: readonly [string, string][] = [["a", "b"], ["b", "c"], ["c", "d"], ["a", "d"], ["d", "e"]];
const W = 132;
const H = 50;

const makeStore = (): NodeStore => {
  const store = nodeStore({ ops: standardOps });
  batch(store, () => {
    for (const s of SPECS) addNode(store, s.expr, s.id);
  });
  return store;
};

type Epoch = { readonly order: readonly string[]; readonly changed: ReadonlySet<string> };

/** The explorer. */
export default function EpochExplorer(props: { readonly title?: string }): ReactElement {
  const title = props.title ?? "An epoch in a small store";
  const [store] = useState(makeStore);
  const [a, setA] = useState(3);
  const [epoch, setEpoch] = useState<Epoch | null>(null);

  const write = (next: number): void => {
    setValue(store, "a", next);
    const stats = store.epochStats;
    setA(next);
    setEpoch(stats ? { order: [...stats.evaluated], changed: stats.changed } : null);
  };

  const pos = new Map(SPECS.map((s) => [s.id, s]));
  const stateOf = (id: string): string =>
    epoch === null ? "idle" : epoch.changed.has(id) ? "changed" : epoch.order.includes(id) ? "evaluated" : "idle";

  return (
    <section className="rd-frame not-content" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <span>
          {epoch === null
            ? "Move the slider to write a new value to a."
            : `The epoch evaluated ${String(epoch.order.length)} of ${String(SPECS.length)} nodes. ${String(epoch.changed.size)} values changed.`}
        </span>
      </header>
      <div className="rd-body rd-stack">
        <div className="rd-row">
          <label className="rd-row">
            <span className="rd-mono">a</span>
            <input
              type="range"
              min={-5}
              max={5}
              step={1}
              value={a}
              aria-label="the value of a"
              onChange={(e) => { write(Number(e.target.value)); }}
            />
            <span className="rd-mono">{a}</span>
          </label>
          <button type="button" className="rd-button" onClick={() => { write(-a); }}>
            a = {-a} (abs(a) does not change)
          </button>
        </div>
        <svg className="rd-graph" viewBox="0 0 830 190" role="img" aria-label="The nodes and their reads. The numbers give the order of the evaluation.">
          <defs>
            <marker id="rd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="rd-arrow" d="M0 0 L8 4 L0 8 z" />
            </marker>
          </defs>
          {EDGES.map(([from, to]) => {
            const f = pos.get(from)!;
            const t = pos.get(to)!;
            const x1 = f.x + (f.w ?? W);
            const y1 = f.y + H / 2;
            const x2 = t.x;
            const y2 = t.y + H / 2;
            const long = from === "a" && to === "d";
            const d = long ? `M${String(x1)} ${String(y1 + 10)} C ${String(x1 + 140)} ${String(y1 + 70)}, ${String(x2 - 140)} ${String(y2 + 70)}, ${String(x2)} ${String(y2 + 10)}` : `M${String(x1)} ${String(y1)} L${String(x2 - 2)} ${String(y2)}`;
            return <path key={`${from}-${to}`} className="rd-edge" d={d} markerEnd="url(#rd-arrow)" />;
          })}
          {SPECS.map((s) => {
            const index = epoch?.order.indexOf(s.id) ?? -1;
            return (
              <g key={s.id} className="rd-node" data-state={stateOf(s.id)} data-node={s.id}>
                <rect x={s.x} y={s.y} width={s.w ?? W} height={H} rx="5" />
                <text x={s.x + 10} y={s.y + 20}>{`${s.id} = ${formatValue(readValue(store, s.id))}`}</text>
                <text className="rd-node-expr" x={s.x + 10} y={s.y + 38}>{formatExpr(s.expr)}</text>
                {index >= 0 && (
                  <g>
                    <circle className="rd-order" cx={s.x + (s.w ?? W) - 4} cy={s.y + 4} r="9" />
                    <text className="rd-order-text" x={s.x + (s.w ?? W) - 4} y={s.y + 7.5} textAnchor="middle">{index + 1}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
        <div className="rd-legend">
          <span><span className="rd-swatch" data-state="evaluated" />evaluated, value did not change</span>
          <span><span className="rd-swatch" data-state="changed" />evaluated, value changed</span>
          <span><span className="rd-swatch" />not evaluated</span>
        </div>
      </div>
    </section>
  );
}
