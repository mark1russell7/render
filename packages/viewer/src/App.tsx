import { useRef, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { ComponentClass, Biblo, InstanceId } from "@render/biblo";
import { biblo, instantiate } from "@render/biblo";
import { nodeStore, defaultOps, resolveAll, setValue } from "@render/node";
import type { NodeStore } from "@render/node";
import type { MutateFn, AddChildFn } from "@render/splay";
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

  const cells: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(cls.cells)) {
    const cell: Record<string, unknown> = { expr: def.expr };
    if (def.type) cell["type"] = def.type;
    if (def.default !== undefined) cell["default"] = def.default;
    if (def.bindings) cell["bindings"] = def.bindings;
    cells[name] = cell;
  }
  if (Object.keys(cells).length > 0) result["cells"] = cells;

  if (cls.methods) {
    const names = Object.keys(cls.methods);
    if (names.length > 0) result["methods"] = names;
  }

  return result;
};

const typeGraphToJson = (classes: readonly ComponentClass[]): Record<string, unknown> => {
  const graph: Record<string, unknown> = {};
  for (const cls of classes) {
    graph[cls.name] = classToJson(cls);
  }
  return graph;
};

type PersistentState = {
  b: Biblo;
  store: NodeStore;
  rootId: InstanceId;
};

export function App(): ReactNode {
  const stateRef = useRef<PersistentState | null>(null);
  const [, setTick] = useState(0);

  // Initialize once
  if (stateRef.current === null) {
    const b = biblo();
    const store = nodeStore();
    registerClasses(b, reactClasses);
    const typeGraph = typeGraphToJson(standardClasses);
    const root = hydrate(reactKit, b, store, typeGraph);
    resolveAll(store, defaultOps, standardOps);
    stateRef.current = { b, store, rootId: root.id };
  }

  const { b, store, rootId } = stateRef.current;

  // Cell mutation: setValue → reactive flow → re-render
  const mutate: MutateFn = useCallback(
    (instanceId: InstanceId, cellName: string, value: unknown) => {
      const rootNode = store.nodes.get(instanceId);
      if (!rootNode) return;
      const cellNodeId = rootNode.slots.get(cellName);
      if (!cellNodeId) return;
      setValue(store, defaultOps, standardOps, cellNodeId, value);
      setTick((t) => t + 1);
    },
    [store],
  );

  // Structure mutation: instantiate child → resolve → re-render
  const addChildFn: AddChildFn = useCallback(
    (parentId: InstanceId, className: string) => {
      instantiate(b, store, className, parentId);
      resolveAll(store, defaultOps, standardOps);
      setTick((t) => t + 1);
    },
    [b, store],
  );

  const rendered = splay(reactKit, b, store, rootId, mutate, addChildFn);

  return (
    <div className="app">
      <div className="app-header">
        <h1>biblo</h1>
        <span className="app-subtitle">type graph</span>
      </div>
      <div className="app-output">
        <div className="app-render-area">
          {rendered ?? <em>nothing to render</em>}
        </div>
      </div>
    </div>
  );
}
