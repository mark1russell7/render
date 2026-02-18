import { useMemo } from "react";
import type { ReactNode } from "react";
import type { ComponentClass } from "@render/biblo";
import { biblo } from "@render/biblo";
import { nodeStore, defaultOps, resolveAll } from "@render/node";
import { registerClasses, hydrate, splay, standardOps, standardClasses } from "@render/splay";
import { reactClasses, reactKit } from "./renderers.js";

/**
 * Serialize a ComponentClass to a plain JSON-friendly object.
 * Methods are functions — we keep only their names.
 * Cells and their Expr trees are already plain data.
 */
const classToJson = (cls: ComponentClass): Record<string, unknown> => {
  const result: Record<string, unknown> = { name: cls.name };
  if (cls.extends) result["extends"] = cls.extends;

  // Cells: keep expr trees + metadata, all already plain JSON
  const cells: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(cls.cells)) {
    const cell: Record<string, unknown> = { expr: def.expr };
    if (def.type) cell["type"] = def.type;
    if (def.default !== undefined) cell["default"] = def.default;
    if (def.bindings) cell["bindings"] = def.bindings;
    cells[name] = cell;
  }
  if (Object.keys(cells).length > 0) result["cells"] = cells;

  // Methods: list names only (the values are functions)
  if (cls.methods) {
    const names = Object.keys(cls.methods);
    if (names.length > 0) result["methods"] = names;
  }

  return result;
};

/** Serialize the full type graph as a JSON-friendly object */
const typeGraphToJson = (classes: readonly ComponentClass[]): Record<string, unknown> => {
  const graph: Record<string, unknown> = {};
  for (const cls of classes) {
    graph[cls.name] = classToJson(cls);
  }
  return graph;
};

export function App(): ReactNode {
  const rendered = useMemo(() => {
    const typeGraph = typeGraphToJson(standardClasses);
    return renderValue(typeGraph);
  }, []);

  return (
    <div className="app">
      <div className="app-header">
        <h1>biblo</h1>
        <span className="app-subtitle">type graph</span>
      </div>
      <div className="app-output">
        <div className="app-render-area">{rendered}</div>
      </div>
    </div>
  );
}

function renderValue(value: unknown): ReactNode {
  const b = biblo();
  const store = nodeStore();

  // Register classes with React render methods layered on
  registerClasses(b, reactClasses);

  // Hydrate: classFor dispatch → instantiate → class's hydrate method
  const root = hydrate(reactKit, b, store, value);

  // Evaluate all expressions to fixpoint
  resolveAll(store, defaultOps, standardOps);

  // Splay: class's render method → recursive dispatch
  return splay(reactKit, b, store, root.id) ?? <em>nothing to render</em>;
}
