/**
 * The expression playground. A person writes an expression in the formula language, the text form of the IR.
 * The playground parses it, evaluates it against a context with the standard ops, and shows the value or the
 * issues that explain a `none`. It also shows the IR of the formula, because the IR is the expression.
 */
import { useMemo, useState, type ReactElement } from "react";
import { evaluate, objectResolver, parseExpr } from "@render/dsl";
import type { EvalIssue, Expr } from "@render/dsl";
import { standardOps } from "@render/splay";
import { formatExpr, formatValue } from "../lib/format.ts";

type Preset = { readonly name: string; readonly formula: string; readonly context: unknown };

const PRESETS: readonly Preset[] = [
  { name: "arithmetic", formula: "(w + 1) * h", context: { w: 2, h: 3 } },
  { name: "lazy if", formula: 'if(ready, "go", boom())', context: { ready: true } },
  { name: "lambda and map", formula: 'map(items, fn(["x"], x * scale))', context: { items: [1, 2, 3], scale: 10 } },
  { name: "record", formula: 'record("area", w * h, "missing", nope)', context: { w: 4, h: 5 } },
  { name: "a summary", formula: 'concat(count(keys(box)), " keys: ", join(keys(box)))', context: { box: { width: 2, height: 3 } } },
  { name: "a missing path", formula: "box.width + 1", context: { box: { height: 2 } } },
  { name: "a type error", formula: '"text" + 1', context: {} },
];

const pretty = (v: unknown): string => JSON.stringify(v, null, 2);

type Outcome =
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "value";
      readonly text: string;
      readonly canonical: string;
      readonly ir: Expr;
      readonly issues: readonly EvalIssue[];
      readonly none: boolean;
    };

const issueText = (i: EvalIssue): string =>
  [i.code, i.op, i.path?.join("."), i.message === undefined ? undefined : `(${i.message})`].filter((p) => p !== undefined).join(": ");

/** The playground. */
export default function ExprPlayground(props: { readonly title?: string }): ReactElement {
  const title = props.title ?? "The expression playground";
  const [preset, setPreset] = useState(0);
  const [formula, setFormula] = useState(PRESETS[0]!.formula);
  const [contextText, setContextText] = useState(pretty(PRESETS[0]!.context));

  const choose = (i: number): void => {
    setPreset(i);
    setFormula(PRESETS[i]!.formula);
    setContextText(pretty(PRESETS[i]!.context));
  };

  const outcome = useMemo((): Outcome => {
    const parsed = parseExpr(formula);
    if (!parsed.ok) return { kind: "error", message: `The formula is not valid at ${String(parsed.offset)}: ${parsed.message}` };
    let context: unknown;
    try {
      context = JSON.parse(contextText) as unknown;
    } catch (e) {
      return { kind: "error", message: `The context is not JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
    const issues: EvalIssue[] = [];
    const result = evaluate(parsed.expr, objectResolver(context), standardOps, issues);
    return {
      kind: "value",
      text: formatValue(result),
      canonical: formatExpr(parsed.expr),
      ir: parsed.expr,
      issues,
      none: result.tag === "none",
    };
  }, [formula, contextText]);

  return (
    <section className="rd-frame not-content" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <span>Edit the formula. The result changes as you type.</span>
      </header>
      <div className="rd-body rd-stack">
        <div className="rd-row" role="group" aria-label="examples">
          {PRESETS.map((p, i) => (
            <button key={p.name} type="button" className="rd-button" aria-pressed={i === preset} onClick={() => { choose(i); }}>
              {p.name}
            </button>
          ))}
        </div>
        <label className="rd-stack">
          <span className="rd-label">formula</span>
          <input className="rd-input rd-code-input" spellCheck={false} value={formula} onChange={(e) => { setFormula(e.target.value); }} />
        </label>
        <label className="rd-stack">
          <span className="rd-label">context</span>
          <textarea className="rd-code-input" rows={4} spellCheck={false} value={contextText} onChange={(e) => { setContextText(e.target.value); }} />
        </label>
        {outcome.kind === "error" ? (
          <div className="rd-result" data-state="none" role="status">{outcome.message}</div>
        ) : (
          <div className="rd-stack" role="status">
            <div className="rd-result" data-state={outcome.none ? "none" : "some"}>
              {outcome.none ? "none" : `some(${outcome.text})`}
            </div>
            {outcome.issues.length > 0 && (
              <ul className="rd-issues" aria-label="issues">
                {outcome.issues.map((i, k) => <li key={k}>{issueText(i)}</li>)}
              </ul>
            )}
            <details>
              <summary className="rd-label">the IR of the formula: {outcome.canonical}</summary>
              <pre className="rd-mono" aria-label="the IR">{pretty(outcome.ir)}</pre>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
