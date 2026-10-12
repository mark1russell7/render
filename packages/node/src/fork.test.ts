import { describe, it, expect } from "vitest";
import { addNode, batch, forkStore, nodeStore, readTargets, readValue, setSlot, setValue } from "@render/node";
import { app, lit, ref } from "@render/dsl";
import { unwrap } from "@render/optional";

const ops = {
  "+": (a: unknown, b: unknown) => (a as number) + (b as number),
  "*": (a: unknown, b: unknown) => (a as number) * (b as number),
};

/** A diamond: d reads b and c, which both read a. */
const diamond = () => {
  const store = nodeStore({ ops });
  addNode(store, lit(1), "a");
  addNode(store, app("+", ref("a"), lit(1)), "b");
  addNode(store, app("*", ref("a"), lit(2)), "c");
  addNode(store, app("+", ref("b"), ref("c")), "d");
  return store;
};

const v = (store: ReturnType<typeof nodeStore>, id: string): unknown => unwrap(readValue(store, id));

describe("readTargets", () => {
  it("gives the chain of nodes of a read path through the slots, and stops at a missing slot", () => {
    const store = diamond();
    addNode(store, lit(undefined), "box");
    setSlot(store, "box", "w", "a", { own: false });
    expect(readTargets(store.nodes, ["box", "w"]).map((n) => n.id)).toEqual(["box", "a"]);
    expect(readTargets(store.nodes, ["box", "nope", "x"]).map((n) => n.id)).toEqual(["box"]);
    expect(readTargets(store.nodes, ["missing"])).toEqual([]);
  });
});

describe("forkStore", () => {
  it("gives a copy with the same values, and the two stores change independently", () => {
    const store = diamond();
    const copy = forkStore(store);
    expect(v(copy, "d")).toBe(4);
    setValue(store, "a", 10);
    expect(v(store, "d")).toBe(31);
    expect(v(copy, "d")).toBe(4);
    setValue(copy, "a", 2);
    expect(v(copy, "d")).toBe(7);
    expect(v(store, "d")).toBe(31);
  });

  it("copies the seats, the slots and the counters, thus the same writes give the same IDs and epochs", () => {
    const store = diamond();
    addNode(store, lit(undefined), "box");
    setSlot(store, "box", "w", "a", { own: false });
    addNode(store, app("+", ref("box", "w"), lit(100)), "e");
    const copy = forkStore(store);
    const idA = addNode(store, lit(5));
    const idB = addNode(copy, lit(5));
    expect(idB).toBe(idA);
    setValue(store, "a", 3);
    setValue(copy, "a", 3);
    expect(v(copy, "e")).toBe(v(store, "e"));
    expect([...copy.epochStats!.evaluated].toSorted()).toEqual([...store.epochStats!.evaluated].toSorted());
  });

  it("keeps a dangling reader waiting in the copy", () => {
    const store = nodeStore({ ops });
    addNode(store, app("+", ref("later"), lit(1)), "r");
    const copy = forkStore(store);
    addNode(copy, lit(41), "later");
    expect(v(copy, "r")).toBe(42);
    expect(readValue(store, "r").tag).toBe("none");
  });

  it("refuses a store inside a batch", () => {
    const store = diamond();
    batch(store, () => {
      setValue(store, "a", 2);
      expect(() => forkStore(store)).toThrow(/batch/);
    });
  });
});
