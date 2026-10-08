import { describe, it, expect } from "vitest";
import {
  nodeStore, addNode, getNode, readValue, setSlot, defaultSplash, defaultFlow, defaultDeref, valueEquals,
} from "@render/node";
import { lit, ref } from "@render/dsl";
import { some, none, isNone } from "@render/optional";

describe("nodeStore, getNode and readValue", () => {
  it("make an empty store and read its nodes", () => {
    const store = nodeStore();
    expect(store.nodes.size).toBe(0);
    addNode(store, lit(1), "a");
    expect(getNode(store, "a")?.id).toBe("a");
    expect(getNode(store, "missing")).toBeUndefined();
    expect(readValue(store, "a")).toEqual(some(1));
    expect(isNone(readValue(store, "missing"))).toBe(true);
  });
});

describe("defaultSplash", () => {
  const target = () => getNode((() => { const s = nodeStore(); addNode(s, lit(undefined), "a"); return s; })(), "a")!;

  it("writes a new value and reports the change", () => {
    const n = target();
    expect(defaultSplash(some(42), n, nodeStore())).toBe(true);
    expect(n.value).toEqual(some(42));
  });

  it("reports no change for a structurally equal value, and keeps the old reference", () => {
    const n = target();
    const first = { x: [1, 2] };
    defaultSplash(some(first), n, nodeStore());
    expect(defaultSplash(some({ x: [1, 2] }), n, nodeStore())).toBe(false);
    expect((n.value as { value: unknown }).value).toBe(first);
    expect(defaultSplash(some({ x: [1, 3] }), n, nodeStore())).toBe(true);
  });

  it("R-07: a change to none, and from none, is a change", () => {
    const n = target();
    expect(defaultSplash(none, n, nodeStore())).toBe(true);
    expect(isNone(n.value)).toBe(true);
    expect(defaultSplash(none, n, nodeStore())).toBe(false);
    expect(defaultSplash(some(undefined), n, nodeStore())).toBe(true);
  });
});

describe("defaultFlow", () => {
  it("gives the value readers of the node", () => {
    const store = nodeStore();
    addNode(store, lit(0), "a");
    addNode(store, ref("a"), "b");
    addNode(store, ref("a"), "c");
    expect(defaultFlow(getNode(store, "a")!, store)).toEqual(new Set(["b", "c"]));
  });
});

describe("defaultDeref", () => {
  const store = nodeStore();
  addNode(store, lit(undefined), "parent");
  addNode(store, lit({ deep: { leaf: 7 } }), "child");
  setSlot(store, "parent", "x", "child");
  const parent = getNode(store, "parent")!;

  it("goes through slots, then through the fields of the value", () => {
    expect(defaultDeref(parent, ["x"], store)).toEqual(some({ deep: { leaf: 7 } }));
    expect(defaultDeref(parent, ["x", "deep", "leaf"], store)).toEqual(some(7));
  });

  it("gives the record of a container for a path that ends on it", () => {
    expect(defaultDeref(parent, [], store)).toEqual(some({ x: { deep: { leaf: 7 } } }));
  });

  it("gives none for a missing slot or field, and for an inherited property", () => {
    expect(isNone(defaultDeref(parent, ["missing"], store))).toBe(true);
    expect(isNone(defaultDeref(parent, ["x", "deep", "nope"], store))).toBe(true);
    expect(isNone(defaultDeref(parent, ["x", "constructor"], store))).toBe(true);
  });
});

describe("valueEquals", () => {
  it("compares plain data structurally", () => {
    expect(valueEquals({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(valueEquals({ a: 1 }, { a: 2 })).toBe(false);
    expect(valueEquals([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(valueEquals(Number.NaN, Number.NaN)).toBe(true);
  });

  it("R-15: a key that is only inherited is not present", () => {
    expect(valueEquals({ toString: 1 }, { valueOf: 1 })).toBe(false);
    expect(valueEquals({ constructor: Object }, { other: Object })).toBe(false);
  });

  it("compares an exotic object by reference only", () => {
    class Box { readonly v: number; constructor(v: number) { this.v = v; } }
    const b = new Box(1);
    expect(valueEquals(b, b)).toBe(true);
    expect(valueEquals(new Box(1), new Box(1))).toBe(false);
  });

  it("stops at a cyclic value", () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;
    const b: Record<string, unknown> = {};
    b["self"] = b;
    expect(valueEquals(a, b)).toBe(false);
  });
});
