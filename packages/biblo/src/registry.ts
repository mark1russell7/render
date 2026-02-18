import type { ComponentClass, CellDef } from "./class.js";
import type { Instance, InstanceId } from "./instance.js";
import type { DepPath } from "@render/dsl";
import type { SeatRegistry } from "@render/seat";
import { deps } from "@render/dsl";
import { instance, addChild } from "./instance.js";
import { register } from "@render/seat";

/**
 * The Biblo is the class registry + instance store.
 *
 * Classes live here as shared templates (never copied).
 * Instances are lightweight (id + scope).
 * Instance VALUES live in the seat graph, keyed by instance ID.
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
 * Instantiate a class — create an Instance, seed defaults in the seat graph.
 * The class is NOT copied. The instance just gets an ID, scope, and
 * its default values registered in the seat graph.
 */
export const instantiate = (
  b: Biblo,
  seats: SeatRegistry,
  className: string,
  parentId?: InstanceId,
): Instance => {
  const inst = instance(className, parentId);
  b.instances.set(inst.id, inst);

  // Wire parent-child
  if (parentId) {
    const parent = b.instances.get(parentId);
    if (parent) addChild(parent, inst);
  }

  // Seed default values in the seat graph
  const cells = resolveCells(b, className);
  for (const [name, def] of Object.entries(cells)) {
    if (def.default !== undefined) {
      // Register the path so the seat graph knows about it
      register(seats, [inst.id, name]);
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

const resolveChildPath = (inst: Instance, rest: readonly string[]): readonly string[] | undefined => {
  const indexStr = rest[0];
  if (indexStr === undefined) return undefined;
  const index = Number(indexStr);
  if (!Number.isInteger(index) || index < 0 || index >= inst.scope.children.length) return undefined;
  const childId = inst.scope.children[index]!;
  return [childId, ...rest.slice(1)];
};
