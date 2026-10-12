import type { Biblo, InstanceId } from "@mark1russell7/render-biblo";
import {
  biblo, classNodeOps, destroyInstance, forkBiblo, instantiate, moveChild, ownerOf, registerClass, registerClasses, registerTrait,
  renameClass, resolveMethods, resolveTraits, updateClass,
} from "@mark1russell7/render-biblo";
import type { Ops } from "@mark1russell7/render-dsl";
import { lit } from "@mark1russell7/render-dsl";
import type { NodeStore } from "@mark1russell7/render-node";
import { batch, forkStore, nodeStore, setValue, valueEquals } from "@mark1russell7/render-node";
import type { SplayCache, ViewPolicy } from "@mark1russell7/render-splay";
import {
  dehydrate, exprClassFor, hydrate, hydrateAs, invalidateSplay, readCells, rehydrate, replaceValue, splayKit,
  standardClasses, standardOps, standardTraits, textOf,
} from "@mark1russell7/render-splay";
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
  | { readonly kind: "delete"; readonly id: InstanceId }
  | { readonly kind: "move"; readonly id: InstanceId; readonly index: number }
  | { readonly kind: "drop"; readonly className: string }
  | { readonly kind: "remove"; readonly id: InstanceId }
  | { readonly kind: "view"; readonly id: InstanceId }
  | { readonly kind: "reset" };

/**
 * The root of a place. A root is the entry of a class in the type graph (its name and its card), or a canvas
 * item or its data view (by position). The search box and the type graph are roots too.
 */
export type PlaceRoot =
  | { readonly in: "card"; readonly name: string }
  | { readonly in: "canvas" | "data"; readonly index: number }
  | { readonly in: "search" | "types" };

/**
 * The place of an instance, without its ID: its root, the positions of the children from the root, and its
 * class. Another version of the viewer can give other IDs, but the places stay. A replay refuses a place whose
 * instance has another class.
 */
export type Place = {
  readonly root: PlaceRoot;
  readonly path: readonly number[];
  readonly classRef: string;
};

/**
 * A saved session: the record of the actions, in JSON. Each action keeps the place of its instance (`at`),
 * thus the record applies to another version of the viewer. The baseline identifies the initial model. A
 * record of version 1 has no places, thus it applies only to a viewer with the same baseline.
 */
export type SavedSession = {
  readonly format: "render-session";
  readonly version: 2;
  readonly baseline: string;
  readonly actions: readonly unknown[];
  /** The view: the level of each panel, and the instances that a person expanded or collapsed. */
  readonly view?: SavedView | undefined;
};

/** The view state of a saved session: the level of each panel, and the choices of the person, by place. */
export type SavedView = {
  readonly levels: Readonly<Record<Panel, number>>;
  readonly expanded: readonly (readonly [Place, boolean])[];
};

/**
 * The result of a restore. `complete`: each action applied. `partial`: an action did not apply, thus the
 * replay stopped before it. `refused`: the value is not a saved session that applies to this viewer.
 */
export type RestoreResult = "complete" | "partial" | "refused";

/**
 * An action in the record, with the place of its instance before the action. A joined action is part of the
 * step of the action before it: undo and redo take the full step. An import is one step.
 */
type Entry = { readonly action: Action; readonly place: Place | undefined; readonly joined?: boolean };

/** This function gives the JSON form of an entry: the action, with its place (`at`) and its step (`joined`). */
const encodeEntry = ({ action, place, joined }: Entry): unknown =>
  encodeValue({ ...action, ...(place === undefined ? {} : { at: place }), ...(joined === true ? { joined } : {}) });

/** The parts of a saved session that a replay reads. */
type SavedRecord = { readonly actions: readonly unknown[]; readonly view: unknown; readonly byPlace: boolean };

/** The number of recorded actions between two checkpoints of the model. */
export const CHECKPOINT_EVERY = 25;

/** The maximum number of checkpoints. A new checkpoint over the limit removes the oldest one. */
const MAX_CHECKPOINTS = 40;

/**
 * The model of a session: the biblo, the store, and the places of the panels in them. A checkpoint is a copy of
 * the model after some actions. Undo copies the nearest checkpoint and replays only the actions after it.
 */
type Model = {
  readonly b: Biblo;
  readonly store: NodeStore;
  readonly classesGrid: InstanceId;
  readonly atomsId: InstanceId;
  readonly traitsId: InstanceId;
  readonly searchId: InstanceId;
  readonly cards: ReadonlyMap<string, InstanceId>;
  readonly cardOwners: ReadonlyMap<InstanceId, string>;
  readonly canvas: readonly InstanceId[];
  readonly viewModes: ReadonlyMap<InstanceId, ViewMode>;
  readonly dataRoots: ReadonlyMap<InstanceId, InstanceId>;
  readonly counter: number;
};

/** This function gives an independent copy of a model. The copy of the store gets the class semantics of the copy of the biblo. */
const forkModel = (m: Model): Model => {
  const b = forkBiblo(m.b);
  return {
    ...m,
    b,
    store: forkStore(m.store, { nodeOps: classNodeOps(b) }),
    cards: new Map(m.cards),
    cardOwners: new Map(m.cardOwners),
    canvas: [...m.canvas],
    viewModes: new Map(m.viewModes),
    dataRoots: new Map(m.dataRoots),
  };
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
    case "replace":
    case "delete": return str("id");
    case "move": return str("id") && typeof a["index"] === "number";
    case "drop": return str("className");
    case "remove":
    case "view": return str("id");
    case "reset": return true;
    default: return false;
  }
};

/** This function gives the instance of an action, or `undefined` for an action without one. */
const targetOf = (a: Action): InstanceId | undefined => (a.kind === "add" ? a.parent : "id" in a ? a.id : undefined);

/** This function gives a copy of an action for another instance. */
const withTarget = (a: Action, id: InstanceId): Action => (a.kind === "add" ? { ...a, parent: id } : "id" in a ? { ...a, id } : a);

/** This function checks the shape of a place from a saved session. */
const isPlace = (p: unknown): p is Place => {
  if (!isRecord(p) || typeof p["classRef"] !== "string" || !Array.isArray(p["path"])) return false;
  if (!(p["path"] as unknown[]).every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)) return false;
  const root = p["root"];
  if (!isRecord(root)) return false;
  switch (root["in"]) {
    case "card": return typeof root["name"] === "string";
    case "canvas":
    case "data": return Number.isInteger(root["index"]);
    case "search":
    case "types": return true;
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
  #log: Entry[] = [];
  #redo: Entry[] = [];
  /** The copies of the model, each after `CHECKPOINT_EVERY` more recorded actions, from the oldest to the newest. */
  #checkpoints: { readonly length: number; readonly model: Model }[] = [];
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

  /**
   * The biblo of the model, to read. A change outside the actions is not in the record. Thus undo, redo and a
   * saved session do not have that change.
   */
  get b(): Biblo { return this.#b; }
  /** The store of the model, to read. A change outside the actions is not in the record. */
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
  /** The identity of the initial model. A saved session of version 1 applies only to a session with the same baseline. */
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

  /**
   * This method removes a child instance from its parent: an item of a stack, a field of a grid or an argument
   * of an op. It refuses an instance in a cell, and the root of a canvas item, a card or a data view. It also
   * refuses the type graph outside the cards.
   */
  readonly removeChild = (instanceId: InstanceId): void => {
    this.#act({ kind: "delete", id: instanceId });
  };

  /** This method moves a child instance to a position among the children of its parent. It has the limits of `removeChild`. */
  readonly moveChild = (instanceId: InstanceId, index: number): void => {
    this.#act({ kind: "move", id: instanceId, index });
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

  /** This method takes back the last step: one action, or a full import. */
  undo(): void {
    if (this.#log.length === 0) return;
    let last: Entry | undefined;
    do {
      last = this.#log.pop();
      if (last !== undefined) this.#redo.push(last);
    } while (last?.joined === true);
    this.#checkpoints = this.#checkpoints.filter((c) => c.length <= this.#log.length);
    this.#replay();
    this.#emit();
  }

  /** This method applies again the last step that undo took back. */
  redo(): void {
    if (this.#redo.length === 0) return;
    for (let next = this.#redo.pop(); next !== undefined; next = this.#redo.at(-1)?.joined === true ? this.#redo.pop() : undefined) {
      if (this.#apply(next.action)) {
        this.#log.push(next);
        this.#checkpoint();
      }
    }
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

  /** This method gives the session as JSON: the record of its actions, each with its place, and its view. */
  save(): SavedSession {
    const expanded: [Place, boolean][] = [];
    for (const [id, open] of this.#expanded) {
      const place = this.#placeOf(id);
      if (place !== undefined) expanded.push([place, open]);
    }
    return {
      format: "render-session",
      version: 2,
      baseline: this.#baseline,
      actions: this.#log.map(encodeEntry),
      view: { levels: { ...this.#levels }, expanded },
    };
  }

  /**
   * This method replaces the session with a saved session: it builds the model again and replays the actions.
   * The old record goes, thus undo does not bring the old session back. `open` keeps it.
   * It refuses a value that is not a saved session, and a session of version 1 from another version of the
   * viewer. An action that does not apply stops the replay, with a notice. The actions before it stay.
   */
  restore(saved: unknown): RestoreResult {
    const record = this.#read(saved);
    if (record === undefined) return "refused";
    this.#log = [];
    this.#redo = [];
    this.#checkpoints = [];
    this.#build();
    return this.#replaySaved(record, false);
  }

  /**
   * This method opens a saved session as one step of the record: a reset, then the actions of the saved
   * session. Undo takes back the full step, and it brings the old session back. A refused value changes nothing.
   * The limits of `restore` apply.
   */
  open(saved: unknown): RestoreResult {
    const record = this.#read(saved);
    if (record === undefined) return "refused";
    this.#redo = [];
    this.#apply({ kind: "reset" });
    this.#log.push({ action: { kind: "reset" }, place: undefined });
    this.#checkpoint();
    return this.#replaySaved(record, true);
  }

  /** This method checks a saved session. It gives its record, or `undefined` with a notice when the session does not apply. */
  #read(saved: unknown): SavedRecord | undefined {
    const version = isRecord(saved) ? saved["version"] : undefined;
    if (!isRecord(saved) || saved["format"] !== "render-session" || (version !== 1 && version !== 2) || !Array.isArray(saved["actions"])) {
      this.#notice = "The value is not a saved session of the viewer.";
      this.#emit();
      return undefined;
    }
    // A record of version 1 names the instances only by their IDs, thus it applies only to the same initial model
    const byPlace = version === 2;
    if (!byPlace && saved["baseline"] !== this.#baseline) {
      this.#notice = "The saved session is from another version of the viewer, and it has no places. Thus it does not apply.";
      this.#emit();
      return undefined;
    }
    return { actions: saved["actions"] as unknown[], view: saved["view"], byPlace };
  }

  /**
   * This method replays the actions of a saved session after the current record. With `joined`, each action
   * is part of the step before it. The first action that does not apply stops the replay.
   */
  #replaySaved({ actions, view, byPlace }: SavedRecord, joined: boolean): RestoreResult {
    this.#expanded.clear();
    let stopped: number | null = null;
    for (const [i, raw] of actions.entries()) {
      const entry = this.#entryOf(decodeValue(raw), byPlace);
      if (entry === undefined || !this.#apply(entry.action)) {
        stopped = i;
        break;
      }
      this.#log.push(joined ? { ...entry, joined } : entry);
      this.#checkpoint();
    }
    this.#restoreView(view, byPlace);
    this.#epoch = null;
    this.#flash = new Set();
    this.#notice = stopped === null
      ? null
      : `The saved session stopped at the action ${String(stopped + 1)} of ${String(actions.length)}, which does not apply. The actions before it apply.`;
    this.#emit();
    return stopped === null ? "complete" : "partial";
  }

  /**
   * This method reads an action of a saved session, before the replay applies it. With places, it finds the
   * instance of the place in the current model. It gives `undefined` for an action that is not valid, and
   * for a place without an instance of the same class.
   */
  #entryOf(value: unknown, byPlace: boolean): Entry | undefined {
    if (!isRecord(value)) return undefined;
    const { at, joined, ...action } = value;
    if (!isAction(action)) return undefined;
    const step = joined === true ? { joined } : {};
    const target = targetOf(action);
    if (target === undefined) return { action, place: undefined, ...step };
    if (!byPlace) return { action, place: this.#placeOf(target), ...step };
    if (!isPlace(at)) return undefined;
    const id = this.#find(at);
    return id === undefined ? undefined : { action: withTarget(action, id), place: at, ...step };
  }

  /** This method applies the view of a saved session. It ignores each part that is not valid. */
  #restoreView(view: unknown, byPlace: boolean): void {
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
      if (!Array.isArray(entry) || typeof entry[1] !== "boolean") continue;
      const key: unknown = entry[0];
      const id = byPlace ? (isPlace(key) ? this.#find(key) : undefined) : typeof key === "string" && this.#b.instances.has(key) ? key : undefined;
      if (id !== undefined) this.#expanded.set(id, entry[1]);
    }
  }

  /** This method gives the place of an instance in the current model, or `undefined` for an instance that does not exist. */
  #placeOf(instanceId: InstanceId): Place | undefined {
    const classRef = this.#b.instances.get(instanceId)?.classRef;
    if (classRef === undefined) return undefined;
    const path: number[] = [];
    for (let id = instanceId, guard = 0; guard < 10_000; guard++) {
      const root = this.#placeRoot(id);
      if (root !== undefined) return { root, path, classRef };
      const parent = this.#b.instances.get(id)?.scope.parent;
      const index = parent === undefined ? -1 : this.#b.instances.get(parent)?.scope.children.indexOf(id) ?? -1;
      if (parent === undefined || index === -1) return undefined;
      path.unshift(index);
      id = parent;
    }
    return undefined;
  }

  /** This method gives the root of a place when the instance is one, or `undefined`. */
  #placeRoot(id: InstanceId): PlaceRoot | undefined {
    for (const [name, card] of this.#cards) if (this.#b.instances.get(card)?.scope.parent === id) return { in: "card", name };
    const index = this.#canvas.indexOf(id);
    if (index !== -1) return { in: "canvas", index };
    for (const [item, root] of this.#dataRoots) if (root === id) return { in: "data", index: this.#canvas.indexOf(item) };
    if (id === this.#searchId) return { in: "search" };
    return id === this.#rootOf(this.#classesGrid) ? { in: "types" } : undefined;
  }

  /** This method finds the instance of a place in the current model. The instance must have the class of the place. */
  #find(place: Place): InstanceId | undefined {
    const { root } = place;
    let id: InstanceId | undefined;
    switch (root.in) {
      case "card": {
        const card = this.#cards.get(root.name);
        id = card === undefined ? undefined : this.#b.instances.get(card)?.scope.parent;
        break;
      }
      case "canvas": id = this.#canvas[root.index]; break;
      case "data": {
        const item = this.#canvas[root.index];
        id = item === undefined ? undefined : this.#dataRoots.get(item);
        break;
      }
      case "search": id = this.#searchId; break;
      case "types": id = this.#rootOf(this.#classesGrid); break;
    }
    for (const index of place.path) id = id === undefined ? undefined : this.#b.instances.get(id)?.scope.children[index];
    return id !== undefined && this.#b.instances.get(id)?.classRef === place.classRef ? id : undefined;
  }

  // === Internal: the record of the actions ===

  /** This method applies a new action. A new action removes the actions that undo took back. */
  #act(action: Action): boolean {
    this.#before = this.#store.epochStats;
    this.#seen = null;
    const target = targetOf(action);
    // The place is from before the action, because the action can move or remove the instance
    const place = target === undefined ? undefined : this.#placeOf(target);
    const recorded = this.#apply(action);
    this.#captureEpoch();
    if (recorded) {
      this.#log.push({ action, place });
      this.#redo = [];
      this.#checkpoint();
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
      case "delete": return this.#delete(action.id);
      case "move": return this.#move(action.id, action.index);
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
    const checkpoint = this.#checkpoints.at(-1);
    if (checkpoint === undefined) this.#build();
    else this.#load(forkModel(checkpoint.model));
    for (const entry of this.#log.slice(checkpoint?.length ?? 0)) this.#apply(entry.action);
    if (search !== "") this.#write(this.#searchId, "value", search);
    this.#epoch = null;
    this.#flash = new Set();
    this.#notice = null;
  }

  /** This method copies the model after each `CHECKPOINT_EVERY` recorded actions. */
  #checkpoint(): void {
    const length = this.#log.length;
    if (length % CHECKPOINT_EVERY !== 0 || this.#checkpoints.some((c) => c.length === length)) return;
    this.#checkpoints.push({ length, model: forkModel(this.#model()) });
    if (this.#checkpoints.length > MAX_CHECKPOINTS) this.#checkpoints.shift();
  }

  /** This method gives the current model. The result shares the state of the session: copy it before a change. */
  #model(): Model {
    return {
      b: this.#b,
      store: this.#store,
      classesGrid: this.#classesGrid,
      atomsId: this.#atomsId,
      traitsId: this.#traitsId,
      searchId: this.#searchId,
      cards: this.#cards,
      cardOwners: this.#cardOwners,
      canvas: this.#canvas,
      viewModes: this.#viewModes,
      dataRoots: this.#dataRoots,
      counter: this.#counter,
    };
  }

  /** This method makes a model the current model. The model must be a copy that nothing else changes. */
  #load(m: Model): void {
    this.#b = m.b;
    this.#store = m.store;
    this.#classesGrid = m.classesGrid;
    this.#atomsId = m.atomsId;
    this.#traitsId = m.traitsId;
    this.#searchId = m.searchId;
    this.#cards = new Map(m.cards);
    this.#cardOwners.clear();
    for (const [id, name] of m.cardOwners) this.#cardOwners.set(id, name);
    this.#canvas = [...m.canvas];
    this.#viewModes.clear();
    for (const [id, mode] of m.viewModes) this.#viewModes.set(id, mode);
    this.#dataRoots.clear();
    for (const [id, root] of m.dataRoots) this.#dataRoots.set(id, root);
    this.#counter = m.counter;
    this.cache.clear();
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
      this.#mirror(item, twin, (t) => {
        if (this.#write(t, cellName, value) !== null) return false;
        this.#syncCanvasCell(t, cellName, value);
        return true;
      });
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
    const card = this.#cardOf(parentId);
    const item = card === undefined ? this.#dataItemOf(parentId) : undefined;
    const twin = item === undefined ? undefined : this.#twinOf(item, parentId);
    instantiate(this.#b, this.#store, className, parentId);
    this.#captureEpoch();
    invalidateSplay(this.#b, this.cache, [parentId]);
    if (card !== undefined) this.#syncCard(card);
    else if (item !== undefined) {
      this.#mirror(item, twin, (t) => {
        instantiate(this.#b, this.#store, className, t);
        return true;
      });
    }
    return true;
  }

  #delete(instanceId: InstanceId): boolean {
    const parentId = this.#editableChild(instanceId);
    if (parentId === undefined) return false;
    const card = this.#cardOf(instanceId);
    const item = card === undefined ? this.#dataItemOf(instanceId) : undefined;
    const twin = item === undefined ? undefined : this.#twinOf(item, instanceId);
    destroyInstance(this.#b, this.#store, instanceId);
    this.#captureEpoch();
    invalidateSplay(this.#b, this.cache, [parentId]);
    if (card !== undefined) this.#syncCard(card);
    else if (item !== undefined) {
      this.#mirror(item, twin, (t) => {
        if (t === item) return false;
        destroyInstance(this.#b, this.#store, t);
        return true;
      });
    }
    return true;
  }

  #move(instanceId: InstanceId, index: number): boolean {
    const parentId = this.#editableChild(instanceId);
    if (parentId === undefined) return false;
    const siblings = this.#b.instances.get(parentId)!.scope.children;
    if (!Number.isInteger(index) || index < 0 || index >= siblings.length || siblings.indexOf(instanceId) === index) return false;
    const card = this.#cardOf(instanceId);
    const item = card === undefined ? this.#dataItemOf(instanceId) : undefined;
    const twin = item === undefined ? undefined : this.#twinOf(item, instanceId);
    moveChild(this.#b, instanceId, index);
    // The order of the children is not in the store, thus no epoch follows: the memo forgets the parent
    invalidateSplay(this.#b, this.cache, [parentId]);
    if (card !== undefined) this.#syncCard(card);
    else if (item !== undefined) {
      this.#mirror(item, twin, (t) => {
        moveChild(this.#b, t, index);
        return true;
      });
    }
    return true;
  }

  /**
   * This method gives the parent of a child that a person can remove or move. It gives `undefined` for an
   * instance without a parent, an instance in a cell, and the root of a card or of a data view. It also gives
   * `undefined` for the type graph outside the cards.
   */
  #editableChild(instanceId: InstanceId): InstanceId | undefined {
    const parentId = this.#b.instances.get(instanceId)?.scope.parent;
    if (parentId === undefined || this.#cardOwners.has(instanceId)) return undefined;
    for (const slot of this.#store.nodes.get(parentId)?.slots.values() ?? []) if (slot === instanceId) return undefined;
    const inCard = this.#cardOf(instanceId) !== undefined;
    return inCard || this.#panelOf(instanceId) === "canvas" ? parentId : undefined;
  }

  #replace(instanceId: InstanceId, value: unknown): boolean {
    const inst = this.#b.instances.get(instanceId);
    if (!inst) return false;
    const card = this.#cardOf(instanceId);
    const item = card === undefined ? this.#dataItemOf(instanceId) : undefined;
    const twin = item === undefined ? undefined : this.#twinOf(item, instanceId);
    const parentId = inst.scope.parent;
    const refusal = this.#setValueOf(instanceId, value);
    if (refusal !== null) {
      this.#notice = refusal;
      return false;
    }
    this.#captureEpoch();
    invalidateSplay(this.#b, this.cache, [parentId ?? instanceId]);
    if (card !== undefined) this.#syncCard(card);
    else if (item !== undefined) this.#mirror(item, twin, (t) => this.#setValueOf(t, value) === null);
    return true;
  }

  /**
   * This method gives an instance a new value. A card and a canvas item keep their class, and a canvas item
   * accepts only a value of its kind. Each other instance gets the class of the new value. The method gives the
   * reason of a refusal, or `null`. A value that does not hydrate is refused, and the instance keeps its value.
   */
  #setValueOf(instanceId: InstanceId, value: unknown): string | null {
    try {
      return this.#hydrateValue(instanceId, value);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return this.#cardOwners.has(instanceId)
        ? `A card holds the definition of a class, and the value is not one. ${why}`
        : `The value does not make an instance tree. ${why}`;
    }
  }

  #hydrateValue(instanceId: InstanceId, value: unknown): string | null {
    const inst = this.#b.instances.get(instanceId);
    if (!inst) return "The instance does not exist.";
    if (this.#cardOwners.has(instanceId)) {
      // A card keeps its class (ClassDef). The sync of the card refuses a value that is not a class.
      rehydrate(hydrationKit, this.#b, this.#store, instanceId, value);
    } else if (this.#canvas.includes(instanceId)) {
      // A canvas item keeps its class: the class of the new value must be on its extends chain
      const kind = exprClassFor(value);
      if (!this.#extendsChain(inst.classRef).includes(kind)) return `The canvas item ${inst.classRef} cannot hold a value of the class ${kind}.`;
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
    return null;
  }

  /**
   * This method applies a change of a data view to its canvas item. It applies the same change to the twin, which
   * the caller found before the change. Thus the classes of the item stay. Without a twin, or when the item and
   * the data then differ, the item gets the full data again (`#writeBack`).
   */
  #mirror(item: InstanceId, twin: InstanceId | undefined, apply: (twin: InstanceId) => boolean): void {
    const root = this.#dataRoots.get(item);
    if (twin !== undefined && root !== undefined) {
      const twinParent = this.#b.instances.get(twin)?.scope.parent;
      if (apply(twin)) {
        this.#captureEpoch();
        invalidateSplay(this.#b, this.cache, [twinParent ?? item]);
        if (this.#b.instances.has(twin)) invalidateSplay(this.#b, this.cache, [twin]);
        if (valueEquals(dehydrate(this.#b, this.#store, item), dehydrate(this.#b, this.#store, root))) return;
      }
    }
    this.#writeBack(item);
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
