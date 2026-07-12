import { describe, it, expect } from "vitest";
import {
  nodeStore,
  addNode,
  node,
  defaultOps,
  setValue,
  setExpr,
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
