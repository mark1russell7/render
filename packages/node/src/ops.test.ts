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
import { some, isSome, isNone } from "@render/optional";

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
  it("writes the value and reports the change", () => {
    const store = nodeStore();
    const n = node(lit(0), "a");
    addNode(store, n);

    expect(defaultSplash(42, n, store)).toBe(true);
    expect(isSome(n.value)).toBe(true);
    expect(n.value).toEqual(some(42));
  });

  it("reports false when the value is unchanged", () => {
    const store = nodeStore();
    const n = node(lit(0), "a");
    addNode(store, n);

    defaultSplash(42, n, store);
    expect(defaultSplash(42, n, store)).toBe(false);
  });

  it("uses structural equality — an equal fresh object is not a change", () => {
    const store = nodeStore();
    const n = node(lit(0), "a");
    addNode(store, n);

    defaultSplash({ x: [1, 2] }, n, store);
    expect(defaultSplash({ x: [1, 2] }, n, store)).toBe(false);
    expect(defaultSplash({ x: [1, 3] }, n, store)).toBe(true);
  });
});

describe("defaultFlow", () => {
  it("returns the node's seats as the frontier", () => {
    const store = nodeStore();
    const n = node(lit(0), "a");
    n.seats.add("b");
    n.seats.add("c");
    addNode(store, n);

    expect(defaultFlow(n, store)).toEqual(new Set(["b", "c"]));
  });

  it("bubbles to slot-ancestors' seats (whole-object readers)", () => {
    const store = nodeStore();
    const root = node(lit(undefined), "R");
    const cell = node(lit(1), "R.x");
    cell.parent = "R";
    root.slots.set("x", "R.x");
    root.seats.add("wholeReader");
    cell.seats.add("cellReader");
    addNode(store, root);
    addNode(store, cell);

    expect(defaultFlow(cell, store)).toEqual(new Set(["cellReader", "wholeReader"]));
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

  it("returns none for missing slot on a value-less node", () => {
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

  it("continues through plain value fields after slots end (hybrid walk)", () => {
    const store = nodeStore();
    const parent = node(lit(0), "parent");
    const child = node(lit(0), "child");
    child.value = some({ deep: { leaf: 7 } });
    parent.slots.set("x", "child");
    addNode(store, parent);
    addNode(store, child);

    expect(defaultDeref(parent, ["x", "deep", "leaf"], store)).toEqual(some(7));
  });

  it("materializes a slotted node for whole-object reads", () => {
    const store = nodeStore();
    const root = node(lit(undefined), "R");
    const cell = node(lit(0), "R.x");
    cell.value = some(5);
    root.slots.set("x", "R.x");
    addNode(store, root);
    addNode(store, cell);

    expect(defaultDeref(root, [], store)).toEqual(some({ x: 5 }));
  });
});
