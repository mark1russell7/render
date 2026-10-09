import type { ComponentClass, CellDef } from "./class.ts";
import type { Instance, InstanceId } from "./instance.ts";
import type { PrimeTable, Trait, TraitResolution } from "./traits.ts";
import { fingerprintOf, primeIn, primeTable, selectTraits } from "./traits.ts";
import type { Expr } from "@render/dsl";
import { exprEquals, lit, ref, mapFreeRefs } from "@render/dsl";
import type { NodeId, NodeStore } from "@render/node";
import { addNode, batch, removeNode, setExpr, setSlot } from "@render/node";

/**
 * The biblo is the class registry and the instance store.
 *
 * Classes are shared templates. Instances are small (an ID and a scope), and the values of their cells
 * are in the node store. A trait gives methods to each class that has the cells of its list.
 * Change a biblo only through its functions, for example `registerClass`, `registerTrait` and `instantiate`.
 */
export type Biblo = {
  readonly classes: ReadonlyMap<string, ComponentClass>;
  readonly instances: ReadonlyMap<InstanceId, Instance>;
  readonly traits: ReadonlyMap<string, Trait>;
};

type MutableInstance = {
  readonly id: InstanceId;
  classRef: string;
  readonly scope: { readonly self: InstanceId; readonly parent: InstanceId | undefined; readonly children: InstanceId[] };
};

type BibloState = {
  readonly classes: Map<string, ComponentClass>;
  readonly instances: Map<InstanceId, MutableInstance>;
  /** For each instance: the names of the cells that a binding gave. A change of the class does not change them. */
  readonly bound: Map<InstanceId, Set<string>>;
  readonly traits: Map<string, Trait>;
  readonly primes: PrimeTable;
  nextId: number;
  readonly cellsCache: Map<string, Readonly<Record<string, CellDef>>>;
  readonly methodsCache: Map<string, Readonly<Record<string, unknown>>>;
  readonly traitsCache: Map<string, TraitResolution>;
};

const bstate = (b: Biblo): BibloState => b as unknown as BibloState;

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** This function gives an own property of a record, or `undefined`. It does not read `Object.prototype`. */
const own = <T>(o: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  o !== undefined && hasOwn(o, key) ? o[key] : undefined;

/** This function makes an empty biblo. */
export const biblo = (): Biblo => {
  const s: BibloState = {
    classes: new Map(),
    instances: new Map(),
    bound: new Map(),
    traits: new Map(),
    primes: primeTable(),
    nextId: 0,
    cellsCache: new Map(),
    methodsCache: new Map(),
    traitsCache: new Map(),
  };
  return s;
};

const clearCaches = (s: BibloState): void => {
  s.cellsCache.clear();
  s.methodsCache.clear();
  s.traitsCache.clear();
};

/** This function registers a class, or replaces the class with the same name. The live instances do not change. */
export const registerClass = (b: Biblo, cls: ComponentClass): void => {
  const s = bstate(b);
  s.classes.set(cls.name, cls);
  clearCaches(s);
};

/** This function registers a trait, or replaces the trait with the same name. The live instances use it at once. */
export const registerTrait = (b: Biblo, trait: Trait): void => {
  const s = bstate(b);
  s.traits.set(trait.name, trait);
  clearCaches(s);
};

/** This function removes a trait. */
export const unregisterTrait = (b: Biblo, name: string): void => {
  const s = bstate(b);
  s.traits.delete(name);
  clearCaches(s);
};

/**
 * This function renames a class. Its subclasses, the typed cells that use it and its live instances use the
 * new name. It does nothing and gives `false` when the class is missing or the new name is in use.
 */
export const renameClass = (b: Biblo, from: string, to: string): boolean => {
  const s = bstate(b);
  if (!s.classes.has(from) || to === "" || s.classes.has(to)) return false;
  const next = new Map<string, ComponentClass>();
  for (const [name, c] of s.classes) {
    const extendsRenamed = c.extends === from;
    const cellsRenamed = Object.values(c.cells).some((def) => def.type === from);
    next.set(name === from ? to : name, {
      ...c,
      name: name === from ? to : name,
      ...(extendsRenamed ? { extends: to } : {}),
      cells: cellsRenamed
        ? Object.fromEntries(Object.entries(c.cells).map(([k, def]) => [k, def.type === from ? { ...def, type: to } : def]))
        : c.cells,
    });
  }
  // The new map keeps the order of registration, with the renamed class at the place of the old name
  s.classes.clear();
  for (const [name, c] of next) s.classes.set(name, c);
  for (const inst of s.instances.values()) if (inst.classRef === from) inst.classRef = to;
  clearCaches(s);
  return true;
};

/** This function registers each class of a list, in order. */
export const registerClasses = (b: Biblo, classes: readonly ComponentClass[]): void => {
  for (const cls of classes) registerClass(b, cls);
};

/**
 * This function gives the extends chain of a class, from the class to the root.
 * A cycle (`A` extends `B` extends `A`) stops at the first class that repeats.
 */
const extendsChain = (b: Biblo, className: string): ComponentClass[] => {
  const chain: ComponentClass[] = [];
  const visited = new Set<string>();
  let current: string | undefined = className;
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const cls = b.classes.get(current);
    if (!cls) break;
    chain.push(cls);
    current = cls.extends;
  }
  return chain;
};

/**
 * This function merges the records of an extends chain: the record of the class wins over the record of its parent.
 * `Object.fromEntries` makes own data properties, thus a cell named `__proto__` is a normal cell.
 */
const mergeChain = <T>(chain: readonly ComponentClass[], pick: (cls: ComponentClass) => Readonly<Record<string, T>> | undefined): Readonly<Record<string, T>> => {
  const entries: [string, T][] = [];
  for (let i = chain.length - 1; i >= 0; i--) entries.push(...Object.entries(pick(chain[i]!) ?? {}));
  return Object.freeze(Object.fromEntries(entries));
};

/** This function gives all cell templates of a class through its extends chain. A subclass cell replaces a parent cell. */
export const resolveCells = (b: Biblo, className: string): Readonly<Record<string, CellDef>> => {
  const s = bstate(b);
  let out = s.cellsCache.get(className);
  if (!out) {
    out = mergeChain(extendsChain(b, className), (cls) => cls.cells);
    s.cellsCache.set(className, out);
  }
  return out;
};

/** This function gives the fingerprint of a class: the product of the primes of its cells and typed cells. */
export const classFingerprint = (b: Biblo, className: string): bigint => {
  const atoms: string[] = [];
  for (const [name, def] of Object.entries(resolveCells(b, className))) {
    atoms.push(`cell:${name}`);
    if (def.type !== undefined) atoms.push(`cell:${name}:${def.type}`);
  }
  return fingerprintOf(bstate(b).primes, atoms);
};

/** This function gives the prime of an atomic feature, for example `cell:value`. */
export const primeOf = (b: Biblo, atom: string): bigint => primeIn(bstate(b).primes, atom);

/** This function gives the traits that apply to a class (the most specific ones), and the ambiguous method names. */
export const resolveTraits = (b: Biblo, className: string): TraitResolution => {
  const s = bstate(b);
  let out = s.traitsCache.get(className);
  if (!out) {
    out = selectTraits(s.primes, s.traits.values(), classFingerprint(b, className));
    s.traitsCache.set(className, out);
  }
  return out;
};

/**
 * This function gives all methods of a class. There are three layers, from the lowest to the highest.
 * The first layer is the root of the extends chain, for example `Top`. The second layer is the traits that apply.
 * The third layer is the other classes of the chain, to the class itself.
 *
 * Thus a trait changes the defaults of the root, and a class changes a trait.
 * A method that two traits give is ambiguous: no trait gives it.
 */
export const resolveMethods = (b: Biblo, className: string): Readonly<Record<string, unknown>> => {
  const s = bstate(b);
  let out = s.methodsCache.get(className);
  if (!out) {
    const chain = extendsChain(b, className);
    const root = chain.length > 1 ? chain.slice(-1) : [];
    const upper = chain.length > 1 ? chain.slice(0, -1) : chain;
    const { applied, ambiguous } = resolveTraits(b, className);
    const traitEntries = applied
      .flatMap((t) => Object.entries(t.methods))
      .filter(([name]) => !ambiguous.includes(name));
    out = Object.freeze(Object.fromEntries([
      ...Object.entries(mergeChain(root, (cls) => cls.methods)),
      ...traitEntries,
      ...Object.entries(mergeChain(upper, (cls) => cls.methods)),
    ]));
    s.methodsCache.set(className, out);
  }
  return out;
};

/** This function gives an instance ID that is free in the biblo and in the store. */
const newInstanceId = (s: BibloState, store: NodeStore): InstanceId => {
  for (;;) {
    const id = `i_${String(s.nextId++)}`;
    if (!s.instances.has(id) && !store.nodes.has(id)) return id;
  }
};

/**
 * This function changes the scope names of the free references to node IDs:
 * `self` becomes the instance and `parent` becomes the parent instance. The parameters of `fn` forms stay.
 */
const scopeExpr = (expr: Expr, selfId: InstanceId, parentId: InstanceId | undefined): Expr =>
  mapFreeRefs(expr, (r) => {
    const [head, ...rest] = r.path;
    if (head === "self") return ref(selfId, ...rest);
    if (head === "parent" && parentId !== undefined) return ref(parentId, ...rest);
    return r;
  });

/**
 * This function adds one cell to an instance. A typed cell becomes a child instance. The exception is a class
 * that is already on the chain of typed cells above the cell. Then the cell is plain, thus the instance is finite.
 */
const addCell = (
  s: BibloState,
  b: Biblo,
  store: NodeStore,
  inst: MutableInstance,
  name: string,
  def: CellDef,
  bound: Expr | undefined,
  chain: ReadonlySet<string>,
): void => {
  let target: NodeId;
  if (bound === undefined && def.type !== undefined && !chain.has(def.type)) {
    target = instantiateIn(s, b, store, def.type, inst.id, def.bindings, chain).id;
  } else {
    target = addNode(store, scopeExpr(bound ?? def.expr, inst.id, inst.scope.parent), `${inst.id}.${name}`);
  }
  setSlot(store, inst.id, name, target, { own: true });
};

const instantiateIn = (
  s: BibloState,
  b: Biblo,
  store: NodeStore,
  className: string,
  parentId: InstanceId | undefined,
  bindings: Readonly<Record<string, Expr>> | undefined,
  chain: ReadonlySet<string>,
): MutableInstance => {
  const parent = parentId === undefined ? undefined : s.instances.get(parentId);
  const id = newInstanceId(s, store);
  const inst: MutableInstance = { id, classRef: className, scope: { self: id, parent: parent?.id, children: [] } };
  s.instances.set(id, inst);
  parent?.scope.children.push(id);

  addNode(store, lit(undefined), id);
  const inner = new Set([...chain, className]);
  const bound = new Set<string>();
  for (const [name, def] of Object.entries(resolveCells(b, className))) {
    const binding = own(bindings, name);
    if (binding !== undefined) bound.add(name);
    addCell(s, b, store, inst, name, def, binding, inner);
  }
  if (bound.size > 0) s.bound.set(id, bound);
  return inst;
};

/**
 * This function makes an instance of a class. The class is not copied: the instance gets an ID, a scope,
 * and a root node with one slot for each cell. All nodes are evaluated before the end of the function.
 *
 * - A typed cell becomes a child instance of its class, with the bindings of the cell. The slot of the cell
 *   holds the root node of the child, thus `ref("self", "kid", "value")` reads a cell of the child.
 *   A typed cell whose class is already above it on the chain of typed cells is a plain cell.
 * - `bindings` replace cells of this instance. They are in the scope of this instance. A binding for a typed
 *   cell makes it a plain cell with the bound expression.
 * - An unknown class gives an instance with no cells.
 */
export const instantiate = (
  b: Biblo,
  store: NodeStore,
  className: string,
  parentId?: InstanceId,
  bindings?: Readonly<Record<string, Expr>>,
): Instance => batch(store, () => instantiateIn(bstate(b), b, store, className, parentId, bindings, new Set()));

const destroyIn = (s: BibloState, store: NodeStore, id: InstanceId): void => {
  const inst = s.instances.get(id);
  if (!inst) return;
  // A copy, because each destroy removes the child from this array
  for (const childId of inst.scope.children.slice()) destroyIn(s, store, childId);
  removeNode(store, id);
  const parent = inst.scope.parent === undefined ? undefined : s.instances.get(inst.scope.parent);
  if (parent) {
    const idx = parent.scope.children.indexOf(id);
    if (idx >= 0) parent.scope.children.splice(idx, 1);
  }
  s.instances.delete(id);
  s.bound.delete(id);
};

/**
 * This function moves a child instance to a position in the children of its parent. A position past the end
 * moves it to the end. It does nothing for an instance without a parent.
 */
export const moveChild = (b: Biblo, childId: InstanceId, index: number): void => {
  const s = bstate(b);
  const child = s.instances.get(childId);
  const parent = child?.scope.parent === undefined ? undefined : s.instances.get(child.scope.parent);
  if (!parent) return;
  const children = parent.scope.children;
  const from = children.indexOf(childId);
  if (from < 0) return;
  children.splice(from, 1);
  children.splice(Math.max(0, Math.min(index, children.length)), 0, childId);
};

/**
 * This function destroys an instance, the inverse of `instantiate`. It destroys the children first, then
 * removes the nodes of the instance and detaches it from its parent. The readers of the removed nodes
 * become `none` in one epoch.
 */
export const destroyInstance = (b: Biblo, store: NodeStore, instanceId: InstanceId): void => {
  batch(store, () => { destroyIn(bstate(b), store, instanceId); });
};

/** This function gives the classes on the chain of typed cells above an instance, with the class of the instance. */
const typedChain = (s: BibloState, store: NodeStore, inst: MutableInstance): Set<string> => {
  const chain = new Set<string>([inst.classRef]);
  let current: MutableInstance | undefined = inst;
  while (current?.scope.parent !== undefined) {
    const parent = s.instances.get(current.scope.parent);
    const childId: InstanceId = current.id;
    const holds = parent !== undefined && [...(store.nodes.get(parent.id)?.slots.values() ?? [])].includes(childId);
    if (!parent || !holds || chain.has(parent.classRef)) break;
    chain.add(parent.classRef);
    current = parent;
  }
  return chain;
};

/** This function removes a cell of an instance: an owned cell node goes, and a shared one only loses the slot. */
const removeCell = (s: BibloState, store: NodeStore, inst: MutableInstance, name: string, slot: NodeId): void => {
  const child = s.instances.get(slot);
  if (child) destroyIn(s, store, child.id);
  else if (store.nodes.get(slot)?.parent === inst.id) removeNode(store, slot);
  else setSlot(store, inst.id, name, undefined);
};

/**
 * This function updates the cells of a child instance after a change of the bindings of its typed cell.
 * A child cell that still has the old binding (or the old default of its class) gets the new one.
 */
const updateBindings = (
  s: BibloState,
  b: Biblo,
  store: NodeStore,
  child: MutableInstance,
  oldBindings: Readonly<Record<string, Expr>> | undefined,
  newBindings: Readonly<Record<string, Expr>> | undefined,
): void => {
  const cells = resolveCells(b, child.classRef);
  const root = store.nodes.get(child.id);
  if (!root) return;
  const bound = s.bound.get(child.id) ?? new Set<string>();
  for (const k of new Set([...Object.keys(oldBindings ?? {}), ...Object.keys(newBindings ?? {})])) {
    const oldE = own(oldBindings, k) ?? own(cells, k)?.expr;
    const newE = own(newBindings, k) ?? own(cells, k)?.expr;
    if (own(newBindings, k) !== undefined) bound.add(k);
    else bound.delete(k);
    const slot = root.slots.get(k);
    const cell = slot === undefined ? undefined : store.nodes.get(slot);
    if (!cell || !oldE || !newE || s.instances.has(cell.id)) continue;
    if (exprEquals(cell.expr, scopeExpr(oldE, child.id, child.scope.parent))) {
      setExpr(store, cell.id, scopeExpr(newE, child.id, child.scope.parent));
    }
  }
  if (bound.size > 0) s.bound.set(child.id, bound);
  else s.bound.delete(child.id);
};

/**
 * This function registers a new version of a class and updates the live instances: the class is a template,
 * and the instances follow it. The update applies to each instance of the class and of its subclasses.
 * When a cell of the resolved class changes, the instance cell changes too, if it still has the old expression.
 *
 * - A cell with an edit of its own keeps it. A cell that a binding gave keeps the binding.
 * - A new cell is added, and a removed cell is removed. A shared cell node only loses its slot.
 * - A typed cell that changes its type gets a new child instance. A change of its bindings reaches the cells of
 *   the child that still follow the old bindings. A change between a typed cell and a plain cell replaces the cell.
 *
 * All changes evaluate in one epoch.
 */
export const updateClass = (b: Biblo, store: NodeStore, cls: ComponentClass): void => {
  const s = bstate(b);
  const before = new Map<string, Readonly<Record<string, CellDef>>>();
  for (const inst of s.instances.values()) {
    if (!before.has(inst.classRef)) before.set(inst.classRef, resolveCells(b, inst.classRef));
  }
  registerClass(b, cls);
  batch(store, () => {
    for (const inst of Array.from(s.instances.values())) {
      const root = store.nodes.get(inst.id);
      const old = before.get(inst.classRef);
      if (!root || !old || !s.instances.has(inst.id)) continue;
      const next = resolveCells(b, inst.classRef);
      const bound = s.bound.get(inst.id);
      for (const name of new Set([...Object.keys(old), ...Object.keys(next)])) {
        const o = own(old, name);
        const n = own(next, name);
        if (o === n || bound?.has(name) === true) continue;
        const slot = root.slots.get(name);
        const target = slot === undefined ? undefined : store.nodes.get(slot);
        const child = slot === undefined ? undefined : s.instances.get(slot);
        const follows = (def: CellDef): boolean =>
          target !== undefined && child === undefined && exprEquals(target.expr, scopeExpr(def.expr, inst.id, inst.scope.parent));
        if (!n) {
          if (slot !== undefined) removeCell(s, store, inst, name, slot);
        } else if (!o) {
          if (slot === undefined) addCell(s, b, store, inst, name, n, undefined, typedChain(s, store, inst));
        } else if (o.type !== undefined && n.type !== undefined) {
          if (!child) continue;
          if (o.type !== n.type) {
            removeCell(s, store, inst, name, child.id);
            addCell(s, b, store, inst, name, n, undefined, typedChain(s, store, inst));
          } else {
            updateBindings(s, b, store, child, o.bindings, n.bindings);
          }
        } else if (o.type !== undefined || n.type !== undefined) {
          // A change between a typed cell and a plain cell: the cell follows the class only in its old form
          const followsOld = o.type !== undefined ? child !== undefined : follows(o);
          if (slot !== undefined && followsOld) {
            removeCell(s, store, inst, name, slot);
            addCell(s, b, store, inst, name, n, undefined, typedChain(s, store, inst));
          }
        } else if (slot !== undefined && follows(o)) {
          setExpr(store, slot, scopeExpr(n.expr, inst.id, inst.scope.parent));
        }
      }
    }
  });
};

/**
 * This function gives the instance that owns a node. For an instance root, it is the node itself.
 * For another node, it is the nearest owner up the slot tree. A node outside all instances gives `undefined`.
 */
export const ownerOf = (b: Biblo, store: NodeStore, nodeId: NodeId): InstanceId | undefined => {
  let current: NodeId | undefined = nodeId;
  for (let guard = 0; current !== undefined && guard < 10_000; guard++) {
    if (b.instances.has(current)) return current;
    current = store.nodes.get(current)?.parent;
  }
  return undefined;
};
