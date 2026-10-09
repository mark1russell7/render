/**
 * The level-of-detail explorer. It hydrates a value (JSON, or a formula) into an instance tree, and it renders
 * the tree with the kit of the viewer and a view policy. The level selects how many levels show their full view.
 * Each disclosure control expands or collapses one instance. The table lists the summary method of each class
 * of the tree: an expression with the same builder as the render.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { biblo, classNodeOps, registerClasses, resolveMethods } from "@render/biblo";
import { formatExpr, isExpr, parseExpr } from "@render/dsl";
import { nodeStore } from "@render/node";
import { hydrate, splay, standardClasses, standardOps, viewPolicy } from "@render/splay";
import { viewerKit } from "@render/viewer";
import "@render/viewer/styles.css";

type Preset = { readonly name: string; readonly kind: "json" | "formula"; readonly text: string };

const pretty = (v: unknown): string => JSON.stringify(v, null, 2);

const PRESETS: readonly Preset[] = [
  {
    name: "nested data",
    kind: "json",
    text: pretty({ user: { name: "Ada", languages: ["en", "fr"], address: { city: "London", zip: "N1" } }, tags: ["a", "b", "c"], active: true }),
  },
  { name: "an expression", kind: "formula", text: 'if(self.width > 100, concat("wide: ", str(self.width)), max(self.width, 10) * 2)' },
  { name: "a list of records", kind: "json", text: pretty([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }]) },
];

const LEVELS: readonly [number, string][] = [[0, "0"], [1, "1"], [2, "2"], [3, "3"], [1000, "all"]];

type Model =
  | { readonly ok: false; readonly message: string }
  | { readonly ok: true; readonly render: (view: ReturnType<typeof viewPolicy>) => ReactNode; readonly summaries: readonly [string, string][] };

/** This function hydrates the text of a preset into a fresh biblo and store. */
const build = (kind: Preset["kind"], text: string): Model => {
  let value: unknown;
  if (kind === "formula") {
    const parsed = parseExpr(text);
    if (!parsed.ok) return { ok: false, message: `The formula is not valid at ${String(parsed.offset)}: ${parsed.message}` };
    value = parsed.expr;
  } else {
    try {
      value = JSON.parse(text) as unknown;
    } catch (e) {
      return { ok: false, message: `The value is not JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const b = biblo();
  const store = nodeStore({ nodeOps: classNodeOps(b), ops: standardOps });
  registerClasses(b, standardClasses);
  const root = hydrate(viewerKit, b, store, value);
  const classes = new Set([...b.instances.values()].map((i) => i.classRef));
  const summaries: [string, string][] = [];
  for (const name of classes) {
    const methods = resolveMethods(b, name);
    const summary = methods["summary"];
    if (!isExpr(summary)) continue;
    const same = summary === methods["render"];
    summaries.push([name, same ? "(the render: the class does not collapse)" : formatExpr(summary)]);
  }
  return { ok: true, render: (view) => splay(viewerKit, b, store, root.id, { view }), summaries };
};

/** The explorer. */
export default function LodExplorer(props: { readonly title?: string }): ReactElement {
  const title = props.title ?? "Level of detail";
  const [preset, setPreset] = useState(0);
  const [text, setText] = useState(PRESETS[0]!.text);
  const [level, setLevel] = useState(1);
  // The choices of the person: an instance ID and its state. A new value or a new level removes them.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const kind = PRESETS[preset]!.kind;
  const model = useMemo(() => build(kind, text), [kind, text]);

  const choose = (i: number): void => {
    setPreset(i);
    setText(PRESETS[i]!.text);
    setOverrides(new Map());
  };

  const view = viewPolicy(level, new Map(overrides), (id, expanded) => {
    setOverrides((old) => new Map([...old, [id, expanded]]));
  });

  return (
    <section className="rd-frame not-content" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <span>Change the level, or click ▸ and ▾ to expand and collapse one instance.</span>
      </header>
      <div className="rd-body rd-stack">
        <div className="rd-row" role="group" aria-label="examples">
          {PRESETS.map((p, i) => (
            <button key={p.name} type="button" className="rd-button" aria-pressed={i === preset} onClick={() => { choose(i); }}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="rd-split">
          <label className="rd-stack">
            <span className="rd-label">{kind === "json" ? "value (JSON)" : "value (a formula)"}</span>
            <textarea
              className="rd-code-input"
              rows={kind === "json" ? 10 : 3}
              spellCheck={false}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setOverrides(new Map());
              }}
            />
          </label>
          <div className="rd-stack">
            <div className="rd-row" role="group" aria-label="level">
              <span className="rd-label">level</span>
              {LEVELS.map(([n, label]) => (
                <button
                  key={n}
                  type="button"
                  className="rd-button"
                  aria-pressed={n === level}
                  onClick={() => {
                    setLevel(n);
                    setOverrides(new Map());
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {model.ok ? (
              <div className="app rd-lod-app" data-theme="dark" aria-label="the render">{model.render(view)}</div>
            ) : (
              <div className="rd-result" data-state="none" role="status">{model.message}</div>
            )}
          </div>
        </div>
        {model.ok && (
          <table className="rd-table" aria-label="the summaries">
            <thead>
              <tr><th>class</th><th>summary method</th></tr>
            </thead>
            <tbody>
              {model.summaries.map(([name, formula]) => (
                <tr key={name}><td><code>{name}</code></td><td><code>{formula}</code></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
