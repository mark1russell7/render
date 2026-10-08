/**
 * The expression playground. An expression is data, thus the playground edits its JSON form. It evaluates the
 * expression against a context with the standard ops, and it shows the value or the issues that explain a `none`.
 */
import { useMemo, useState, type ReactElement } from "react";
import { evaluate, isExpr, objectResolver } from "@render/dsl";
import type { EvalIssue } from "@render/dsl";
import { standardOps } from "@render/splay";
import { formatExpr, formatValue } from "../lib/format.ts";

type Preset = { readonly name: string; readonly expr: unknown; readonly context: unknown };

const PRESETS: readonly Preset[] = [
  {
    name: "arithmetic",
    expr: { tag: "app", op: "*", args: [{ tag: "app", op: "+", args: [{ tag: "ref", path: ["w"] }, { tag: "lit", value: 1 }] }, { tag: "ref", path: ["h"] }] },
    context: { w: 2, h: 3 },
  },
  {
    name: "lazy if",
    expr: { tag: "app", op: "if", args: [{ tag: "ref", path: ["ready"] }, { tag: "lit", value: "go" }, { tag: "app", op: "boom", args: [] }] },
    context: { ready: true },
  },
  {
    name: "lambda and map",
    expr: { tag: "app", op: "map", args: [{ tag: "ref", path: ["items"] }, { tag: "app", op: "fn", args: [{ tag: "lit", value: ["x"] }, { tag: "app", op: "*", args: [{ tag: "ref", path: ["x"] }, { tag: "ref", path: ["scale"] }] }] }] },
    context: { items: [1, 2, 3], scale: 10 },
  },
  {
    name: "record",
    expr: { tag: "app", op: "record", args: [{ tag: "lit", value: "area" }, { tag: "app", op: "*", args: [{ tag: "ref", path: ["w"] }, { tag: "ref", path: ["h"] }] }, { tag: "lit", value: "missing" }, { tag: "ref", path: ["nope"] }] },
    context: { w: 4, h: 5 },
  },
  {
    name: "a missing path",
    expr: { tag: "app", op: "+", args: [{ tag: "ref", path: ["box", "width"] }, { tag: "lit", value: 1 }] },
    context: { box: { height: 2 } },
  },
  {
    name: "a type error",
    expr: { tag: "app", op: "+", args: [{ tag: "lit", value: "text" }, { tag: "lit", value: 1 }] },
    context: {},
  },
];

const pretty = (v: unknown): string => JSON.stringify(v, null, 2);

type Outcome =
  | { readonly kind: "parse"; readonly message: string }
  | { readonly kind: "value"; readonly text: string; readonly short: string; readonly issues: readonly EvalIssue[]; readonly none: boolean };

const issueText = (i: EvalIssue): string =>
  [i.code, i.op, i.path?.join("."), i.message === undefined ? undefined : `(${i.message})`].filter((p) => p !== undefined).join(": ");

/** The playground. */
export default function ExprPlayground(props: { readonly title?: string }): ReactElement {
  const title = props.title ?? "The expression playground";
  const [preset, setPreset] = useState(0);
  const [exprText, setExprText] = useState(pretty(PRESETS[0]!.expr));
  const [contextText, setContextText] = useState(pretty(PRESETS[0]!.context));

  const choose = (i: number): void => {
    setPreset(i);
    setExprText(pretty(PRESETS[i]!.expr));
    setContextText(pretty(PRESETS[i]!.context));
  };

  const outcome = useMemo((): Outcome => {
    let expr: unknown;
    let context: unknown;
    try {
      expr = JSON.parse(exprText) as unknown;
      context = JSON.parse(contextText) as unknown;
    } catch (e) {
      return { kind: "parse", message: e instanceof Error ? e.message : String(e) };
    }
    if (!isExpr(expr)) return { kind: "parse", message: "The JSON is not a valid expression: each node needs a tag (lit, ref or app)." };
    const issues: EvalIssue[] = [];
    const result = evaluate(expr, objectResolver(context), standardOps, issues);
    return { kind: "value", text: formatValue(result), short: formatExpr(expr), issues, none: result.tag === "none" };
  }, [exprText, contextText]);

  return (
    <section className="rd-frame not-content" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <span>Edit the JSON. The result changes as you type.</span>
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
            <span className="rd-label">expression</span>
            <textarea className="rd-code-input" rows={10} spellCheck={false} value={exprText} onChange={(e) => { setExprText(e.target.value); }} />
          </label>
          <label className="rd-stack">
            <span className="rd-label">context</span>
            <textarea className="rd-code-input" rows={10} spellCheck={false} value={contextText} onChange={(e) => { setContextText(e.target.value); }} />
          </label>
        </div>
        {outcome.kind === "parse" ? (
          <div className="rd-result" data-state="none" role="status">{outcome.message}</div>
        ) : (
          <div className="rd-stack" role="status">
            <div className="rd-mono">{outcome.short}</div>
            <div className="rd-result" data-state={outcome.none ? "none" : "some"}>
              {outcome.none ? "none" : `some(${outcome.text})`}
            </div>
            {outcome.issues.length > 0 && (
              <ul className="rd-issues" aria-label="issues">
                {outcome.issues.map((i, k) => <li key={k}>{issueText(i)}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
