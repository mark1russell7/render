import { describe, it, expect } from "vitest";
import {
  nodeStore,
  addNode,
  getNode,
  defaultSplash,
  defaultFlow,
  defaultDeref,
  node,
} from "@render/node";
import { lit } from "@render/dsl";
import { some, none, isSome, isNone } from "@render/optional";

describe("nodeStore / addNode / getNode", () => {
  it("creates an empty store", () => {
    const store = nodeStore();
    expect(store.nodes.size).toBe(0);
  });

  it("adds and retrieves a node", () => {
    const store = nodeStore();
    const n = node(lit(1), "a");
    addNode(store, n);
    expect(getNode(store, "a")).toBe(n);
  });

  it("returns undefined for missing id", () => {
    const store = nodeStore();
    expect(getNode(store, "missing")).toBeUndefined();
  });
});

describe("defaultSplash", () => {
  it("sets the node value and returns its seats", () => {
    const store = nodeStore();
    const n = node(lit(0), "a");
    n.seats.add("b");
    n.seats.add("c");
    addNode(store, n);

    const affected = defaultSplash(42, n, store);
    expect(isSome(n.value)).toBe(true);
    expect(n.value).toEqual(some(42));
    expect(affected).toEqual(new Set(["b", "c"]));
  });

  it("returns empty set when value is unchanged", () => {
    const store = nodeStore();
    const n = node(lit(0), "a");
    n.seats.add("b");
    addNode(store, n);

    // Set once
    defaultSplash(42, n, store);
    // Set again with same value
    const affected = defaultSplash(42, n, store);
    expect(affected.size).toBe(0);
  });

  it("returns seats when value changes from one to another", () => {
    const store = nodeStore();
    const n = node(lit(0), "a");
    n.seats.add("x");
    addNode(store, n);

    defaultSplash(1, n, store);
    const affected = defaultSplash(2, n, store);
    expect(affected).toEqual(new Set(["x"]));
  });
});

describe("defaultFlow", () => {
  it("returns the node seats as the next frontier", () => {
    const store = nodeStore();
    const n = node(lit(0), "a");
    n.seats.add("b");
    n.seats.add("c");

    const result = defaultFlow(n, new Set(), store);
    expect(result).toEqual(new Set(["b", "c"]));
  });
});

describe("defaultDeref", () => {
  it("walks slots by path segments", () => {
    const store = nodeStore();
    const parent = node(lit(0), "parent");
    const child = node(lit(0), "child");
    child.value = some(99);
    parent.slots.set("x", "child");
    addNode(store, parent);
    addNode(store, child);

    const result = defaultDeref(parent, ["x"], store);
    expect(result).toEqual(some(99));
  });

  it("returns none for missing slot", () => {
    const store = nodeStore();
    const n = node(lit(0), "a");
    addNode(store, n);

    const result = defaultDeref(n, ["missing"], store);
    expect(isNone(result)).toBe(true);
  });

  it("returns none for missing nested slot", () => {
    const store = nodeStore();
    const parent = node(lit(0), "parent");
    const child = node(lit(0), "child");
    parent.slots.set("x", "child");
    addNode(store, parent);
    addNode(store, child);

    const result = defaultDeref(parent, ["x", "y"], store);
    expect(isNone(result)).toBe(true);
  });
});
