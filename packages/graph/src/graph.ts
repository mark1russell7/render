import type { Cell, CellId } from "@render/cell";
import type { Ops } from "@render/dsl";
import type { SeatRegistry } from "@render/seat";
import { evaluate } from "@render/dsl";
import { isSome } from "@render/optional";
import { peek } from "@render/seat";

/**
 * A CellGraph holds all cells, their dependency edges, and evaluation order.
 * It's the "compiled" form that enables FillMany.
 */
export type CellGraph = {
  readonly cells: Map<CellId, Cell>;
  /** cell → set of cells that depend on it (reverse edges) */
  readonly dependedBy: Map<CellId, Set<CellId>>;
  /** topological evaluation order */
  readonly order: readonly CellId[];
};

/**
 * Build a cell graph from a set of cells.
 * Wires reverse edges and computes topological order.
 */
export const cellGraph = (cells: readonly Cell[]): CellGraph => {
  const map = new Map<CellId, Cell>();
  for (const c of cells) map.set(c.id, c);

  // Build dependedBy reverse index
  // A cell's reads are paths — the first segment of each path is the dependency root
  const dependedBy = new Map<CellId, Set<CellId>>();
  for (const c of cells) {
    for (const path of c.reads) {
      const root = path[0];
      if (root === undefined) continue;
      if (!dependedBy.has(root)) dependedBy.set(root, new Set());
      dependedBy.get(root)!.add(c.id);
    }
  }

  return { cells: map, dependedBy, order: toposort(map, dependedBy) };
};

/** Evaluate all cells in topological order (full resolve) */
export const resolveAll = (g: CellGraph, reg: SeatRegistry, ops: Ops): void => {
  for (const id of g.order) {
    resolveCell(g, id, reg, ops);
  }
};

/** Resolve a single cell by evaluating its expr against seat-resolved context */
const resolveCell = (g: CellGraph, id: CellId, reg: SeatRegistry, ops: Ops): void => {
  const c = g.cells.get(id);
  if (!c) return;
  const ctx = buildContext(c, reg);
  c.value = evaluate(c.expr, ctx, ops);
};

/**
 * FillMany: given a set of changed cell ids (one causal batch),
 * compute the transitive closure of affected cells,
 * toposort within that closure, and evaluate each once.
 */
export const fillMany = (g: CellGraph, changed: ReadonlySet<CellId>, reg: SeatRegistry, ops: Ops): void => {
  // 1. Compute transitive closure of affected cells
  const affected = transitiveClosure(g, changed);

  // 2. Evaluate in topological order (only affected cells)
  for (const id of g.order) {
    if (affected.has(id)) {
      const c = g.cells.get(id);
      if (!c) continue;
      const ctx = buildContext(c, reg);
      c.value = evaluate(c.expr, ctx, ops);
    }
  }
};

/** Propagate a single change — re-evaluate the cell and its transitive dependents */
export const propagate = (g: CellGraph, id: CellId, reg: SeatRegistry, ops: Ops): void => {
  fillMany(g, new Set([id]), reg, ops);
};

/** Compute all cells transitively affected by a set of changed cells */
const transitiveClosure = (g: CellGraph, roots: ReadonlySet<CellId>): Set<CellId> => {
  const affected = new Set<CellId>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (affected.has(id)) continue;
    affected.add(id);
    const deps = g.dependedBy.get(id);
    if (deps) {
      for (const depId of deps) {
        if (!affected.has(depId)) queue.push(depId);
      }
    }
  }
  return affected;
};

/** Build evaluation context for a cell from the seat registry */
const buildContext = (c: Cell, reg: SeatRegistry): Record<string, unknown> => {
  const ctx: Record<string, unknown> = {};
  for (const path of c.reads) {
    const val = peek(reg, path);
    if (isSome(val)) {
      // Set the root key so path-based eval can walk from there
      const root = path[0];
      if (root !== undefined && !(root in ctx)) {
        const rootVal = peek(reg, [root]);
        if (isSome(rootVal)) {
          ctx[root] = rootVal.value;
        }
      }
    }
  }
  return ctx;
};

/** Kahn's algorithm — topological sort */
const toposort = (cells: ReadonlyMap<CellId, Cell>, dependedBy: ReadonlyMap<CellId, Set<CellId>>): CellId[] => {
  const inDegree = new Map<CellId, number>();
  for (const id of cells.keys()) {
    if (!inDegree.has(id)) inDegree.set(id, 0);
  }
  for (const [_source, deps] of dependedBy) {
    for (const depId of deps) {
      inDegree.set(depId, (inDegree.get(depId) ?? 0) + 1);
    }
  }

  const queue: CellId[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: CellId[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const deps = dependedBy.get(id);
    if (!deps) continue;
    for (const depId of deps) {
      const d = (inDegree.get(depId) ?? 1) - 1;
      inDegree.set(depId, d);
      if (d === 0) queue.push(depId);
    }
  }

  return order;
};
