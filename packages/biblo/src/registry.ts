import type { ComponentClass, CellDef } from "./class.js";
import type { Instance, InstanceId } from "./instance.js";
import type { Expr, DepPath } from "@render/dsl";
import type { NodeStore } from "@render/node";
import { deps } from "@render/dsl";
import { node, addNode } from "@render/node";
import { some } from "@render/optional";
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

/** Get all cell defs for a class, walking the extends chain */
export const resolveCells = (b: Biblo, className: string): Record<string, CellDef> => {
  const cls = b.classes.get(className);
  if (!cls) return {};
  const parentCells = cls.extends ? resolveCells(b, cls.extends) : {};
  return { ...parentCells, ...cls.cells };
};

/**
 * Resolve all methods for a class, walking the extends chain.
 * Most specific wins — a subclass method overrides its parent's.
 * This is the resolution: Top defines defaults,
 * each class refines only what it needs.
 */
export const resolveMethods = (b: Biblo, className: string): Record<string, unknown> => {
  const cls = b.classes.get(className);
  if (!cls) return {};
  const parentMethods = cls.extends ? resolveMethods(b, cls.extends) : {};
  return { ...parentMethods, ...(cls.methods ?? {}) };
};

/**
 * Pre-analyze reachable paths from a class.
 * Walks typed cell references to discover the full path structure
 * at the class level — before any instances exist.
 */
export const analyzePathStructure = (
  b: Biblo,
  className: string,
  prefix: readonly string[] = [],
  visited: Set<string> = new Set(),
): DepPath[] => {
  if (visited.has(className)) return [];
  visited.add(className);

  const cells = resolveCells(b, className);
  const paths: DepPath[] = [];

  for (const [name, def] of Object.entries(cells)) {
    const cellPath = [...prefix, name];
    paths.push(cellPath);

    // If this cell has a known type, recurse to discover deeper paths
    if (def.type) {
      const deeper = analyzePathStructure(b, def.type, cellPath, visited);
      for (const p of deeper) paths.push(p);
    }

    // Also extract paths from the expression itself
    for (const dep of deps(def.expr)) {
      paths.push([...prefix, ...dep]);
    }
  }

  return paths;
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
    } else {
      // Regular cell — use binding override or class default expr
      const expr = bindings?.[name] ?? def.expr;
      const resolvedExpr = resolveExpr(expr, inst.id, parentId);
      const cellNodeId = `${inst.id}.${name}`;
      const cellNode = node(resolvedExpr, cellNodeId);
      if (def.default !== undefined && !(name in (bindings ?? {}))) {
        cellNode.value = some(def.default);
      }
      addNode(store, cellNode);
      rootNode.slots.set(name, cellNodeId);
    }
  }

  return inst;
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
