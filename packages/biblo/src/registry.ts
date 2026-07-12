import type { ComponentClass, CellDef } from "./class.js";
import type { Instance, InstanceId } from "./instance.js";
import type { Expr } from "@render/dsl";
import type { NodeStore } from "@render/node";
import { node, addNode, removeNode } from "@render/node";
import { instance, addChild } from "./instance.js";

/**
 * The Biblo is the class registry + instance store.
 *
 * Classes live here as shared templates (never copied).
 * Instances are lightweight (id + scope).
 * Instance VALUES live in the node store, keyed by instance ID.
 */
export type Biblo = {
  readonly classes: Map<string, ComponentClass>;
  readonly instances: Map<InstanceId, Instance>;
};

export const biblo = (): Biblo => ({
  classes: new Map(),
  instances: new Map(),
});

/** Register a class template */
export const registerClass = (b: Biblo, cls: ComponentClass): void => {
  b.classes.set(cls.name, cls);
};

/**
 * Walk the extends chain from most-specific to root, cycle-safe.
 * A cycle (A extends B extends A) terminates at the repeated class.
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

/** Get all cell defs for a class, walking the extends chain (cycle-safe) */
export const resolveCells = (b: Biblo, className: string): Record<string, CellDef> => {
  const chain = extendsChain(b, className);
  const out: Record<string, CellDef> = {};
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(out, chain[i]!.cells);
  return out;
};

/**
 * Resolve all methods for a class, walking the extends chain (cycle-safe).
 * Most specific wins — a subclass method overrides its parent's.
 * This is the resolution: Top defines defaults,
 * each class refines only what it needs.
 */
export const resolveMethods = (b: Biblo, className: string): Record<string, unknown> => {
  const chain = extendsChain(b, className);
  const out: Record<string, unknown> = {};
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(out, chain[i]!.methods ?? {});
  return out;
};

/**
 * Instantiate a class — create an Instance, seed nodes in the store.
 * The class is NOT copied. The instance just gets an ID, scope, and
 * its cell defs materialized as nodes in the store.
 *
 * Typed cells (those with `type`) recursively instantiate a child of that class.
 * The parent slot wires directly to the child's root node, so deref walks through:
 *   ref("self", "keyView", "width") → parent root → keyView slot → child root → width slot
 *
 * Bindings override child cell expressions, wiring parent data to child cells.
 * Binding exprs use scope-relative refs (e.g. ref("parent", "key")) which get
 * resolved to absolute IDs during instantiation.
 */
export const instantiate = (
  b: Biblo,
  store: NodeStore,
  className: string,
  parentId?: InstanceId,
  bindings?: Readonly<Record<string, Expr>>,
): Instance => {
  const inst = instance(className, parentId);
  b.instances.set(inst.id, inst);

  // Wire parent-child
  if (parentId) {
    const parent = b.instances.get(parentId);
    if (parent) addChild(parent, inst);
  }

  // Create a root node for this instance
  const rootNode = node({ tag: "lit", value: undefined }, inst.id);
  addNode(store, rootNode);

  // Create nodes for each cell, as slots on the instance root
  const cells = resolveCells(b, className);
  for (const [name, def] of Object.entries(cells)) {
    if (def.type) {
      // Typed cell — instantiate a child of that class.
      // Bindings are in the CHILD's scope (e.g. ref("parent","key") means
      // "my parent's key"). They get resolved inside the child's instantiate.
      const child = instantiate(b, store, def.type, inst.id, def.bindings);
      // Wire parent slot directly to child root — deref walks through
      rootNode.slots.set(name, child.id);
      const childRoot = store.nodes.get(child.id);
      if (childRoot) childRoot.parent = rootNode.id;
    } else {
      // Regular cell — use binding override or class default expr
      const expr = bindings?.[name] ?? def.expr;
      const resolvedExpr = resolveExpr(expr, inst.id, parentId);
      const cellNodeId = `${inst.id}.${name}`;
      const cellNode = node(resolvedExpr, cellNodeId);
      cellNode.parent = rootNode.id;
      addNode(store, cellNode);
      rootNode.slots.set(name, cellNodeId);
    }
  }

  return inst;
};

/**
 * Destroy an instance: recursively destroy its children, remove its
 * nodes (root + cell slots) with seat invariants maintained, detach it
 * from its parent's scope and slots, and drop it from the registry.
 * The inverse of instantiate.
 */
export const destroyInstance = (b: Biblo, store: NodeStore, instanceId: InstanceId): void => {
  const inst = b.instances.get(instanceId);
  if (!inst) return;

  // Children first (copy — recursion mutates the array via detach)
  for (const childId of [...inst.scope.children]) {
    destroyInstance(b, store, childId);
  }

  // Remove this instance's nodes: cell slots, then the root.
  // (Typed-cell slots point at child instance ROOTS — already destroyed
  // by the recursion above; removeNode on a missing id is a no-op.)
  const rootNode = store.nodes.get(instanceId);
  if (rootNode) {
    for (const [, slotId] of rootNode.slots) {
      if (slotId !== instanceId) removeNode(store, slotId);
    }
    removeNode(store, instanceId);
  }

  // Detach from parent: scope.children and any typed-cell slot
  if (inst.scope.parent !== undefined) {
    const parent = b.instances.get(inst.scope.parent);
    if (parent) {
      const children = parent.scope.children as InstanceId[];
      const idx = children.indexOf(instanceId);
      if (idx >= 0) children.splice(idx, 1);
    }
    const parentRoot = store.nodes.get(inst.scope.parent);
    if (parentRoot) {
      for (const [name, slotId] of [...parentRoot.slots]) {
        if (slotId === instanceId) parentRoot.slots.delete(name);
      }
    }
  }

  b.instances.delete(instanceId);
};

/**
 * Resolve a scope-relative path for a specific instance.
 * "self" → instance ID, "parent" → parent instance ID, etc.
 */
export const resolveScope = (b: Biblo, instanceId: InstanceId, path: readonly string[]): readonly string[] | undefined => {
  const inst = b.instances.get(instanceId);
  if (!inst || path.length === 0) return undefined;

  const first = path[0]!;
  const rest = path.slice(1);

  switch (first) {
    case "self":
      return [inst.scope.self, ...rest];
    case "parent":
      return inst.scope.parent !== undefined ? [inst.scope.parent, ...rest] : undefined;
    case "children":
      // children paths need an index: ref("children", "0", "visual")
      return rest.length > 0 ? resolveChildPath(inst, rest) : undefined;
    case "biblo":
      // Pass through — direct biblo reference
      return path;
    default:
      // Already absolute or unknown scope
      return path;
  }
};

/**
 * Resolve scope-relative refs in an expression to absolute IDs.
 * "self" → selfId, "parent" → parentId. Recurses into App args.
 */
const resolveExpr = (expr: Expr, selfId: InstanceId, parentId: InstanceId | undefined): Expr => {
  switch (expr.tag) {
    case "lit":
      return expr;
    case "ref": {
      const resolved = resolveScopeRef(expr.path, selfId, parentId);
      return resolved ? { tag: "ref", path: resolved } : expr;
    }
    case "app":
      return {
        tag: "app",
        op: expr.op,
        args: expr.args.map(a => resolveExpr(a, selfId, parentId)),
      };
  }
};

/** Replace the first segment of a path if it's a scope keyword */
const resolveScopeRef = (
  path: readonly string[],
  selfId: InstanceId,
  parentId: InstanceId | undefined,
): readonly string[] | undefined => {
  if (path.length === 0) return undefined;
  const first = path[0]!;
  const rest = path.slice(1);
  switch (first) {
    case "self":
      return [selfId, ...rest];
    case "parent":
      return parentId !== undefined ? [parentId, ...rest] : undefined;
    default:
      return undefined; // not a scope ref, leave as-is
  }
};

const resolveChildPath = (inst: Instance, rest: readonly string[]): readonly string[] | undefined => {
  const indexStr = rest[0];
  if (indexStr === undefined) return undefined;
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0 || index >= inst.scope.children.length) return undefined;
  const childId = inst.scope.children[index]!;
  return [childId, ...rest.slice(1)];
};
