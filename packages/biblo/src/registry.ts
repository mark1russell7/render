import type { ComponentClass, CellDef } from "./class.ts";
import type { Instance, InstanceId } from "./instance.ts";
import type { Expr } from "@render/dsl";
import { lit, ref, mapFreeRefs } from "@render/dsl";
import type { NodeId, NodeStore } from "@render/node";
import { addNode, batch, removeNode, setSlot } from "@render/node";

/**
 * The biblo is the class registry and the instance store.
 *
 * Classes are shared templates. Instances are small (an ID and a scope), and the values of their cells
 * are in the node store. Change a biblo only through `registerClass`, `instantiate` and `destroyInstance`.
 */
export type Biblo = {
  readonly classes: ReadonlyMap<string, ComponentClass>;
  readonly instances: ReadonlyMap<InstanceId, Instance>;
};

type MutableInstance = {
  readonly id: InstanceId;
  readonly classRef: string;
  readonly scope: { readonly self: InstanceId; readonly parent: InstanceId | undefined; readonly children: InstanceId[] };
};

type BibloState = {
  readonly classes: Map<string, ComponentClass>;
  readonly instances: Map<InstanceId, MutableInstance>;
  nextId: number;
  readonly cellsCache: Map<string, Readonly<Record<string, CellDef>>>;
  readonly methodsCache: Map<string, Readonly<Record<string, unknown>>>;
};

const bstate = (b: Biblo): BibloState => b as unknown as BibloState;

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** This function makes an empty biblo. */
export const biblo = (): Biblo => {
  const s: BibloState = {
    classes: new Map(),
    instances: new Map(),
    nextId: 0,
    cellsCache: new Map(),
    methodsCache: new Map(),
  };
  return s as unknown as Biblo;
};

/** This function registers a class, or replaces the class with the same name. */
export const registerClass = (b: Biblo, cls: ComponentClass): void => {
  const s = bstate(b);
  s.classes.set(cls.name, cls);
  s.cellsCache.clear();
  s.methodsCache.clear();
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

/** This function gives all cell templates of a class through its extends chain. A subclass cell replaces a parent cell. */
export const resolveCells = (b: Biblo, className: string): Readonly<Record<string, CellDef>> => {
  const s = bstate(b);
  let out = s.cellsCache.get(className);
  if (!out) {
    const chain = extendsChain(b, className);
    const merged: Record<string, CellDef> = {};
    for (let i = chain.length - 1; i >= 0; i--) Object.assign(merged, chain[i]!.cells);
    out = Object.freeze(merged);
    s.cellsCache.set(className, out);
  }
  return out;
};

/**
 * This function gives all methods of a class through its extends chain. The most specific method wins.
 * Thus `Top` gives the defaults, and each class changes only what it needs.
 */
export const resolveMethods = (b: Biblo, className: string): Readonly<Record<string, unknown>> => {
  const s = bstate(b);
  let out = s.methodsCache.get(className);
  if (!out) {
    const chain = extendsChain(b, className);
    const merged: Record<string, unknown> = {};
    for (let i = chain.length - 1; i >= 0; i--) Object.assign(merged, chain[i]!.methods);
    out = Object.freeze(merged);
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

const instantiateIn = (
  s: BibloState,
  b: Biblo,
  store: NodeStore,
  className: string,
  parentId: InstanceId | undefined,
  bindings: Readonly<Record<string, Expr>> | undefined,
): MutableInstance => {
  const parent = parentId === undefined ? undefined : s.instances.get(parentId);
  const id = newInstanceId(s, store);
  const inst: MutableInstance = { id, classRef: className, scope: { self: id, parent: parent?.id, children: [] } };
  s.instances.set(id, inst);
  parent?.scope.children.push(id);

  addNode(store, lit(undefined), id);
  for (const [name, def] of Object.entries(resolveCells(b, className))) {
    const bound = bindings !== undefined && hasOwn(bindings, name) ? bindings[name] : undefined;
    let slotTarget: NodeId;
    if (bound === undefined && def.type !== undefined) {
      slotTarget = instantiateIn(s, b, store, def.type, id, def.bindings).id;
    } else {
      slotTarget = addNode(store, scopeExpr(bound ?? def.expr, id, parent?.id), `${id}.${name}`);
    }
    setSlot(store, id, name, slotTarget);
  }
  return inst;
};

/**
 * This function makes an instance of a class. The class is not copied: the instance gets an ID, a scope,
 * and a root node with one slot for each cell. All nodes are evaluated when the function returns.
 *
 * - A typed cell becomes a child instance of its class, with the bindings of the cell. The slot of the cell
 *   holds the root node of the child, thus `ref("self", "kid", "value")` reads a cell of the child.
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
): Instance => batch(store, () => instantiateIn(bstate(b), b, store, className, parentId, bindings));

const destroyIn = (s: BibloState, store: NodeStore, id: InstanceId): void => {
  const inst = s.instances.get(id);
  if (!inst) return;
  for (const childId of [...inst.scope.children]) destroyIn(s, store, childId);
  removeNode(store, id);
  const parent = inst.scope.parent === undefined ? undefined : s.instances.get(inst.scope.parent);
  if (parent) {
    const idx = parent.scope.children.indexOf(id);
    if (idx >= 0) parent.scope.children.splice(idx, 1);
  }
  s.instances.delete(id);
};

/**
 * This function destroys an instance, the inverse of `instantiate`. It destroys the children first, then
 * removes the nodes of the instance and detaches it from its parent. The readers of the removed nodes
 * become `none` in one epoch.
 */
export const destroyInstance = (b: Biblo, store: NodeStore, instanceId: InstanceId): void => {
  batch(store, () => { destroyIn(bstate(b), store, instanceId); });
};

/**
 * This function gives the instance that owns a node: the node itself when it is an instance root,
 * otherwise the nearest owner up the slot tree. It gives `undefined` for a node outside all instances.
 */
export const ownerOf = (b: Biblo, store: NodeStore, nodeId: NodeId): InstanceId | undefined => {
  let current: NodeId | undefined = nodeId;
  for (let guard = 0; current !== undefined && guard < 10_000; guard++) {
    if (b.instances.has(current)) return current;
    current = store.nodes.get(current)?.parent;
  }
  return undefined;
};
