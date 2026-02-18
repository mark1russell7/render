import { useRef, useState, useCallback } from "react";
import type { ReactNode, DragEvent } from "react";
import type { ComponentClass, Biblo, InstanceId } from "@render/biblo";
import { biblo, instantiate } from "@render/biblo";
import { nodeStore, defaultOps, resolveAll, setValue } from "@render/node";
import type { NodeStore } from "@render/node";
import type { MutateFn, AddChildFn } from "@render/splay";
import { registerClasses, hydrate, splay, standardOps, standardClasses } from "@render/splay";
import { reactKit, editableKit } from "./renderers.js";

/**
 * Serialize a ComponentClass to JSON.
 * Methods that are Expr trees serialize fully (they're data).
 * Methods that are functions serialize as just their names.
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
    const methods: Record<string, unknown> = {};
    for (const [name, method] of Object.entries(cls.methods)) {
      if (method != null && typeof method === "object" && "tag" in method) {
        // Expr tree — serialize fully (it's transparent data)
        methods[name] = method;
      } else if (typeof method === "function") {
        // Function — just show the name (it's an atom)
        methods[name] = `[atom: ${name}]`;
      }
    }
    if (Object.keys(methods).length > 0) result["methods"] = methods;
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
  typeGraphRootId: InstanceId;
  canvasRoots: InstanceId[];
};

export function App(): ReactNode {
  const stateRef = useRef<PersistentState | null>(null);
  const [, setTick] = useState(0);

  if (stateRef.current === null) {
    const b = biblo();
    const store = nodeStore();
    // Register standard classes — their render methods are Expr trees now
    registerClasses(b, standardClasses);
    const typeGraph = typeGraphToJson(standardClasses);
    const root = hydrate(reactKit, b, store, typeGraph);
    resolveAll(store, defaultOps, standardOps);
    stateRef.current = { b, store, typeGraphRootId: root.id, canvasRoots: [] };
  }

  const { b, store, typeGraphRootId, canvasRoots } = stateRef.current;

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

  const addChildFn: AddChildFn = useCallback(
    (parentId: InstanceId, className: string) => {
      instantiate(b, store, className, parentId);
      resolveAll(store, defaultOps, standardOps);
      setTick((t) => t + 1);
    },
    [b, store],
  );

  const onCanvasDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const className = e.dataTransfer.getData("text/x-classname");
      if (!className) return;
      const inst = instantiate(b, store, className);
      resolveAll(store, defaultOps, standardOps);
      canvasRoots.push(inst.id);
      setTick((t) => t + 1);
    },
    [b, store, canvasRoots],
  );

  const onCanvasDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes("text/x-classname")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  // Type graph: read-only, uses reactKit (no mutation callbacks)
  const typeGraphRendered = splay(reactKit, b, store, typeGraphRootId);

  // Canvas: editable, uses editableKit with mutation callbacks
  const canvasItems = canvasRoots.map((id) => {
    const inst = b.instances.get(id);
    const rendered = splay(editableKit, b, store, id, mutate, addChildFn);
    return (
      <div key={id} className="canvas-item">
        <div className="canvas-item-header">{inst?.classRef ?? id}</div>
        {rendered ?? <em>empty</em>}
      </div>
    );
  });

  return (
    <div className="app">
      <div className="panel panel-types">
        <div className="panel-header">
          <h2>biblo</h2>
          <span className="panel-subtitle">type graph</span>
        </div>
        <div className="panel-body">
          {typeGraphRendered ?? <em>nothing</em>}
        </div>
      </div>
      <div
        className="panel panel-canvas"
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
      >
        <div className="panel-header">
          <h2>canvas</h2>
          <span className="panel-subtitle">drag types here</span>
        </div>
        <div className="panel-body">
          {canvasItems.length > 0
            ? <div className="canvas-items">{canvasItems}</div>
            : <div className="canvas-empty">drag a type from the graph to create an instance</div>}
        </div>
      </div>
    </div>
  );
}
