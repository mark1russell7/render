import type { Biblo, InstanceId } from "@render/biblo";
import {
  biblo, classNodeOps, destroyInstance, instantiate, ownerOf, registerClass, registerClasses, registerTrait,
  renameClass, resolveMethods, resolveTraits, updateClass,
} from "@render/biblo";
import type { Ops } from "@render/dsl";
import { lit } from "@render/dsl";
import type { NodeStore } from "@render/node";
import { batch, nodeStore, setValue, valueEquals } from "@render/node";
import type { SplayCache, ViewPolicy } from "@render/splay";
import {
  dehydrate, exprClassFor, hydrate, hydrateAs, invalidateSplay, readCells, rehydrate, replaceValue, splayKit,
  standardClasses, standardOps, standardTraits, textOf,
} from "@render/splay";
import { viewerClasses } from "./classes.ts";
import { atomsToJson, classToJson, reconstructClass, traitsToJson } from "./typegraph.ts";

/** The view of a canvas item: its render, or its data. */
export type ViewMode = "rendered" | "data";

/** A panel of the viewer. Each panel has its own level of detail. */
export type Panel = "types" | "canvas";

/** The summary of the last epoch, for the reactivity proof. */
export type EpochSummary = {
  readonly evaluated: number;
  readonly changed: number;
  /** The number of nodes on a dependency cycle. */
  readonly cyclic: number;
  readonly total: number;
};

/**
 * An action of a person. The session records each action that changes the model. Undo builds the model again
 * and replays the record without the last action. The IDs are deterministic, thus a replay gives the same IDs.
 */
export type Action =
  | { readonly kind: "edit"; readonly id: InstanceId; readonly cell: string; readonly value: unknown }
  | { readonly kind: "add"; readonly parent: InstanceId; readonly className: string }
  | { readonly kind: "replace"; readonly id: InstanceId; readonly value: unknown }
  | { readonly kind: "drop"; readonly className: string }
  | { readonly kind: "remove"; readonly id: InstanceId }
  | { readonly kind: "view"; readonly id: InstanceId }
  | { readonly kind: "reset" };

/**
 * A saved session: the record of the actions, in JSON. The baseline identifies the initial model. A record
 * with another baseline is from another version of the viewer, thus its IDs do not apply.
 */
export type SavedSession = {
  readonly format: "render-session";
  readonly version: 1;
  readonly baseline: string;
  readonly actions: readonly unknown[];
  /** The view: the level of each panel, and the instances that a person expanded or collapsed. */
  readonly view?: SavedView | undefined;
};

/** The view state of a saved session. The IDs are deterministic, thus the choices apply after the replay. */
export type SavedView = {
  readonly levels: Readonly<Record<Panel, number>>;
  readonly expanded: readonly (readonly [InstanceId, boolean])[];
};

/** The default level of detail of each panel. The type graph shows the boundary of each class. */
export const DEFAULT_LEVELS: Readonly<Record<Panel, number>> = { types: 0, canvas: 2 };

/** The kit of hydration. Hydration needs only `classFor` and the standard ops. The atoms of hydrate come from the engine. */
const hydrationKit = splayKit<unknown>(exprClassFor, standardOps);

/** The kit of the atom names: each string becomes a read-only `Label`. */
const labelKit = splayKit<unknown>((v) => (typeof v === "string" ? "Label" : exprClassFor(v)), standardOps);

const builtInNames: ReadonlySet<string> = new Set([...standardClasses, ...viewerClasses].map((c) => c.name));

/** A class name is one or more characters without a space. */
const VALID_NAME = /^\S+$/u;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// === The JSON form of values: JSON has no undefined, NaN or Infinity ===

const SPECIAL = "$render";

/** This function gives a JSON value for a value. A special number or `undefined` becomes a tagged object. */
export const encodeValue = (v: unknown): unknown => {
  if (v === undefined) return { [SPECIAL]: "undefined" };
  if (typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0))) return { [SPECIAL]: Object.is(v, -0) ? "-0" : String(v) };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (isRecord(v)) {
    const out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encodeValue(x)]));
    return Object.hasOwn(v, SPECIAL) ? { [SPECIAL]: "object", value: out } : out;
  }
  return v;
};

const SPECIAL_VALUES: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ["undefined", undefined],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  ["-0", -0],
]);

/** This function reads a value from its JSON form (the inverse of `encodeValue`). */
export const decodeValue = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (!isRecord(v)) return v;
  const tag = v[SPECIAL];
  if (typeof tag === "string" && Object.keys(v).length === 1 && SPECIAL_VALUES.has(tag)) return SPECIAL_VALUES.get(tag);
  const body = tag === "object" && isRecord(v["value"]) ? v["value"] : v;
  return Object.fromEntries(Object.entries(body).map(([k, x]) => [k, decodeValue(x)]));
};

/** This function checks the shape of an action from a saved session. */
const isAction = (a: unknown): a is Action => {
  if (!isRecord(a)) return false;
  const str = (k: string): boolean => typeof a[k] === "string";
  switch (a["kind"]) {
    case "edit": return str("id") && str("cell");
    case "add": return str("parent") && str("className");
    case "replace": return str("id");
    case "drop": return str("className");
    case "remove":
    case "view": return str("id");
    case "reset": return true;
    default: return false;
  }
};

/**
 * The model of the viewer, without React. It holds the biblo, the store and the state of the two panels,
 * and it gives the actions of the user. Each action keeps the store consistent, updates the splay memo and
 * notifies the subscribers. The React view reads it with `useSyncExternalStore`.
 *
 * - The type graph shows one card for each class. An edit in a card changes the class, and the live
 *   instances follow the class (`updateClass`). An edit that gives an invalid class goes back, with a notice.
 *   A new name in a card renames the class (not a standard class).
 * - The canvas holds instances of user classes. An edit of a cell of a user class changes the class too.
 * - The data view of a canvas item shows its dehydrated value. An edit in it goes back to the item.
 * - Each instance with a summary can collapse. The level of each panel gives the default, and a person can
 *   expand or collapse each instance.
 */
export class ViewerSession {
  #b: Biblo = biblo();
  #store: NodeStore = nodeStore();
  readonly #viewOps: Ops;
  /** The splay memo of the view. The session deletes the entries of the instances that change. */
  readonly cache: SplayCache<unknown> = new Map();

  #version = 0;
  readonly #listeners = new Set<() => void>();

  #classesGrid: InstanceId = "";
  #atomsId: InstanceId = "";
  #traitsId: InstanceId = "";
  #searchId: InstanceId = "";
  #cards = new Map<string, InstanceId>();
  readonly #cardOwners = new Map<InstanceId, string>();
  #canvas: InstanceId[] = [];
  readonly #viewModes = new Map<InstanceId, ViewMode>();
  readonly #dataRoots = new Map<InstanceId, InstanceId>();
  #counter = 0;
  #epoch: EpochSummary | null = null;
  #flash: ReadonlySet<InstanceId> = new Set();
  /**
   * The stats before the current action, and the last stats that it read. An action can cause more than one
   * epoch, for example an edit and a class sync.
   */
  #before: object | null = null;
  #seen: object | null = null;
  #notice: string | null = null;
  #classNames: readonly string[] | null = null;

  /** The record of the actions since the start, and the actions that undo removed. */
  #log: Action[] = [];
  #redo: Action[] = [];
  #baseline = "";

  /** The level of detail of each panel, and the choices of the person for single instances. */
  readonly #levels: Record<Panel, number> = { ...DEFAULT_LEVELS };
  readonly #expanded = new Map<InstanceId, boolean>();
  readonly #views: Readonly<Record<Panel, ViewPolicy>>;

  /** The constructor builds the type graph. `viewOps` are the ops of the view, which the type graph lists as atoms. */
  constructor(viewOps: Ops = standardOps) {
    this.#viewOps = viewOps;
    this.#views = { types: this.#policy("types"), canvas: this.#policy("canvas") };
    this.#build();
    this.#baseline = `${String(this.#store.nodes.size)}/${String(this.#b.instances.size)}/${[...this.#b.classes.keys()].join(",")}`;
  }

  // === The snapshot API of useSyncExternalStore ===

  /** This method adds a listener of changes. It gives the function that removes the listener. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  /** This method gives the version of the state. Each action makes it larger. */
  readonly getSnapshot = (): number => this.#version;

  // === Reads ===

  get b(): Biblo { return this.#b; }
  get store(): NodeStore { return this.#store; }
  /** The canvas items, in order. */
  get canvas(): readonly InstanceId[] { return this.#canvas; }
  /** The instance of the search box. Its value is the filter of the type graph. */
  get searchId(): InstanceId { return this.#searchId; }
  /** The text of the search box. */
  get search(): string { return textOf(readCells(this.#store, this.#searchId)["value"]); }
  /** The section of the atoms in the type graph: the ops of the view, by category. */
  get atomsId(): InstanceId { return this.#atomsId; }
  /** The section of the traits in the type graph: the cells that each trait must find, and its methods. */
  get traitsId(): InstanceId { return this.#traitsId; }
  /** The summary of the last epoch, or `null` before the first action. */
  get epoch(): EpochSummary | null { return this.#epoch; }
  /** The instances that the last epoch evaluated, with their ancestors: the flash of the reactivity proof. */
  get flash(): ReadonlySet<InstanceId> { return this.#flash; }
  /** The message of the last refused edit, or `null`. */
  get notice(): string | null { return this.#notice; }
  /** True when an action can go back. */
  get canUndo(): boolean { return this.#log.length > 0; }
  /** True when an undone action can come back. */
  get canRedo(): boolean { return this.#redo.length > 0; }
  /** The identity of the initial model. A saved session applies only to a session with the same baseline. */
  get baseline(): string { return this.#baseline; }

  /**
   * This method gives the class cards, in order: the class name and the instance to render. The instance is the
   * entry of the class in the type graph: its draggable name, then its definition. The search filters the cards.
   */
  cards(): [string, InstanceId][] {
    const filter = this.search.toLowerCase();
    const out: [string, InstanceId][] = [];
    for (const [name, definition] of this.#cards) {
      if (filter !== "" && !name.toLowerCase().includes(filter)) continue;
      out.push([name, this.#b.instances.get(definition)?.scope.parent ?? definition]);
    }
    return out;
  }

  /**
   * This method gives the names of the classes that a person can add: each class but the abstract `Top`.
   * The list is the same array until the next change, thus a React context with it does not change at each render.
   */
  classNames(): readonly string[] {
    this.#classNames ??= [...this.#b.classes.keys()].filter((n) => n !== "Top");
    return this.#classNames;
  }

  /** This method gives the instance of the definition of a class in the type graph. */
  definitionOf(name: string): InstanceId | undefined { return this.#cards.get(name); }

  /** This method gives the view mode of a canvas item. */
  viewMode(id: InstanceId): ViewMode { return this.#viewModes.get(id) ?? "rendered"; }

  /** This method gives the data view of a canvas item, when the item shows its data. */
  dataRoot(id: InstanceId): InstanceId | undefined { return this.#dataRoots.get(id); }

  /** This method tells if a class is a class that a person made (not a standard class or a class of the viewer). */
  isUserClass(name: string): boolean { return this.#b.classes.has(name) && !builtInNames.has(name); }

  /** This method gives the view policy of a panel, for `splay`. The policy is the same object at each call. */
  view(panel: Panel): ViewPolicy { return this.#views[panel]; }

  /** This method gives the level of detail of a panel: the number of levels that show their full view. */
  level(panel: Panel): number { return this.#levels[panel]; }

  // === Level of detail ===

  /**
   * This method sets the level of detail of a panel. The choices of the person for the instances of the panel go,
   * thus the panel shows the new level everywhere.
   */
  setLevel(panel: Panel, level: number): void {
    this.#levels[panel] = Math.max(0, level);
    for (const id of Array.from(this.#expanded.keys())) if (this.#panelOf(id) === panel) this.#expanded.delete(id);
    this.cache.clear();
    this.#emit();
  }

  /** This method expands or collapses one instance. */
  readonly setExpanded = (instanceId: InstanceId, expanded: boolean): void => {
    this.#expanded.set(instanceId, expanded);
    invalidateSplay(this.#b, this.cache, [instanceId]);
    this.#emit();
  };

  // === Actions ===

  /**
   * This method writes a value to a cell. The place of the instance selects the effect. The search box filters.
   * An edit in a card changes its class. An edit of a canvas item of a user class also changes that class.
   * An edit in a data view goes back to its canvas item.
   */
  readonly editCell = (instanceId: InstanceId, cellName: string, value: unknown): void => {
    this.#act({ kind: "edit", id: instanceId, cell: cellName, value });
  };

  /** This method makes a child instance of a class under a parent: a drop on a stack, a grid or the arguments of an op. */
  readonly addChild = (parentId: InstanceId, className: string): void => {
    this.#act({ kind: "add", parent: parentId, className });
  };

  /**
   * This method replaces the value of an instance, with a new subtree: for example a formula edit. A canvas item
   * keeps its class, thus it accepts only a value of its kind. Each other instance gets the class of the new value.
   */
  readonly replace = (instanceId: InstanceId, value: unknown): void => {
    this.#act({ kind: "replace", id: instanceId, value });
  };

  /** This method drops a class on the canvas: it makes a subclass (for example `Text_1`) and an instance of it. */
  dropClass(className: string): InstanceId | undefined {
    return this.#act({ kind: "drop", className }) ? this.#canvas.at(-1) : undefined;
  }

  /** This method removes a canvas item: its instance tree and its data view. Its class stays. */
  removeCanvasItem(id: InstanceId): void {
    this.#act({ kind: "remove", id });
  }

  /** This method switches a canvas item between its render and its data. A data view is built new each time. */
  toggleView(id: InstanceId): void {
    this.#act({ kind: "view", id });
  }

  /** This method starts again with only the standard classes and an empty canvas. Undo brings the old state back. */
  reset(): void {
    this.#act({ kind: "reset" });
  }

  /** This method takes back the last action. */
  undo(): void {
    const last = this.#log.pop();
    if (last === undefined) return;
    this.#redo.push(last);
    this.#replay();
    this.#emit();
  }

  /** This method applies again the last action that undo took back. */
  redo(): void {
    const next = this.#redo.pop();
    if (next === undefined) return;
    if (this.#apply(next)) this.#log.push(next);
    this.#emit();
  }

  /** This method ends the flash of the reactivity proof. */
  clearFlash(): void {
    if (this.#flash.size === 0) return;
    this.#flash = new Set();
    this.#emit();
  }

  /** This method removes the notice. */
  dismissNotice(): void {
    if (this.#notice === null) return;
    this.#notice = null;
    this.#emit();
  }

  // === Save and restore ===

  /** This method gives the session as JSON: the record of its actions, and its view. */
  save(): SavedSession {
    return {
      format: "render-session",
      version: 1,
      baseline: this.#baseline,
      actions: this.#log.map((a) => encodeValue(a)),
      view: { levels: { ...this.#levels }, expanded: [...this.#expanded] },
    };
  }

  /**
   * This method replaces the session with a saved session: it builds the model again and replays the actions.
   * It refuses a value that is not a saved session, and a session of another version of the viewer. An action
   * that is not valid stops the replay, with a notice. The method gives `true` when the replay started.
   */
  restore(saved: unknown): boolean {
    if (!isRecord(saved) || saved["format"] !== "render-session" || saved["version"] !== 1 || !Array.isArray(saved["actions"])) {
      this.#notice = "The file is not a saved session of the viewer.";
      this.#emit();
      return false;
    }
    if (saved["baseline"] !== this.#baseline) {
      this.#notice = "The saved session is from another version of the viewer.";
      this.#emit();
      return false;
    }
    this.#log = [];
    this.#redo = [];
    this.#expanded.clear();
    this.#build();
    let stopped: number | null = null;
    for (const [i, raw] of (saved["actions"] as unknown[]).entries()) {
      const action = decodeValue(raw);
      if (!isAction(action)) {
        stopped = i;
        break;
      }
      if (this.#apply(action)) this.#log.push(action);
    }
    this.#restoreView(saved["view"]);
    this.#epoch = null;
    this.#flash = new Set();
    this.#notice = stopped === null ? null : `The saved session stopped at the action ${String(stopped + 1)}, which is not valid.`;
    this.#emit();
    return true;
  }

  /** This method applies the view of a saved session. It ignores each part that is not valid. */
  #restoreView(view: unknown): void {
    if (!isRecord(view)) return;
    const levels = view["levels"];
    if (isRecord(levels)) {
      for (const panel of ["types", "canvas"] as const) {
        const n = levels[panel];
        if (typeof n === "number" && Number.isFinite(n) && n >= 0) this.#levels[panel] = n;
      }
    }
    const expanded = view["expanded"];
    if (!Array.isArray(expanded)) return;
    for (const entry of expanded as unknown[]) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "boolean" && this.#b.instances.has(entry[0])) {
        this.#expanded.set(entry[0], entry[1]);
      }
    }
  }

  // === Internal: the record of the actions ===

  /** This method applies a new action. A new action removes the actions that undo took back. */
  #act(action: Action): boolean {
    this.#before = this.#store.epochStats;
    this.#seen = null;
    const recorded = this.#apply(action);
    this.#captureEpoch();
    if (recorded) {
      this.#log.push(action);
      this.#redo = [];
    }
    this.#emit();
    return recorded;
  }

  /** This method applies an action. It gives `true` when the action changed the model, thus the record keeps it. */
  #apply(action: Action): boolean {
    switch (action.kind) {
      case "edit": return this.#edit(action.id, action.cell, action.value);
      case "add": return this.#add(action.parent, action.className);
      case "replace": return this.#replace(action.id, action.value);
      case "drop": return this.#drop(action.className);
      case "remove": return this.#remove(action.id);
      case "view": return this.#toggleView(action.id);
      case "reset":
        this.#build();
        return true;
    }
  }

  /** This method builds the model again and replays the record. The search box keeps its text. */
  #replay(): void {
    const search = this.search;
    this.#build();
    for (const action of this.#log) this.#apply(action);
    if (search !== "") this.#write(this.#searchId, "value", search);
    this.#epoch = null;
    this.#flash = new Set();
    this.#notice = null;
  }

  // === Internal: the effects of the actions ===

  #edit(instanceId: InstanceId, cellName: string, value: unknown): boolean {
    const card = this.#cardOf(instanceId);
    const item = card === undefined ? this.#dataItemOf(instanceId) : undefined;
    // The twin of a data instance: the instance of the item with the same place and the same value
    const twin = item === undefined ? undefined : this.#twinOf(item, instanceId);
    const refusal = this.#write(instanceId, cellName, value);
    if (refusal !== null) {
      this.#notice = refusal;
      return false;
    }
    this.#captureEpoch();
    // The filter of the type graph is not a change of the model, thus the record does not keep it
    if (instanceId === this.#searchId) return false;
    if (card !== undefined) this.#syncCard(card);
    else if (item !== undefined) {
      // A value edit goes to the twin, thus the classes of the item stay. Another edit hydrates the data again.
      if (twin !== undefined && this.#write(twin, cellName, value) === null) {
        this.#captureEpoch();
        invalidateSplay(this.#b, this.cache, [twin]);
        this.#syncCanvasCell(twin, cellName, value);
      } else {
        this.#writeBack(item);
      }
    } else if (this.#isOnCanvas(instanceId)) this.#syncCanvasCell(instanceId, cellName, value);
    return true;
  }

  /**
   * This method finds the twin of a data instance in its canvas item. The twin has the same path of child
   * positions from the root, and the same dehydrated value. Without such an instance, it gives `undefined`.
   */
  #twinOf(item: InstanceId, dataId: InstanceId): InstanceId | undefined {
    const root = this.#dataRoots.get(item);
    const path: number[] = [];
    for (let id = dataId, guard = 0; id !== root && guard < 10_000; guard++) {
      const parent = this.#b.instances.get(id)?.scope.parent;
      if (parent === undefined) return undefined;
      path.unshift(this.#b.instances.get(parent)!.scope.children.indexOf(id));
      id = parent;
    }
    let twin = item;
    for (const index of path) {
      const next = this.#b.instances.get(twin)?.scope.children[index];
      if (next === undefined) return undefined;
      twin = next;
    }
    return valueEquals(dehydrate(this.#b, this.#store, twin), dehydrate(this.#b, this.#store, dataId)) ? twin : undefined;
  }

  #add(parentId: InstanceId, className: string): boolean {
    if (!this.#b.instances.has(parentId) || !this.#b.classes.has(className)) return false;
    instantiate(this.#b, this.#store, className, parentId);
    this.#captureEpoch();
    invalidateSplay(this.#b, this.cache, [parentId]);
    const card = this.#cardOf(parentId);
    const item = card === undefined ? this.#dataItemOf(parentId) : undefined;
    if (card !== undefined) this.#syncCard(card);
    else if (item !== undefined) this.#writeBack(item);
    return true;
  }

  #replace(instanceId: InstanceId, value: unknown): boolean {
    const inst = this.#b.instances.get(instanceId);
    if (!inst) return false;
    const card = this.#cardOf(instanceId);
    const item = card === undefined ? this.#dataItemOf(instanceId) : undefined;
    const parentId = inst.scope.parent;
    if (this.#cardOwners.has(instanceId)) {
      // A card keeps its class (ClassDef). The sync of the card refuses a value that is not a class.
      rehydrate(hydrationKit, this.#b, this.#store, instanceId, value);
    } else if (this.#canvas.includes(instanceId)) {
      // A canvas item keeps its class: the class of the new value must be on its extends chain
      const kind = exprClassFor(value);
      if (!this.#extendsChain(inst.classRef).includes(kind)) {
        this.#notice = `The canvas item ${inst.classRef} cannot hold a value of the class ${kind}.`;
        return false;
      }
      rehydrate(hydrationKit, this.#b, this.#store, instanceId, value);
      if (this.#store.nodes.get(instanceId)?.slots.has("value") === true) this.#syncCanvasCell(instanceId, "value", value);
    } else {
      const next = replaceValue(hydrationKit, this.#b, this.#store, instanceId, value);
      if (next !== undefined && next.id !== instanceId) {
        for (const [owner, root] of this.#dataRoots) if (root === instanceId) this.#dataRoots.set(owner, next.id);
        const choice = this.#expanded.get(instanceId);
        if (choice !== undefined) this.#expanded.set(next.id, choice);
      }
    }
    this.#captureEpoch();
    invalidateSplay(this.#b, this.cache, [parentId ?? instanceId]);
    if (card !== undefined) this.#syncCard(card);
    else if (item !== undefined) this.#writeBack(item);
    return true;
  }

  #drop(className: string): boolean {
    if (!this.#b.classes.has(className)) return false;
    let name: string;
    do name = `${className}_${String(++this.#counter)}`;
    while (this.#b.classes.has(name));
    registerClass(this.#b, { name, extends: className, cells: {} });
    const inst = instantiate(this.#b, this.#store, name);
    this.#captureEpoch();
    this.#canvas = [...this.#canvas, inst.id];
    batch(this.#store, () => { this.#showCard(name); });
    return true;
  }

  #remove(id: InstanceId): boolean {
    if (!this.#canvas.includes(id)) return false;
    const dataRoot = this.#dataRoots.get(id);
    batch(this.#store, () => {
      if (dataRoot !== undefined) destroyInstance(this.#b, this.#store, dataRoot);
      destroyInstance(this.#b, this.#store, id);
    });
    this.#dataRoots.delete(id);
    this.#viewModes.delete(id);
    this.#canvas = this.#canvas.filter((c) => c !== id);
    return true;
  }

  #toggleView(id: InstanceId): boolean {
    if (!this.#canvas.includes(id)) return false;
    const next: ViewMode = this.viewMode(id) === "rendered" ? "data" : "rendered";
    this.#viewModes.set(id, next);
    const old = this.#dataRoots.get(id);
    if (old !== undefined) {
      destroyInstance(this.#b, this.#store, old);
      this.#dataRoots.delete(id);
    }
    if (next === "data") this.#dataRoots.set(id, hydrate(hydrationKit, this.#b, this.#store, dehydrate(this.#b, this.#store, id)).id);
    return true;
  }

  // === Internal ===

  /** This method makes the view policy of a panel. */
  #policy(panel: Panel): ViewPolicy {
    return {
      isExpanded: (id, level) => this.#expanded.get(id) ?? level < this.#levels[panel],
      setExpanded: this.setExpanded,
    };
  }

  /** This method deletes the memo entries and the choices of the instances that no longer exist. */
  #prune(): void {
    for (const id of Array.from(this.cache.keys())) if (!this.#b.instances.has(id)) this.cache.delete(id);
    for (const id of Array.from(this.#expanded.keys())) if (!this.#b.instances.has(id)) this.#expanded.delete(id);
  }

  #emit(): void {
    this.#prune();
    this.#classNames = null;
    // The total of the summary is the size of the store at the end of the action
    if (this.#epoch !== null) this.#epoch = { ...this.#epoch, total: this.#store.nodes.size };
    this.#version++;
    // A copy, because a listener can unsubscribe during the loop
    for (const listener of Array.from(this.#listeners)) listener();
  }

  #build(): void {
    this.#b = biblo();
    this.#store = nodeStore({ nodeOps: classNodeOps(this.#b), ops: standardOps });
    this.cache.clear();
    this.#cards = new Map();
    this.#cardOwners.clear();
    this.#viewModes.clear();
    this.#dataRoots.clear();
    this.#canvas = [];
    this.#counter = 0;
    this.#epoch = null;
    this.#flash = new Set();
    this.#notice = null;

    const b = this.#b;
    const store = this.#store;
    registerClasses(b, standardClasses);
    registerClasses(b, viewerClasses);
    for (const trait of standardTraits) registerTrait(b, trait);
    batch(store, () => {
      const root = instantiate(b, store, "Grid");
      const section = (label: string): InstanceId => {
        const kvp = instantiate(b, store, "KeyValuePair", root.id);
        instantiate(b, store, "Label", kvp.id, { value: lit(label) });
        return kvp.id;
      };
      this.#classesGrid = instantiate(b, store, "Grid", section("classes")).id;
      this.#atomsId = section("atoms");
      hydrate(labelKit, b, store, atomsToJson(this.#viewOps), this.#atomsId);
      this.#traitsId = section("traits");
      hydrate(labelKit, b, store, traitsToJson(b.traits.values()), this.#traitsId);
      for (const name of b.classes.keys()) this.#showCard(name);
      // The binding keeps the search box out of the class sync: an edit of the default of Text does not change the filter
      this.#searchId = instantiate(b, store, "Text", undefined, { value: lit("") }).id;
    });
  }

  /** This method shows the card of a class: it replaces the old card, or it adds a card at the end. */
  #showCard(name: string): void {
    const cls = this.#b.classes.get(name);
    if (!cls) return;
    const old = this.#cards.get(name);
    const kvpId = old === undefined ? undefined : this.#b.instances.get(old)?.scope.parent;
    if (old !== undefined) {
      destroyInstance(this.#b, this.#store, old);
      this.#cardOwners.delete(old);
    }
    let parent = kvpId;
    if (parent === undefined || !this.#b.instances.has(parent)) {
      parent = instantiate(this.#b, this.#store, "KeyValuePair", this.#classesGrid).id;
      instantiate(this.#b, this.#store, "ClassName", parent, { value: lit(name) });
    }
    const card = hydrateAs(hydrationKit, this.#b, this.#store, "ClassDef", classToJson(cls), parent).id;
    this.#cards.set(name, card);
    this.#cardOwners.set(card, name);
    this.#showTraits(name);
    invalidateSplay(this.#b, this.cache, [parent]);
  }

  /** This method writes the traits of a class to the chip of its card: the applied traits, then the ambiguous methods. */
  #showTraits(name: string): void {
    const card = this.#cards.get(name);
    const kvp = card === undefined ? undefined : this.#b.instances.get(card)?.scope.parent;
    const chip = kvp === undefined ? undefined : this.#b.instances.get(kvp)?.scope.children[0];
    const slot = chip === undefined ? undefined : this.#store.nodes.get(chip)?.slots.get("traits");
    if (slot === undefined) return;
    const { applied, ambiguous } = resolveTraits(this.#b, name);
    const traits = [...applied.map((t) => t.name), ...ambiguous.map((m) => `ambiguous ${m}`)];
    if (!valueEquals(readCells(this.#store, chip!)["traits"], traits)) {
      setValue(this.#store, slot, traits);
      invalidateSplay(this.#b, this.cache, [chip!]);
    }
  }

  /** This method writes a cell. It gives the reason of a refusal, or `null`. */
  #write(instanceId: InstanceId, cellName: string, value: unknown): string | null {
    const slot = this.#store.nodes.get(instanceId)?.slots.get(cellName);
    if (slot === undefined) return `The instance has no cell ${cellName}.`;
    if ((this.#store.nodes.get(slot)?.slots.size ?? 0) > 0) return `The cell ${cellName} holds an instance, not a value.`;
    setValue(this.#store, slot, value);
    return null;
  }

  /** The root of the instance tree of an instance. */
  #rootOf(instanceId: InstanceId): InstanceId {
    let id = instanceId;
    for (let guard = 0; guard < 10_000; guard++) {
      const parent = this.#b.instances.get(id)?.scope.parent;
      if (parent === undefined) break;
      id = parent;
    }
    return id;
  }

  #panelOf(instanceId: InstanceId): Panel {
    const root = this.#rootOf(instanceId);
    return this.#canvas.includes(root) || [...this.#dataRoots.values()].includes(root) ? "canvas" : "types";
  }

  /** The card of a type-graph instance: the class card that contains it. */
  #cardOf(instanceId: InstanceId): InstanceId | undefined {
    for (let id: InstanceId | undefined = instanceId, guard = 0; id !== undefined && guard < 10_000; guard++) {
      if (this.#cardOwners.has(id)) return id;
      id = this.#b.instances.get(id)?.scope.parent;
    }
    return undefined;
  }

  /** The canvas item of an instance in a data view. */
  #dataItemOf(instanceId: InstanceId): InstanceId | undefined {
    const root = this.#rootOf(instanceId);
    for (const [item, dataRoot] of this.#dataRoots) if (dataRoot === root) return item;
    return undefined;
  }

  #isOnCanvas(instanceId: InstanceId): boolean {
    return this.#canvas.includes(this.#rootOf(instanceId));
  }

  /** The names of a class and of its parents, from the class to the root. */
  #extendsChain(name: string): string[] {
    const chain: string[] = [];
    for (let n: string | undefined = name; n !== undefined && !chain.includes(n); n = this.#b.classes.get(n)?.extends) chain.push(n);
    return chain;
  }

  /**
   * An edit in a card changes its class. A new name renames the class. An invalid class, or a refused name,
   * goes back to the class, with a notice.
   */
  #syncCard(card: InstanceId): void {
    const name = this.#cardOwners.get(card);
    if (name === undefined) return;
    const result = reconstructClass(dehydrate(this.#b, this.#store, card), this.#b.classes.get(name));
    const refusal = !result.ok ? result.reason : result.cls.name === name ? null : this.#rename(name, result.cls.name);
    if (!result.ok || refusal !== null) {
      this.#notice = refusal;
      batch(this.#store, () => { this.#showCard(name); });
      return;
    }
    updateClass(this.#b, this.#store, result.cls);
    this.#invalidateClass(result.cls.name);
  }

  /**
   * This method renames a class, with its card. A standard class keeps its name, because the kits dispatch to it.
   * It gives the reason of a refusal, or `null`.
   */
  #rename(from: string, to: string): string | null {
    if (builtInNames.has(from)) return `A standard class keeps its name (${from}).`;
    if (!VALID_NAME.test(to)) return `The name "${to}" is not a valid class name.`;
    if (this.#b.classes.has(to)) return `A class ${to} exists.`;
    if (!renameClass(this.#b, from, to)) return `The class ${from} cannot have the name ${to}.`;
    this.#cards = new Map([...this.#cards].map(([n, card]) => [n === from ? to : n, card]));
    const card = this.#cards.get(to)!;
    this.#cardOwners.set(card, to);
    const kvp = this.#b.instances.get(card)?.scope.parent;
    const chip = kvp === undefined ? undefined : this.#b.instances.get(kvp)?.scope.children[0];
    if (chip !== undefined) this.#write(chip, "value", to);
    // The cards of the subclasses and of the classes with a typed cell of this class show the new name
    batch(this.#store, () => {
      for (const [n, cls] of this.#b.classes) {
        if (n !== to && (cls.extends === to || Object.values(cls.cells).some((def) => def.type === to))) this.#showCard(n);
      }
    });
    this.cache.clear();
    return null;
  }

  /**
   * This method deletes the memo entries of the instances of a changed class and of its subclasses, with their
   * subtrees and their ancestors. A change of a class can change its summary, thus the levels below its instances.
   * The traits of the class and of its subclasses can change too.
   */
  #invalidateClass(name: string): void {
    const affected = new Set([name]);
    for (let grew = true; grew;) {
      grew = false;
      for (const [n, c] of this.#b.classes) {
        if (c.extends !== undefined && affected.has(c.extends) && !affected.has(n)) {
          affected.add(n);
          grew = true;
        }
      }
    }
    const hit: InstanceId[] = [];
    for (const inst of this.#b.instances.values()) if (affected.has(inst.classRef)) hit.push(inst.id);
    const stack = [...hit];
    while (stack.length > 0) {
      const id = stack.pop()!;
      this.cache.delete(id);
      stack.push(...(this.#b.instances.get(id)?.scope.children ?? []));
    }
    invalidateSplay(this.#b, this.cache, hit);
    for (const n of affected) this.#showTraits(n);
  }

  /** An edit of a cell of a user class on the canvas becomes the new expression of the cell in the class. */
  #syncCanvasCell(instanceId: InstanceId, cellName: string, value: unknown): void {
    const inst = this.#b.instances.get(instanceId);
    if (!inst || !this.isUserClass(inst.classRef)) return;
    const cls = this.#b.classes.get(inst.classRef)!;
    batch(this.#store, () => {
      updateClass(this.#b, this.#store, { ...cls, cells: { ...cls.cells, [cellName]: { expr: lit(value) } } });
      this.#showCard(inst.classRef);
    });
    this.#invalidateClass(inst.classRef);
  }

  /**
   * An edit in the data view of a canvas item goes back to the item. A class with a `value` cell or a hydrate
   * method gets the dehydrated data again (`rehydrate`). A class without them dehydrates to its cells, thus
   * each field of the data goes back to its cell.
   */
  #writeBack(item: InstanceId): void {
    const root = this.#dataRoots.get(item);
    const inst = this.#b.instances.get(item);
    if (root === undefined || !inst) return;
    const value = dehydrate(this.#b, this.#store, root);
    const hasValueCell = this.#store.nodes.get(item)?.slots.has("value") === true;
    if (hasValueCell || resolveMethods(this.#b, inst.classRef)["hydrate"] !== undefined) {
      rehydrate(hydrationKit, this.#b, this.#store, item, value);
      if (hasValueCell) this.#syncCanvasCell(item, "value", value);
    } else if (isRecord(value)) {
      const cells = readCells(this.#store, item);
      for (const [cellName, v] of Object.entries(value)) {
        if (Object.hasOwn(cells, cellName) && !valueEquals(cells[cellName], v) && this.#write(item, cellName, v) === null) {
          this.#syncCanvasCell(item, cellName, v);
        }
      }
    }
    invalidateSplay(this.#b, this.cache, [item]);
  }

  /**
   * This method reads the stats of the last epoch: the summary, the flash and the invalidation of the memo.
   * The epochs of one action add up, thus the summary and the flash of an edit include its class sync.
   */
  #captureEpoch(): void {
    const stats = this.#store.epochStats;
    if (!stats || stats === this.#seen || stats === this.#before) return;
    const first = this.#seen === null;
    this.#seen = stats;
    const before = first || this.#epoch === null ? { evaluated: 0, changed: 0, cyclic: 0 } : this.#epoch;
    this.#epoch = {
      evaluated: before.evaluated + stats.evaluated.size,
      changed: before.changed + stats.changed.size,
      cyclic: before.cyclic + stats.cyclic.size,
      total: stats.total,
    };
    const owners = (ids: Iterable<string>): InstanceId[] => {
      const out: InstanceId[] = [];
      for (const id of ids) {
        const owner = ownerOf(this.#b, this.#store, id);
        if (owner !== undefined) out.push(owner);
      }
      return out;
    };
    invalidateSplay(this.#b, this.cache, owners(stats.changed));
    const flash = new Set<InstanceId>(first ? [] : this.#flash);
    for (const start of owners(stats.evaluated)) {
      for (let id: InstanceId | undefined = start; id !== undefined && !flash.has(id); id = this.#b.instances.get(id)?.scope.parent) {
        flash.add(id);
      }
    }
    this.#flash = flash;
  }
}
