import { useRef, useState, useCallback } from "react";
import type { ReactNode, DragEvent } from "react";
import type { ComponentClass, CellDef, Biblo, InstanceId } from "@render/biblo";
import type { Expr } from "@render/dsl";
import { lit } from "@render/dsl";
import { biblo, instantiate, registerClass } from "@render/biblo";
import { nodeStore, defaultOps, resolveAll, wireSeats, setValue } from "@render/node";
import type { NodeStore } from "@render/node";
import type { MutateFn, AddChildFn } from "@render/splay";
import { registerClasses, hydrate, dehydrate, splay, standardOps, standardClasses } from "@render/splay";
import { reactKit, editableKit, reactOps } from "./renderers.js";

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

/** Build the atoms registry as browsable data, categorized */
const atomsToJson = (ops: Record<string, unknown>): Record<string, unknown> => {
  const allNames = Object.keys(ops);
  const mathSet = new Set(["+", "-", "*", "/", "max", "min"]);
  const measureSet = new Set(["textWidth", "textHeight"]);
  const viewSet = new Set(["element", "stack", "kvp", "grid", "textView", "numView", "boolView"]);

  const math: string[] = [];
  const measure: string[] = [];
  const view: string[] = [];
  const data: string[] = [];

  for (const name of allNames) {
    if (mathSet.has(name)) math.push(name);
    else if (measureSet.has(name)) measure.push(name);
    else if (viewSet.has(name)) view.push(name);
    else data.push(name);
  }
  return { data, math, measure, view };
};

/**
 * Reconstruct a ComponentClass from dehydrated type graph JSON.
 * Preserves function atoms from the original class definitions.
 * Expr-based methods (render) round-trip naturally through hydrate/dehydrate.
 */
const reconstructClass = (
  json: Record<string, unknown>,
  originals: readonly ComponentClass[],
): ComponentClass | undefined => {
  const name = json["name"];
  if (typeof name !== "string") return undefined;

  const original = originals.find((c) => c.name === name);
  const ext = json["extends"] as string | undefined;

  // Reconstruct cells
  const cells: Record<string, CellDef> = {};
  const cellsJson = json["cells"];
  if (cellsJson != null && typeof cellsJson === "object" && !Array.isArray(cellsJson)) {
    for (const [cellName, cellDef] of Object.entries(cellsJson as Record<string, unknown>)) {
      if (cellDef == null || typeof cellDef !== "object") continue;
      const cd = cellDef as Record<string, unknown>;
      cells[cellName] = {
        expr: cd["expr"] as Expr,
        ...(typeof cd["type"] === "string" ? { type: cd["type"] } : {}),
        ...(cd["default"] !== undefined ? { default: cd["default"] } : {}),
        ...(cd["bindings"] ? { bindings: cd["bindings"] as Readonly<Record<string, Expr>> } : {}),
      };
    }
  }

  // Reconstruct methods — preserve function atoms from originals
  const methods: Record<string, unknown> = {};
  const methodsJson = json["methods"];
  if (methodsJson != null && typeof methodsJson === "object" && !Array.isArray(methodsJson)) {
    for (const [methodName, methodVal] of Object.entries(methodsJson as Record<string, unknown>)) {
      if (typeof methodVal === "string" && methodVal.startsWith("[atom: ")) {
        // Function atom — look up from original class
        const origMethod = original?.methods?.[methodName];
        if (origMethod) methods[methodName] = origMethod;
      } else {
        // Expr tree or other data — use directly
        methods[methodName] = methodVal;
      }
    }
  }

  return {
    name,
    cells,
    ...(ext ? { extends: ext } : {}),
    ...(Object.keys(methods).length > 0 ? { methods } : {}),
  };
};

/** Read current cell values from an instance's nodes */
const readInstanceCells = (
  store: NodeStore,
  instanceId: InstanceId,
): Record<string, CellDef> => {
  const cells: Record<string, CellDef> = {};
  const rootNode = store.nodes.get(instanceId);
  if (!rootNode) return cells;
  for (const [name, slotId] of rootNode.slots) {
    const slotNode = store.nodes.get(slotId);
    if (slotNode && slotNode.value.tag === "some") {
      const v = slotNode.value.value;
      cells[name] = { expr: lit(v), default: v };
    }
  }
  return cells;
};

type ViewMode = "rendered" | "data";

type PersistentState = {
  b: Biblo;
  store: NodeStore;
  typeGraphRootId: InstanceId;
  canvasRoots: InstanceId[];
  viewModes: Map<InstanceId, ViewMode>;
  dataRoots: Map<InstanceId, InstanceId>;
  typeCounter: number;
};

export function App(): ReactNode {
  const stateRef = useRef<PersistentState | null>(null);
  const [, setTick] = useState(0);

  if (stateRef.current === null) {
    const b = biblo();
    const store = nodeStore();
    registerClasses(b, standardClasses);
    const typeGraph = {
      classes: typeGraphToJson(standardClasses),
      atoms: atomsToJson(reactOps),
    };
    const root = hydrate(reactKit, b, store, typeGraph);
    wireSeats(store);
    resolveAll(store, defaultOps, standardOps);
    stateRef.current = {
      b, store, typeGraphRootId: root.id, canvasRoots: [],
      viewModes: new Map(), dataRoots: new Map(), typeCounter: 0,
    };
  }

  const { b, store, typeGraphRootId, canvasRoots, viewModes, dataRoots } = stateRef.current;

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

  // Type graph mutate: edits cell value, then dehydrates → reconstructs → re-registers classes
  const typeGraphMutate: MutateFn = useCallback(
    (instanceId: InstanceId, cellName: string, value: unknown) => {
      const rootNode = store.nodes.get(instanceId);
      if (!rootNode) return;
      const cellNodeId = rootNode.slots.get(cellName);
      if (!cellNodeId) return;
      setValue(store, defaultOps, standardOps, cellNodeId, value);

      const tg = dehydrate(b, store, typeGraphRootId) as Record<string, unknown> | undefined;
      const classesJson = tg?.["classes"];
      if (classesJson != null && typeof classesJson === "object" && !Array.isArray(classesJson)) {
        for (const classJson of Object.values(classesJson as Record<string, unknown>)) {
          if (classJson == null || typeof classJson !== "object") continue;
          const cls = reconstructClass(classJson as Record<string, unknown>, standardClasses);
          if (cls) registerClass(b, cls);
        }
      }

      setTick((t) => t + 1);
    },
    [b, store, typeGraphRootId],
  );

  const addChildFn: AddChildFn = useCallback(
    (parentId: InstanceId, className: string) => {
      instantiate(b, store, className, parentId);
      wireSeats(store);
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
      wireSeats(store);
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

  const toggleView = useCallback(
    (id: InstanceId) => {
      const current = viewModes.get(id) ?? "rendered";
      const next: ViewMode = current === "rendered" ? "data" : "rendered";
      viewModes.set(id, next);

      if (next === "data") {
        const inst = b.instances.get(id);
        if (inst) {
          const dehydrated = dehydrate(b, store, id);
          const structData: Record<string, unknown> = {
            class: inst.classRef,
            value: dehydrated,
          };
          if (inst.scope.children.length > 0) {
            structData["children"] = inst.scope.children.map((childId) => {
              const child = b.instances.get(childId);
              return child ? `${child.classRef}:${childId}` : childId;
            });
          }
          const dataRoot = hydrate(reactKit, b, store, structData);
          wireSeats(store);
          resolveAll(store, defaultOps, standardOps);
          dataRoots.set(id, dataRoot.id);
        }
      }

      setTick((t) => t + 1);
    },
    [b, store, viewModes, dataRoots],
  );

  // Rebuild the type graph display from all registered classes
  const refreshTypeGraph = useCallback(() => {
    const allClasses = Array.from(b.classes.values());
    const typeGraph = {
      classes: typeGraphToJson(allClasses),
      atoms: atomsToJson(reactOps),
    };
    const root = hydrate(reactKit, b, store, typeGraph);
    wireSeats(store);
    resolveAll(store, defaultOps, standardOps);
    stateRef.current!.typeGraphRootId = root.id;
  }, [b, store]);

  // Save a canvas instance as a new type — reads current cell values as defaults
  const saveAsType = useCallback(
    (id: InstanceId) => {
      const inst = b.instances.get(id);
      if (!inst) return;

      const state = stateRef.current!;
      state.typeCounter++;
      const name = `${inst.classRef}_${state.typeCounter}`;

      // Capture current cell values as the new class's defaults
      const cells = readInstanceCells(store, id);

      registerClass(b, { name, extends: inst.classRef, cells });
      refreshTypeGraph();
      setTick((t) => t + 1);
    },
    [b, store, refreshTypeGraph],
  );

  // Type graph: editable, edits re-register class definitions
  const typeGraphRendered = splay(editableKit, b, store, typeGraphRootId, typeGraphMutate, addChildFn);

  // Canvas: editable, with view toggle and save-as-type
  const canvasItems = canvasRoots.map((id) => {
    const inst = b.instances.get(id);
    const mode = viewModes.get(id) ?? "rendered";

    let content: ReactNode;
    if (mode === "data") {
      const dataRootId = dataRoots.get(id);
      content = dataRootId
        ? splay(editableKit, b, store, dataRootId, mutate, addChildFn) ?? <em>empty</em>
        : <em>no data</em>;
    } else {
      content = splay(editableKit, b, store, id, mutate, addChildFn) ?? <em>empty</em>;
    }

    return (
      <div key={id} className="canvas-item">
        <div className="canvas-item-header">
          <span>{inst?.classRef ?? id}</span>
          <span className="canvas-item-actions">
            <button className="view-toggle" onClick={() => { toggleView(id); }}>
              {mode === "rendered" ? "data" : "rendered"}
            </button>
            <button className="save-type-btn" onClick={() => { saveAsType(id); }}>
              save type
            </button>
          </span>
        </div>
        {content}
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
