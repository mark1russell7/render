import { useRef, useState, useCallback, useEffect, useLayoutEffect, createElement } from "react";
import type { ReactNode, DragEvent } from "react";
import { Rect, pack } from "@render/pack";
import type { ComponentClass, CellDef, Biblo, InstanceId } from "@render/biblo";
import type { Expr } from "@render/dsl";
import { lit } from "@render/dsl";
import { biblo, instantiate, registerClass } from "@render/biblo";
import { nodeStore, defaultOps, resolveAll, wireSeats, setValue } from "@render/node";
import type { NodeStore } from "@render/node";
import type { MutateFn, AddChildFn } from "@render/splay";
import { registerClasses, hydrate, dehydrate, splay, readCells, standardOps, standardClasses, opCategories } from "@render/splay";
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
  const categorized = new Set<string>();
  const result: Record<string, string[]> = {};

  for (const [category, names] of Object.entries(opCategories)) {
    const matched = names.filter(n => n in ops);
    if (matched.length > 0) result[category] = matched;
    for (const n of matched) categorized.add(n);
  }

  // Anything not in opCategories goes to "view" (output-layer atoms)
  const view = Object.keys(ops).filter(n => !categorized.has(n));
  if (view.length > 0) result["view"] = view;

  return result;
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

/** Read current cell values from an instance's nodes as CellDef records */
const readInstanceCells = (
  store: NodeStore,
  instanceId: InstanceId,
): Record<string, CellDef> => {
  const raw = readCells(store, instanceId);
  const cells: Record<string, CellDef> = {};
  for (const [name, v] of Object.entries(raw)) {
    cells[name] = { expr: lit(v) };
  }
  return cells;
};

/** Write a value to a specific cell on an instance */
const applyMutation = (store: NodeStore, instanceId: InstanceId, cellName: string, value: unknown): void => {
  const rootNode = store.nodes.get(instanceId);
  if (!rootNode) return;
  const cellNodeId = rootNode.slots.get(cellName);
  if (!cellNodeId) return;
  setValue(store, defaultOps, standardOps, cellNodeId, value);
};

type ViewMode = "rendered" | "data";

/**
 * PersistentState lives in a ref because biblo/store are mutable by design.
 * All mutations to this state must be followed by setTick(t => t + 1)
 * to notify React of changes.
 */
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
  searchInstanceId: InstanceId;
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
    const keyVal = readCells(store, keyId)["value"];
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

      const className = readCells(store, nameId)["value"];
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

type PackedItem = { id: string; node: ReactNode };
type PackedPos = { x: number; y: number; w: number; h: number };

const GAP = 4;

function PackedLayout({ items }: { items: PackedItem[] }): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{
    width: number;
    height: number;
    positions: Map<string, PackedPos>;
  } | null>(null);

  // Re-measure when items change
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const children = el.children;
    const rects: Rect<string>[] = [];

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      const id = child.dataset["classId"];
      if (!id) continue;
      const bounds = child.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      const r = new Rect<string>();
      r.id = id;
      r.size.set(bounds.width + GAP, bounds.height + GAP);
      rects.push(r);
    }

    if (rects.length === 0) { setLayout(null); return; }

    const outer = new Rect<string>();
    const panelWidth = el.parentElement?.clientWidth ?? 400;
    outer.size.set(panelWidth, 0);
    outer.fixedWidth = true;
    pack(rects, outer);

    const positions = new Map<string, PackedPos>();
    for (const r of rects) {
      if (r.id != null) {
        positions.set(r.id, {
          x: r.position.x,
          y: r.position.y,
          w: r.size.x - GAP,
          h: r.size.y - GAP,
        });
      }
    }

    setLayout({ width: outer.size.x, height: outer.size.y, positions });
  }, [items]);

  if (!layout) {
    // Measure pass: render items for measurement
    return createElement("div", {
      ref: containerRef,
      style: { visibility: "hidden" as const, position: "absolute" as const, top: 0, left: 0 },
    },
      ...items.map((item) =>
        createElement("div", {
          key: item.id,
          "data-class-id": item.id,
          className: "rv-packed-item",
          style: { display: "inline-block" },
        }, item.node),
      ),
    );
  }

  // Layout pass: position absolutely
  return createElement("div", {
    ref: containerRef,
    className: "rv-packed-container",
    style: { width: layout.width, height: layout.height },
  },
    ...items.map((item) => {
      const pos = layout.positions.get(item.id);
      if (!pos) return null;
      return createElement("div", {
        key: item.id,
        "data-class-id": item.id,
        className: "rv-packed-item",
        style: {
          position: "absolute" as const,
          left: pos.x,
          top: pos.y,
          width: pos.w,
        },
      }, item.node);
    }),
  );
}

export function App(): ReactNode {
  const stateRef = useRef<PersistentState | null>(null);
  const [, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [epochStats, setEpochStats] = useState<{ evaluated: number; total: number } | null>(null);
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(new Set());

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
    const searchInst = instantiate(b, store, "Text");
    wireSeats(store);
    resolveAll(store, defaultOps, standardOps);
    stateRef.current = {
      b, store, typeGraphRootId: root.id, canvasRoots: [],
      viewModes: new Map(), dataRoots: new Map(), typeCounter: 0,
      classInstances: maps.classInstances,
      classRootSet: maps.classRootSet,
      standardClassNames: stdNames,
      searchInstanceId: searchInst.id,
    };
  }

  const { b, store, typeGraphRootId, canvasRoots, viewModes, dataRoots, classRootSet, standardClassNames, searchInstanceId } = stateRef.current;

  // Capture epoch stats after a mutation for the reactivity proof
  const captureEpoch = useCallback(() => {
    if (store.epochStats) {
      setEpochStats({ evaluated: store.epochStats.evaluated.size, total: store.epochStats.total });
      const ids = new Set<string>();
      for (const nodeId of store.epochStats.evaluated) {
        const dot = nodeId.indexOf(".");
        ids.add(dot >= 0 ? nodeId.slice(0, dot) : nodeId);
      }
      setFlashIds(ids);
    }
  }, [store]);

  // Clear flash after animation
  useEffect(() => {
    if (flashIds.size === 0) return;
    const timer = setTimeout(() => { setFlashIds(new Set()); }, 600);
    return () => { clearTimeout(timer); };
  }, [flashIds]);

  // Clean up an instance tree from biblo and store (prevents memory leak)
  const cleanupInstance = useCallback((instanceId: InstanceId) => {
    const inst = b.instances.get(instanceId);
    if (!inst) return;
    // Recurse children first
    for (const childId of inst.scope.children) cleanupInstance(childId);
    // Remove nodes (root + cell slots)
    const rootNode = store.nodes.get(instanceId);
    if (rootNode) {
      for (const [, slotId] of rootNode.slots) store.nodes.delete(slotId);
      store.nodes.delete(instanceId);
    }
    b.instances.delete(instanceId);
  }, [b, store]);

  // Rebuild the type graph display from all registered classes + rebuild maps
  const refreshTypeGraph = useCallback(() => {
    // Clean up old type graph instances before creating new ones
    const state = stateRef.current!;
    cleanupInstance(state.typeGraphRootId);

    const allClasses = Array.from(b.classes.values());
    const typeGraph = {
      classes: typeGraphToJson(allClasses),
      atoms: atomsToJson(reactOps),
    };
    const root = hydrate(reactKit, b, store, typeGraph);
    wireSeats(store);
    resolveAll(store, defaultOps, standardOps);
    state.typeGraphRootId = root.id;
    const maps = buildClassInstanceMap(b, store, root.id);
    state.classInstances = maps.classInstances;
    state.classRootSet = maps.classRootSet;
  }, [b, store, cleanupInstance]);

  // Canvas mutate: edits sync back to user-created class definitions
  const canvasMutate: MutateFn = useCallback(
    (instanceId: InstanceId, cellName: string, value: unknown) => {
      applyMutation(store, instanceId, cellName, value);
      captureEpoch();

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
    [b, store, standardClassNames, refreshTypeGraph, captureEpoch],
  );

  // Type graph mutate: targeted 1-class sync — find owning class, dehydrate just that subtree
  const typeGraphMutate: MutateFn = useCallback(
    (instanceId: InstanceId, cellName: string, value: unknown) => {
      applyMutation(store, instanceId, cellName, value);
      captureEpoch();

      const classRootId = findOwningClassRoot(b, instanceId, classRootSet);
      if (classRootId) {
        const allClasses = Array.from(b.classes.values());
        const cls = extractSingleClass(b, store, classRootId, allClasses);
        if (cls) registerClass(b, cls);
      }

      setTick((t) => t + 1);
    },
    [b, store, classRootSet, captureEpoch],
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

  // Search mutate: updates the filter text when the search Text instance is edited
  const searchMutate: MutateFn = useCallback(
    (instanceId: InstanceId, cellName: string, value: unknown) => {
      applyMutation(store, instanceId, cellName, value);
      captureEpoch();
      setSearch(String(value ?? ""));
      setTick((t) => t + 1);
    },
    [store, captureEpoch],
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

  // Search: a Text instance splayed with the system's own rendering
  const searchRendered = splay(editableKit, b, store, searchInstanceId, searchMutate);

  // Type graph: per-class splay for packed layout, filtered by search
  const searchLower = search.toLowerCase();
  const classItems: PackedItem[] = [];
  for (const [className, defId] of stateRef.current.classInstances) {
    if (searchLower && !className.toLowerCase().includes(searchLower)) continue;
    const node = splay(editableKit, b, store, defId, typeGraphMutate, addChildFn);
    if (node) classItems.push({ id: className, node });
  }

  // Also splay the full type graph for atoms section (find "atoms" KVP)
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

    const flashing = flashIds.has(id);

    return (
      <div key={id} className={`canvas-item${flashing ? " rv-flash" : ""}`}>
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
          <span className="biblo-search">{searchRendered}</span>
        </div>
        <div className="panel-body">
          {classItems.length > 0
            ? <PackedLayout items={classItems} />
            : typeGraphRendered ?? <em>nothing</em>}
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
          {epochStats && (
            <span className="epoch-stats">
              {epochStats.evaluated} / {epochStats.total} nodes
            </span>
          )}
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
