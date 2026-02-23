import { describe, it, expect } from "vitest";
import {
  nodeStore,
  addNode,
  node,
  defaultOps,
  setValue,
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

    // Set a's value; b should re-evaluate
    setValue(store, defaultOps, dslOps, "a", 10);
    // b reads ref("a") which resolves from context as a's value
    expect(isSome(b.value)).toBe(true);
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
    // c should have been re-evaluated to 10
    expect(isSome(c.value)).toBe(true);
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
