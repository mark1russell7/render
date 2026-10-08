import type { Biblo, InstanceId } from "@render/biblo";
import {
  biblo, classNodeOps, destroyInstance, instantiate, ownerOf, registerClass, registerClasses, updateClass,
} from "@render/biblo";
import type { Ops } from "@render/dsl";
import { lit } from "@render/dsl";
import type { NodeStore } from "@render/node";
import { batch, nodeStore, setValue } from "@render/node";
import type { SplayCache } from "@render/splay";
import {
  dehydrate, exprClassFor, hydrate, invalidateSplay, readCells, splayKit, standardClasses, standardOps, textOf,
} from "@render/splay";
import { viewerClasses } from "./classes.ts";
import { atomsToJson, classToJson, reconstructClass } from "./typegraph.ts";

/** The view of a canvas item: its render, or its data. */
export type ViewMode = "rendered" | "data";

/** The summary of the last epoch, for the reactivity proof. */
export type EpochSummary = {
  readonly evaluated: number;
  readonly changed: number;
  readonly total: number;
};

/** The kit of hydration. Hydration needs only `classFor` and the standard ops. The atoms of hydrate come from the engine. */
const hydrationKit = splayKit<unknown>(exprClassFor, standardOps);

/** The kit of the atom names: each string becomes a read-only `Label`. */
const labelKit = splayKit<unknown>((v) => (typeof v === "string" ? "Label" : exprClassFor(v)), standardOps);

const builtInNames: ReadonlySet<string> = new Set([...standardClasses, ...viewerClasses].map((c) => c.name));

/**
 * The model of the viewer, without React. It holds the biblo, the store and the state of the two panels,
 * and it gives the actions of the user. Each action keeps the store consistent, updates the splay memo and
 * notifies the subscribers. The React view reads it with `useSyncExternalStore`.
 *
 * - The type graph shows one card for each class. An edit in a card changes the class, and the live
 *   instances follow the class (`updateClass`). An edit that gives an invalid class goes back, with a notice.
 * - The canvas holds instances of user classes. An edit of a cell of a user class changes the class too.
 * - The data view of a canvas item is read-only. It shows the dehydrated value of the item.
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
  #searchId: InstanceId = "";
  readonly #cards = new Map<string, InstanceId>();
  readonly #cardOwners = new Map<InstanceId, string>();
  #canvas: InstanceId[] = [];
  readonly #viewModes = new Map<InstanceId, ViewMode>();
  readonly #dataRoots = new Map<InstanceId, InstanceId>();
  #counter = 0;
  #epoch: EpochSummary | null = null;
  #flash: ReadonlySet<InstanceId> = new Set();
  #notice: string | null = null;

  /** The constructor builds the type graph. `viewOps` are the ops of the view, which the type graph lists as atoms. */
  constructor(viewOps: Ops = standardOps) {
    this.#viewOps = viewOps;
    this.#build();
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
  /** The summary of the last epoch, or `null` before the first action. */
  get epoch(): EpochSummary | null { return this.#epoch; }
  /** The instances that the last epoch evaluated, with their ancestors: the flash of the reactivity proof. */
  get flash(): ReadonlySet<InstanceId> { return this.#flash; }
  /** The message of the last refused edit, or `null`. */
  get notice(): string | null { return this.#notice; }

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

  /** This method gives the instance of the definition of a class in the type graph. */
  definitionOf(name: string): InstanceId | undefined { return this.#cards.get(name); }

  /** This method gives the view mode of a canvas item. */
  viewMode(id: InstanceId): ViewMode { return this.#viewModes.get(id) ?? "rendered"; }

  /** This method gives the data view of a canvas item, when the item shows its data. */
  dataRoot(id: InstanceId): InstanceId | undefined { return this.#dataRoots.get(id); }

  /** This method tells if a class is a class that a person made (not a standard class or a class of the viewer). */
  isUserClass(name: string): boolean { return this.#b.classes.has(name) && !builtInNames.has(name); }

  // === Actions ===

  /**
   * This method writes a value to a cell. The place of the instance selects the effect. The search box filters.
   * An edit in a card changes its class. An edit of a canvas item of a user class also changes that class.
   */
  readonly editCell = (instanceId: InstanceId, cellName: string, value: unknown): void => {
    const refusal = this.#write(instanceId, cellName, value);
    if (refusal !== null) {
      this.#notice = refusal;
      this.#emit();
      return;
    }
    this.#captureEpoch();
    const card = this.#cardOf(instanceId);
    if (card !== undefined) this.#syncCard(card);
    else if (this.#isOnCanvas(instanceId)) this.#syncCanvasCell(instanceId, cellName, value);
    this.#emit();
  };

  /** This method makes a child instance of a class under a parent: a drop on a stack, a grid or the arguments of an op. */
  readonly addChild = (parentId: InstanceId, className: string): void => {
    if (!this.#b.instances.has(parentId)) return;
    instantiate(this.#b, this.#store, className, parentId);
    this.#captureEpoch();
    invalidateSplay(this.#b, this.cache, [parentId]);
    const card = this.#cardOf(parentId);
    if (card !== undefined) this.#syncCard(card);
    this.#emit();
  };

  /** This method drops a class on the canvas: it makes a subclass (for example `Text_1`) and an instance of it. */
  dropClass(className: string): InstanceId | undefined {
    if (!this.#b.classes.has(className)) return undefined;
    let name: string;
    do name = `${className}_${String(++this.#counter)}`;
    while (this.#b.classes.has(name));
    registerClass(this.#b, { name, extends: className, cells: {} });
    const inst = instantiate(this.#b, this.#store, name);
    this.#captureEpoch();
    this.#canvas = [...this.#canvas, inst.id];
    batch(this.#store, () => { this.#showCard(name); });
    this.#emit();
    return inst.id;
  }

  /** This method removes a canvas item: its instance tree and its data view. Its class stays. */
  removeCanvasItem(id: InstanceId): void {
    const dataRoot = this.#dataRoots.get(id);
    batch(this.#store, () => {
      if (dataRoot !== undefined) destroyInstance(this.#b, this.#store, dataRoot);
      destroyInstance(this.#b, this.#store, id);
    });
    this.#dataRoots.delete(id);
    this.#viewModes.delete(id);
    this.#canvas = this.#canvas.filter((c) => c !== id);
    this.#emit();
  }

  /** This method switches a canvas item between its render and its data. A data view is built new each time. */
  toggleView(id: InstanceId): void {
    const inst = this.#b.instances.get(id);
    if (!inst) return;
    const next: ViewMode = this.viewMode(id) === "rendered" ? "data" : "rendered";
    this.#viewModes.set(id, next);
    const old = this.#dataRoots.get(id);
    if (old !== undefined) {
      destroyInstance(this.#b, this.#store, old);
      this.#dataRoots.delete(id);
    }
    if (next === "data") {
      const data: Record<string, unknown> = { class: inst.classRef, value: dehydrate(this.#b, this.#store, id) };
      if (inst.scope.children.length > 0) {
        data["children"] = inst.scope.children.map((childId) => `${this.#b.instances.get(childId)?.classRef ?? "?"}:${childId}`);
      }
      this.#dataRoots.set(id, hydrate(hydrationKit, this.#b, this.#store, data).id);
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

  /** This method starts again with only the standard classes and an empty canvas. */
  reset(): void {
    this.#build();
    this.#emit();
  }

  // === Internal ===

  #emit(): void {
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
    this.#cards.clear();
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
    batch(store, () => {
      const root = instantiate(b, store, "Grid");
      const section = (label: string): InstanceId => {
        const kvp = instantiate(b, store, "KeyValuePair", root.id);
        instantiate(b, store, "Label", kvp.id, { value: lit(label) });
        return kvp.id;
      };
      this.#classesGrid = instantiate(b, store, "Grid", section("classes")).id;
      hydrate(labelKit, b, store, atomsToJson(this.#viewOps), section("atoms"));
      for (const name of b.classes.keys()) this.#showCard(name);
      this.#searchId = instantiate(b, store, "Text").id;
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
    const card = hydrate(hydrationKit, this.#b, this.#store, classToJson(cls), parent).id;
    this.#cards.set(name, card);
    this.#cardOwners.set(card, name);
    invalidateSplay(this.#b, this.cache, [parent]);
  }

  /** This method writes a cell. It gives the reason of a refusal, or `null`. */
  #write(instanceId: InstanceId, cellName: string, value: unknown): string | null {
    const slot = this.#store.nodes.get(instanceId)?.slots.get(cellName);
    if (slot === undefined) return `The instance has no cell ${cellName}.`;
    if ((this.#store.nodes.get(slot)?.slots.size ?? 0) > 0) return `The cell ${cellName} holds an instance, not a value.`;
    setValue(this.#store, slot, value);
    return null;
  }

  /** The card of a type-graph instance: the class card that contains it. */
  #cardOf(instanceId: InstanceId): InstanceId | undefined {
    for (let id: InstanceId | undefined = instanceId, guard = 0; id !== undefined && guard < 10_000; guard++) {
      if (this.#cardOwners.has(id)) return id;
      id = this.#b.instances.get(id)?.scope.parent;
    }
    return undefined;
  }

  #isOnCanvas(instanceId: InstanceId): boolean {
    for (let id: InstanceId | undefined = instanceId, guard = 0; id !== undefined && guard < 10_000; guard++) {
      if (this.#canvas.includes(id)) return true;
      id = this.#b.instances.get(id)?.scope.parent;
    }
    return false;
  }

  /** An edit in a card changes its class. An invalid class, or a new name, goes back to the class, with a notice. */
  #syncCard(card: InstanceId): void {
    const name = this.#cardOwners.get(card);
    if (name === undefined) return;
    const result = reconstructClass(dehydrate(this.#b, this.#store, card), this.#b.classes.get(name));
    if (!result.ok || result.cls.name !== name) {
      this.#notice = result.ok ? `A class cannot change its name here (${name}).` : result.reason;
      batch(this.#store, () => { this.#showCard(name); });
      return;
    }
    updateClass(this.#b, this.#store, result.cls);
    this.cache.clear();
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
    this.cache.clear();
  }

  /** This method reads the stats of the last epoch: the summary, the flash and the invalidation of the memo. */
  #captureEpoch(): void {
    const stats = this.#store.epochStats;
    if (!stats) return;
    this.#epoch = { evaluated: stats.evaluated.size, changed: stats.changed.size, total: stats.total };
    const owners = (ids: Iterable<string>): InstanceId[] => {
      const out: InstanceId[] = [];
      for (const id of ids) {
        const owner = ownerOf(this.#b, this.#store, id);
        if (owner !== undefined) out.push(owner);
      }
      return out;
    };
    invalidateSplay(this.#b, this.cache, owners(stats.changed));
    const flash = new Set<InstanceId>();
    for (const start of owners(stats.evaluated)) {
      for (let id: InstanceId | undefined = start; id !== undefined && !flash.has(id); id = this.#b.instances.get(id)?.scope.parent) {
        flash.add(id);
      }
    }
    this.#flash = flash;
  }
}
