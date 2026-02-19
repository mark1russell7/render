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
  classInstances: Map<string, InstanceId>;
  classRootSet: Set<InstanceId>;
  standardClassNames: Set<string>;
};

/** Read a cell value from a specific instance in the store */
const readCellValue = (store: NodeStore, instanceId: InstanceId, cellName: string): unknown => {
  const rootNode = store.nodes.get(instanceId);
  if (!rootNode) return undefined;
  const slotId = rootNode.slots.get(cellName);
  if (!slotId) return undefined;
  const slotNode = store.nodes.get(slotId);
  if (slotNode && slotNode.value.tag === "some") return slotNode.value.value;
  return undefined;
};

/**
 * Walk the hydrated type graph instance tree to build a map from
 * class names to their definition Grid instance IDs.
 *
 * Structure: Root Grid → KVP children → "classes" KVP → value Grid → KVP per class
 * Each class KVP: child[0] = Text (class name), child[1] = Grid (class def)
 */
const buildClassInstanceMap = (
  b: Biblo,
  store: NodeStore,
  typeGraphRootId: InstanceId,
): { classInstances: Map<string, InstanceId>; classRootSet: Set<InstanceId> } => {
  const classInstances = new Map<string, InstanceId>();
  const classRootSet = new Set<InstanceId>();

  const rootInst = b.instances.get(typeGraphRootId);
  if (!rootInst || rootInst.classRef !== "Grid") return { classInstances, classRootSet };

  // Find the "classes" KVP among root's children
  for (const kvpId of rootInst.scope.children) {
    const kvp = b.instances.get(kvpId);
    if (!kvp || kvp.classRef !== "KeyValuePair") continue;

    // First child is the key (Text), second is the value
    const keyId = kvp.scope.children[0];
    if (!keyId) continue;
    const keyVal = readCellValue(store, keyId, "value");
    if (keyVal !== "classes") continue;

    // Found "classes" KVP — its second child is the classes Grid
    const classesGridId = kvp.scope.children[1];
    if (!classesGridId) break;
    const classesGrid = b.instances.get(classesGridId);
    if (!classesGrid || classesGrid.classRef !== "Grid") break;

    // Each child of classesGrid is a KVP: key = class name, value = class def Grid
    for (const classKvpId of classesGrid.scope.children) {
      const classKvp = b.instances.get(classKvpId);
      if (!classKvp || classKvp.classRef !== "KeyValuePair") continue;

      const nameId = classKvp.scope.children[0];
      const defId = classKvp.scope.children[1];
      if (!nameId || !defId) continue;

      const className = readCellValue(store, nameId, "value");
      if (typeof className === "string") {
        classInstances.set(className, defId);
        classRootSet.add(defId);
      }
    }
    break;
  }

  return { classInstances, classRootSet };
};

/**
 * Walk scope.parent chain to find the owning class definition root.
 * Returns the class root InstanceId or undefined if outside classes section.
 */
const findOwningClassRoot = (
  b: Biblo,
  instanceId: InstanceId,
  classRootSet: Set<InstanceId>,
): InstanceId | undefined => {
  let current = instanceId;
  const visited = new Set<InstanceId>();
  while (current) {
    if (classRootSet.has(current)) return current;
    if (visited.has(current)) return undefined;
    visited.add(current);
    const inst = b.instances.get(current);
    if (!inst || !inst.scope.parent) return undefined;
    current = inst.scope.parent;
  }
  return undefined;
};

/**
 * Dehydrate one class definition subtree and reconstruct the ComponentClass.
 * Returns the class name along with the reconstructed class.
 */
const extractSingleClass = (
  b: Biblo,
  store: NodeStore,
  classRootId: InstanceId,
  originals: readonly ComponentClass[],
): ComponentClass | undefined => {
  const json = dehydrate(b, store, classRootId);
  if (json == null || typeof json !== "object" || Array.isArray(json)) return undefined;
  return reconstructClass(json as Record<string, unknown>, originals);
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
    const stdNames = new Set(standardClasses.map((c) => c.name));
    const maps = buildClassInstanceMap(b, store, root.id);
    stateRef.current = {
      b, store, typeGraphRootId: root.id, canvasRoots: [],
      viewModes: new Map(), dataRoots: new Map(), typeCounter: 0,
      classInstances: maps.classInstances,
      classRootSet: maps.classRootSet,
      standardClassNames: stdNames,
    };
  }

  const { b, store, typeGraphRootId, canvasRoots, viewModes, dataRoots, classRootSet, standardClassNames } = stateRef.current;

  // Rebuild the type graph display from all registered classes + rebuild maps
  const refreshTypeGraph = useCallback(() => {
    const allClasses = Array.from(b.classes.values());
    const typeGraph = {
      classes: typeGraphToJson(allClasses),
      atoms: atomsToJson(reactOps),
    };
    const root = hydrate(reactKit, b, store, typeGraph);
    wireSeats(store);
    resolveAll(store, defaultOps, standardOps);
    const state = stateRef.current!;
    state.typeGraphRootId = root.id;
    const maps = buildClassInstanceMap(b, store, root.id);
    state.classInstances = maps.classInstances;
    state.classRootSet = maps.classRootSet;
  }, [b, store]);

  // Canvas mutate: edits sync back to user-created class definitions
  const canvasMutate: MutateFn = useCallback(
    (instanceId: InstanceId, cellName: string, value: unknown) => {
      const rootNode = store.nodes.get(instanceId);
      if (!rootNode) return;
      const cellNodeId = rootNode.slots.get(cellName);
      if (!cellNodeId) return;
      setValue(store, defaultOps, standardOps, cellNodeId, value);

      // If this instance belongs to a user-created class, update the class defaults
      const inst = b.instances.get(instanceId);
      if (inst && !standardClassNames.has(inst.classRef)) {
        const cells = readInstanceCells(store, instanceId);
        const currentClass = b.classes.get(inst.classRef);
        if (currentClass) {
          registerClass(b, { ...currentClass, cells });
          refreshTypeGraph();
        }
      }

      setTick((t) => t + 1);
    },
    [b, store, standardClassNames, refreshTypeGraph],
  );

  // Type graph mutate: targeted 1-class sync — find owning class, dehydrate just that subtree
  const typeGraphMutate: MutateFn = useCallback(
    (instanceId: InstanceId, cellName: string, value: unknown) => {
      const rootNode = store.nodes.get(instanceId);
      if (!rootNode) return;
      const cellNodeId = rootNode.slots.get(cellName);
      if (!cellNodeId) return;
      setValue(store, defaultOps, standardOps, cellNodeId, value);

      const classRootId = findOwningClassRoot(b, instanceId, classRootSet);
      if (classRootId) {
        const allClasses = Array.from(b.classes.values());
        const cls = extractSingleClass(b, store, classRootId, allClasses);
        if (cls) registerClass(b, cls);
      }

      setTick((t) => t + 1);
    },
    [b, store, classRootSet],
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

      // Auto-create a named subclass
      const state = stateRef.current!;
      state.typeCounter++;
      const subName = `${className}_${state.typeCounter}`;
      registerClass(b, { name: subName, extends: className, cells: {} });

      const inst = instantiate(b, store, subName);
      wireSeats(store);
      resolveAll(store, defaultOps, standardOps);
      canvasRoots.push(inst.id);
      refreshTypeGraph();
      setTick((t) => t + 1);
    },
    [b, store, canvasRoots, refreshTypeGraph],
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

  // Type graph: editable, edits re-register class definitions
  const typeGraphRendered = splay(editableKit, b, store, typeGraphRootId, typeGraphMutate, addChildFn);

  // Canvas: editable, with view toggle — edits auto-sync to user-created classes
  const canvasItems = canvasRoots.map((id) => {
    const inst = b.instances.get(id);
    const mode = viewModes.get(id) ?? "rendered";

    let content: ReactNode;
    if (mode === "data") {
      const dataRootId = dataRoots.get(id);
      content = dataRootId
        ? splay(editableKit, b, store, dataRootId, canvasMutate, addChildFn) ?? <em>empty</em>
        : <em>no data</em>;
    } else {
      content = splay(editableKit, b, store, id, canvasMutate, addChildFn) ?? <em>empty</em>;
    }

    return (
      <div key={id} className="canvas-item">
        <div className="canvas-item-header">
          <span>{inst?.classRef ?? id}</span>
          <button className="view-toggle" onClick={() => { toggleView(id); }}>
            {mode === "rendered" ? "data" : "rendered"}
          </button>
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
