import { useState, useMemo } from "react";
import type { ReactNode } from "react";
import { biblo, registerClass } from "@render/biblo";
import type { Biblo } from "@render/biblo";
import { nodeStore, defaultOps, resolveAll } from "@render/node";
import type { NodeStore } from "@render/node";
import { standardClasses, standardOps, hydrate, splay } from "@render/splay";
import { reactKit } from "./renderers.js";

const sampleJson = JSON.stringify(
  {
    name: "Alice",
    age: 30,
    active: true,
    tags: ["admin", "user"],
    address: {
      city: "Portland",
      zip: 97201,
    },
  },
  null,
  2,
);

export function App(): ReactNode {
  const [json, setJson] = useState(sampleJson);

  const rendered = useMemo(() => {
    try {
      const value: unknown = JSON.parse(json);
      return renderValue(value);
    } catch (e) {
      return <div className="rv-error">{String(e)}</div>;
    }
  }, [json]);

  return (
    <div className="app">
      <div className="app-input">
        <h2>JSON Input</h2>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="app-output">
        <h2>Rendered</h2>
        <div className="app-render-area">{rendered}</div>
      </div>
    </div>
  );
}

function renderValue(value: unknown): ReactNode {
  // Fresh biblo + store for each render
  const b: Biblo = biblo();
  const store: NodeStore = nodeStore();

  // Register all standard classes
  for (const cls of standardClasses) {
    registerClass(b, cls);
  }

  // Hydrate the value into an instance tree (values passed as bindings)
  const root = hydrate(b, store, value);

  // Evaluate all expressions to fixpoint — propagates bindings through refs
  resolveAll(store, defaultOps, standardOps);

  // Splay into React
  return splay(reactKit, b, store, root.id) ?? <em>nothing to render</em>;
}
