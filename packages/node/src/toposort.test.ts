import { describe, it, expect } from "vitest";
import { nodeStore, addNode, toposort } from "@render/node";
import { lit, ref, app } from "@render/dsl";

describe("toposort", () => {
  it("returns correct order for a linear chain", () => {
    const store = nodeStore();
    // a -> b -> c
    addNode(store, lit(1), "a");
    addNode(store, ref("a"), "b");
    addNode(store, ref("b"), "c");

    const order = toposort(store);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });

  it("handles diamond dependencies", () => {
    const store = nodeStore();
    // a -> b, a -> c, b -> d, c -> d
    addNode(store, lit(1), "a");
    addNode(store, ref("a"), "b");
    addNode(store, ref("a"), "c");
    addNode(store, app("+", ref("b"), ref("c")), "d");

    const order = toposort(store);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
    expect(order).toHaveLength(4);
  });

  it("returns single node for a store with one node", () => {
    const store = nodeStore();
    addNode(store, lit(1), "a");

    expect(toposort(store)).toEqual(["a"]);
  });

  it("returns empty array for an empty store", () => {
    const store = nodeStore();
    expect(toposort(store)).toEqual([]);
  });

  it("omits nodes involved in a cycle", () => {
    const store = nodeStore();
    // a -> b -> a (cycle), c is standalone
    addNode(store, ref("b"), "a");
    addNode(store, ref("a"), "b");
    addNode(store, lit(1), "c");

    const order = toposort(store);
    // c has no deps, should be in the result
    expect(order).toContain("c");
    // a and b form a cycle; both should be omitted
    expect(order).not.toContain("a");
    expect(order).not.toContain("b");
  });

  it("includes nodes that read dangling roots (missing from store)", () => {
    const store = nodeStore();
    // b reads "ghost" which is not in the store — b must still be ordered
    addNode(store, lit(1), "a");
    addNode(store, app("+", ref("ghost"), ref("a")), "b");

    const order = toposort(store);
    expect(order).toContain("b");
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
  });

  it("handles nodes with no dependencies alongside dependent ones", () => {
    const store = nodeStore();
    addNode(store, lit(1), "a");
    addNode(store, lit(2), "b");
    addNode(store, app("+", ref("a"), ref("b")), "c");

    const order = toposort(store);
    expect(order).toHaveLength(3);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });
});
