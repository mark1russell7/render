import { describe, it, expect } from "vitest";
import {
  nodeStore,
  addNode,
  node,
  defaultOps,
  setValue,
  setExpr,
  setSlot,
  expandNode,
  wireSeats,
  resolveAll,
  fillMany,
  resolve,
} from "@render/node";
import { lit, ref, app } from "@render/dsl";
import type { Ops } from "@render/dsl";
import { some, isSome, unwrap } from "@render/optional";

const dslOps: Ops = {
  "+": (a, b) => (a as number) + (b as number),
  "*": (a, b) => (a as number) * (b as number),
  identity: (a) => a,
};

describe("setValue", () => {
  it("updates a node value", () => {
    const store = nodeStore();
    const n = node(lit(0), "a");
    addNode(store, n);

    setValue(store, defaultOps, dslOps, "a", 42);
    expect(n.value).toEqual(some(42));
  });

  it("propagates to dependent nodes via seats", () => {
    const store = nodeStore();
    // 'a' is a literal, 'b' reads 'a' via ref
    const a = node(lit(0), "a");
    const b = node(ref("a"), "b");
    addNode(store, a);
    addNode(store, b);
    wireSeats(store);

    // 'b' depends on 'a', so 'a.seats' should contain 'b'
    expect(a.seats.has("b")).toBe(true);

    // Set a's value; b should re-evaluate to the propagated value
    setValue(store, defaultOps, dslOps, "a", 10);
    expect(unwrap(b.value)).toBe(10);
  });
});

describe("wireSeats", () => {
  it("establishes back-links from reads", () => {
    const store = nodeStore();
    const a = node(lit(1), "a");
    const b = node(ref("a"), "b");
    const c = node(app("+", ref("a"), ref("b")), "c");
    addNode(store, a);
    addNode(store, b);
    addNode(store, c);

    wireSeats(store);

    expect(a.seats.has("b")).toBe(true);
    expect(a.seats.has("c")).toBe(true);
    expect(b.seats.has("c")).toBe(true);
  });

  it("does nothing for nodes with no reads", () => {
    const store = nodeStore();
    const a = node(lit(1), "a");
    addNode(store, a);

    wireSeats(store);
    expect(a.seats.size).toBe(0);
  });
});

describe("resolveAll", () => {
  it("evaluates all nodes to fixpoint", () => {
    const store = nodeStore();
    // a = lit(5), b = lit(3), c = a + b
    const a = node(lit(5), "a");
    const b = node(lit(3), "b");
    const c = node(app("+", ref("a"), ref("b")), "c");
    addNode(store, a);
    addNode(store, b);
    addNode(store, c);

    resolveAll(store, defaultOps, dslOps);

    expect(a.value).toEqual(some(5));
    expect(b.value).toEqual(some(3));
    expect(c.value).toEqual(some(8));
  });

  it("handles chain of dependencies", () => {
    const store = nodeStore();
    // a = lit(2), b = a * 3, c = b + 1
    const a = node(lit(2), "a");
    const b = node(app("*", ref("a"), lit(3)), "b");
    const c = node(app("+", ref("b"), lit(1)), "c");
    addNode(store, a);
    addNode(store, b);
    addNode(store, c);

    resolveAll(store, defaultOps, dslOps);

    expect(b.value).toEqual(some(6));
    expect(c.value).toEqual(some(7));
  });
});

describe("fillMany", () => {
  it("batch-writes multiple values then flows to fixpoint", () => {
    const store = nodeStore();
    const a = node(lit(0), "a");
    const b = node(lit(0), "b");
    addNode(store, a);
    addNode(store, b);

    const writes = new Map<string, unknown>([
      ["a", 10],
      ["b", 20],
    ]);

    fillMany(store, defaultOps, dslOps, writes);

    expect(a.value).toEqual(some(10));
    expect(b.value).toEqual(some(20));
  });

  it("propagates after batch write", () => {
    const store = nodeStore();
    const a = node(lit(0), "a");
    const b = node(lit(0), "b");
    const c = node(app("+", ref("a"), ref("b")), "c");
    addNode(store, a);
    addNode(store, b);
    addNode(store, c);
    wireSeats(store);

    const writes = new Map<string, unknown>([
      ["a", 3],
      ["b", 7],
    ]);

    fillMany(store, defaultOps, dslOps, writes);
    // c should have been re-evaluated with BOTH new values
    expect(unwrap(c.value)).toBe(10);
  });
});

describe("source of truth (Phase 0)", () => {
  it("setValue rewrites the expr so resolveAll cannot clobber the edit", () => {
    const store = nodeStore();
    const a = node(lit("original"), "a");
    addNode(store, a);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);

    setValue(store, defaultOps, dslOps, "a", "edited");
    expect(a.expr).toEqual(lit("edited"));

    resolveAll(store, defaultOps, dslOps);
    expect(unwrap(a.value)).toBe("edited"); // survives — the regression that P0-1 found
  });

  it("setValue on a derived node converts it to an input node and unwires old seats", () => {
    const store = nodeStore();
    const a = node(lit(1), "a");
    const b = node(ref("a"), "b"); // derived from a
    addNode(store, a);
    addNode(store, b);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);
    expect(a.seats.has("b")).toBe(true);

    setValue(store, defaultOps, dslOps, "b", 99); // pin b to a literal
    expect(b.expr).toEqual(lit(99));
    expect(a.seats.has("b")).toBe(false); // unwired

    setValue(store, defaultOps, dslOps, "a", 5); // no longer flows into b
    expect(unwrap(b.value)).toBe(99);
  });

  it("setExpr rewires reads and re-evaluates through the graph", () => {
    const store = nodeStore();
    const a = node(lit(2), "a");
    const b = node(lit(3), "b");
    const c = node(ref("a"), "c");
    addNode(store, a);
    addNode(store, b);
    addNode(store, c);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);
    expect(unwrap(c.value)).toBe(2);

    // Repoint c from a to b*10
    setExpr(store, defaultOps, dslOps, "c", app("*", ref("b"), lit(10)));
    expect(unwrap(c.value)).toBe(30);
    expect(a.seats.has("c")).toBe(false);
    expect(b.seats.has("c")).toBe(true);

    // And the new dependency is live
    setValue(store, defaultOps, dslOps, "b", 4);
    expect(unwrap(c.value)).toBe(40);
  });

  it("a no-op write records an empty epoch", () => {
    const store = nodeStore();
    const a = node(lit(7), "a");
    addNode(store, a);
    resolveAll(store, defaultOps, dslOps);

    setValue(store, defaultOps, dslOps, "a", 7);
    expect(store.epochStats?.evaluated.size).toBe(0);
  });

  it("fillMany records epoch stats including write targets", () => {
    const store = nodeStore();
    const a = node(lit(0), "a");
    const b = node(lit(0), "b");
    const c = node(app("+", ref("a"), ref("b")), "c");
    addNode(store, a);
    addNode(store, b);
    addNode(store, c);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);

    fillMany(store, defaultOps, dslOps, new Map([["a", 3], ["b", 7]]));
    expect(unwrap(c.value)).toBe(10);
    const evaluated = store.epochStats?.evaluated ?? new Set();
    expect(evaluated.has("a")).toBe(true);
    expect(evaluated.has("b")).toBe(true);
    expect(evaluated.has("c")).toBe(true);
  });
});

describe("leaf-accurate propagation (Phase 1, ex-P0-2)", () => {
  /** Build an instance-like shape: root with a "key" slot cell */
  const makeRootWithCell = () => {
    const store = nodeStore();
    const root = node(lit(undefined), "R");
    const cell = node(lit("k1"), "R.key");
    cell.parent = "R";
    root.slots.set("key", "R.key");
    addNode(store, root);
    addNode(store, cell);
    return { store, root, cell };
  };

  it("a reader of ref(root, cell) updates when the CELL node is written", () => {
    const { store, cell } = makeRootWithCell();
    const reader = node(ref("R", "key"), "reader");
    addNode(store, reader);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);
    expect(unwrap(reader.value)).toBe("k1");

    // The reader is value-seated on the terminal (cell), not just the root
    expect(cell.seats.has("reader")).toBe(true);

    setValue(store, defaultOps, dslOps, "R.key", "k2");
    expect(unwrap(reader.value)).toBe("k2");
  });

  it("a whole-object reader of ref(root) updates when a slot cell changes (ancestor bubbling)", () => {
    const { store } = makeRootWithCell();
    const reader = node(ref("R"), "reader");
    addNode(store, reader);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);
    expect(unwrap(reader.value)).toEqual({ key: "k1" });

    setValue(store, defaultOps, dslOps, "R.key", "k2");
    expect(unwrap(reader.value)).toEqual({ key: "k2" });
  });

  it("records a minimal epoch: only the write and its true dependents", () => {
    const { store } = makeRootWithCell();
    const reader = node(ref("R", "key"), "reader");
    const bystander = node(lit(42), "bystander");
    addNode(store, reader);
    addNode(store, bystander);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);

    setValue(store, defaultOps, dslOps, "R.key", "k2");
    const evaluated = store.epochStats!.evaluated;
    expect(evaluated.has("R.key")).toBe(true);
    expect(evaluated.has("reader")).toBe(true);
    expect(evaluated.has("bystander")).toBe(false);
    expect(evaluated.has("R")).toBe(false); // parent's own expr isn't dirty
  });
});

describe("ordered epochs (AD-14: uneven diamond)", () => {
  it("a node with unequal-depth paths from the write sees settled values", () => {
    const store = nodeStore();
    // a → d (short arm), a → b → c → d (long arm)
    const a = node(lit(1), "a");
    const b = node(app("+", ref("a"), lit(0)), "b");
    const c = node(app("+", ref("b"), lit(0)), "c");
    const d = node(app("+", ref("a"), ref("c")), "d");
    addNode(store, a);
    addNode(store, b);
    addNode(store, c);
    addNode(store, d);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);
    expect(unwrap(d.value)).toBe(2);

    setValue(store, defaultOps, dslOps, "a", 10);
    // BFS-once would evaluate d in wave 1 with stale c (10 + 1 = 11)
    // and never revisit. Ordered epochs settle c first.
    expect(unwrap(c.value)).toBe(10);
    expect(unwrap(d.value)).toBe(20);
  });
});

describe("convergence with object-producing exprs (ex-P2-6)", () => {
  it("resolveAll settles fresh-object exprs in one ordered pass + one verify sweep", () => {
    const store = nodeStore();
    let calls = 0;
    const ops: Ops = {
      ...dslOps,
      fresh: (...args: readonly unknown[]) => {
        calls++;
        return [...args]; // new array identity every call, equal contents
      },
    };
    addNode(store, node(app("fresh", lit(1), lit(2)), "obj"));
    for (let i = 0; i < 4; i++) addNode(store, node(lit(i), `l${String(i)}`));

    resolveAll(store, defaultOps, ops);
    // one ordered evaluation + one no-change verification sweep —
    // NOT 2×N iterations (was 10 with reference equality)
    expect(calls).toBe(2);
  });
});

describe("setSlot — structural writes rewalk readers (Phase 6)", () => {
  it("re-pointing a slot rewires and re-evaluates readers of paths through it", () => {
    const store = nodeStore();
    const root = node(lit(undefined), "R");
    const cellA = node(lit("from-A"), "A");
    const cellB = node(lit("from-B"), "B");
    root.slots.set("x", "A");
    cellA.parent = "R";
    const reader = node(ref("R", "x"), "reader");
    addNode(store, root);
    addNode(store, cellA);
    addNode(store, cellB);
    addNode(store, reader);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);
    expect(unwrap(reader.value)).toBe("from-A");
    expect(cellA.seats.has("reader")).toBe(true);

    // Re-point R.x from A to B — the reader must rewalk and re-evaluate
    setSlot(store, defaultOps, dslOps, "R", "x", "B");
    expect(unwrap(reader.value)).toBe("from-B");
    expect(cellA.seats.has("reader")).toBe(false); // rewired away
    expect(cellB.seats.has("reader")).toBe(true);

    // ...and the NEW dependency is live
    setValue(store, defaultOps, dslOps, "B", "updated");
    expect(unwrap(reader.value)).toBe("updated");
  });

  it("adding a slot lets a previously dead-ended path resolve deeper", () => {
    const store = nodeStore();
    const root = node(lit(undefined), "R");
    const reader = node(ref("R", "later"), "reader");
    addNode(store, root);
    addNode(store, reader);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);
    expect(isSome(reader.value)).toBe(false); // path dead-ends

    const cell = node(lit(7), "C");
    addNode(store, cell);
    resolve(store, defaultOps, dslOps, "C");
    setSlot(store, defaultOps, dslOps, "R", "later", "C");
    expect(unwrap(reader.value)).toBe(7);
  });
});

describe("expandNode — materializes value fields as sub-slots (Phase 6)", () => {
  it("readers into the value gain leaf-accurate reactivity after expansion", () => {
    const store = nodeStore();
    const cell = node(lit({ a: 1, b: { c: 2 } }), "cell");
    const readerA = node(ref("cell", "a"), "readerA");
    const readerC = node(ref("cell", "b", "c"), "readerC");
    addNode(store, cell);
    addNode(store, readerA);
    addNode(store, readerC);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);
    // Pre-expansion: paths resolve by walking the plain value
    expect(unwrap(readerA.value)).toBe(1);
    expect(unwrap(readerC.value)).toBe(2);
    // ...but both readers dead-end AT the cell (no finer granularity)
    expect(cell.seats.has("readerA")).toBe(true);
    expect(cell.seats.has("readerC")).toBe(true);

    expandNode(store, defaultOps, dslOps, "cell");

    // Fields are now real nodes, recursively
    expect(store.nodes.has("cell.a")).toBe(true);
    expect(store.nodes.has("cell.b.c")).toBe(true);
    // Readers rewalked to their leaf terminals
    expect(store.nodes.get("cell.a")!.seats.has("readerA")).toBe(true);
    expect(store.nodes.get("cell.b.c")!.seats.has("readerC")).toBe(true);

    // Leaf edits propagate — and only to their own reader (pruning)
    setValue(store, defaultOps, dslOps, "cell.a", 42);
    expect(unwrap(readerA.value)).toBe(42);
    expect(unwrap(readerC.value)).toBe(2);
    expect(store.epochStats!.evaluated.has("readerC")).toBe(false);

    setValue(store, defaultOps, dslOps, "cell.b.c", 9);
    expect(unwrap(readerC.value)).toBe(9);
  });

  it("whole-object readers see slot values shadow the base value", () => {
    const store = nodeStore();
    const cell = node(lit({ x: 1 }), "cell");
    const whole = node(ref("cell"), "whole");
    addNode(store, cell);
    addNode(store, whole);
    wireSeats(store);
    resolveAll(store, defaultOps, dslOps);

    expandNode(store, defaultOps, dslOps, "cell");
    setValue(store, defaultOps, dslOps, "cell.x", 5);
    expect(unwrap(whole.value)).toEqual({ x: 5 });
  });
});

describe("pruning (Phase 6.3)", () => {
  it("downstream nodes are NOT evaluated when an intermediate value stabilizes", () => {
    const store = nodeStore();
    const abs = (v: unknown): number => Math.abs(v as number);
    const ops: Ops = { ...dslOps, abs };
    const a = node(lit(5), "a");
    const m = node(app("abs", ref("a")), "m");
    const r = node(ref("m"), "r");
    addNode(store, a);
    addNode(store, m);
    addNode(store, r);
    wireSeats(store);
    resolveAll(store, defaultOps, ops);
    expect(unwrap(r.value)).toBe(5);

    // a: 5 → -5. abs(a) stays 5 — r must be pruned from the epoch.
    setValue(store, defaultOps, ops, "a", -5);
    const evaluated = store.epochStats!.evaluated;
    expect(evaluated.has("m")).toBe(true);
    expect(evaluated.has("r")).toBe(false);
    expect(unwrap(r.value)).toBe(5);
  });
});

describe("resolve", () => {
  it("evaluates a single node expression", () => {
    const store = nodeStore();
    const a = node(lit(42), "a");
    addNode(store, a);

    resolve(store, defaultOps, dslOps, "a");
    // lit(42) evaluates to some(42), then splash writes it
    expect(a.value).toEqual(some(42));
  });

  it("evaluates a node that references another", () => {
    const store = nodeStore();
    const a = node(lit(0), "a");
    a.value = some(5);
    const b = node(ref("a"), "b");
    addNode(store, a);
    addNode(store, b);

    resolve(store, defaultOps, dslOps, "b");
    expect(isSome(b.value)).toBe(true);
    expect(unwrap(b.value)).toBe(5);
  });

  it("does nothing for a missing node id", () => {
    const store = nodeStore();
    // Should not throw
    resolve(store, defaultOps, dslOps, "nonexistent");
  });
});
