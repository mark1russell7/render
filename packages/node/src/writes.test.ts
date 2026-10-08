import { describe, it, expect } from "vitest";
import {
  nodeStore, addNode, getNode, readValue, batch, setValue, setExpr, setSlot, expandNode,
  removeNode, resolveAll, fillMany, defaultOps,
} from "@render/node";
import type { NodeStore, NodeOps } from "@render/node";
import { lit, ref, app } from "@render/dsl";
import type { Ops } from "@render/dsl";
import { isNone, unwrap } from "@render/optional";

const dslOps: Ops = {
  "+": (a, b) => (a as number) + (b as number),
  "*": (a, b) => (a as number) * (b as number),
  abs: (a) => Math.abs(a as number),
};

const make = (ops: Ops = dslOps, nodeOps?: NodeOps): NodeStore => nodeStore({ ops, nodeOps });
const v = (store: NodeStore, id: string): unknown => unwrap(readValue(store, id));
const node = (store: NodeStore, id: string) => getNode(store, id)!;
const evaluated = (store: NodeStore): ReadonlySet<string> => store.epochStats!.evaluated;

/** A container "R" with one slot "key" that holds the cell "R.key" */
const rootWithCell = (store: NodeStore): void => {
  addNode(store, lit(undefined), "R");
  addNode(store, lit("k1"), "R.key");
  setSlot(store, "R", "key", "R.key");
};

describe("addNode", () => {
  it("adds, wires and evaluates a node", () => {
    const store = make();
    addNode(store, lit(5), "a");
    addNode(store, app("*", ref("a"), lit(3)), "b");
    expect(v(store, "b")).toBe(15);
    expect(node(store, "a").seats.has("b")).toBe(true);
  });

  it("uses the hint as the ID when it is free, and a fresh ID otherwise", () => {
    const store = make();
    expect(addNode(store, lit(1), "a")).toBe("a");
    const second = addNode(store, lit(2), "a");
    expect(second).not.toBe("a");
    expect(v(store, "a")).toBe(1);
    expect(v(store, second)).toBe(2);
  });

  it("gives IDs from a counter of each store", () => {
    const a = make();
    const b = make();
    expect(addNode(a, lit(1))).toBe(addNode(b, lit(1)));
  });

  it("R-13: a reader added before its target finds the target when it comes", () => {
    const store = make();
    addNode(store, app("+", ref("later"), lit(1)), "reader");
    expect(isNone(readValue(store, "reader"))).toBe(true);
    addNode(store, lit(41), "later");
    expect(v(store, "reader")).toBe(42);
    setValue(store, "later", 1);
    expect(v(store, "reader")).toBe(2);
  });
});

describe("setValue and setExpr", () => {
  it("propagate to the readers", () => {
    const store = make();
    addNode(store, lit(0), "a");
    addNode(store, ref("a"), "b");
    setValue(store, "a", 10);
    expect(v(store, "b")).toBe(10);
  });

  it("rewrite the expression, thus resolveAll cannot revert a write", () => {
    const store = make();
    addNode(store, lit("original"), "a");
    setValue(store, "a", "edited");
    expect(node(store, "a").expr).toEqual(lit("edited"));
    resolveAll(store);
    expect(v(store, "a")).toBe("edited");
  });

  it("make a derived node an input node and unwire its old reads", () => {
    const store = make();
    addNode(store, lit(1), "a");
    addNode(store, ref("a"), "b");
    setValue(store, "b", 99);
    expect(node(store, "a").seats.has("b")).toBe(false);
    setValue(store, "a", 5);
    expect(v(store, "b")).toBe(99);
  });

  it("setExpr rewires the reads and evaluates through the graph", () => {
    const store = make();
    addNode(store, lit(2), "a");
    addNode(store, lit(3), "b");
    addNode(store, ref("a"), "c");
    setExpr(store, "c", app("*", ref("b"), lit(10)));
    expect(v(store, "c")).toBe(30);
    expect(node(store, "a").seats.has("c")).toBe(false);
    setValue(store, "b", 4);
    expect(v(store, "c")).toBe(40);
  });

  it("a write that changes nothing records an empty epoch", () => {
    const store = make();
    addNode(store, lit(7), "a");
    addNode(store, ref("a"), "b");
    setValue(store, "a", 7);
    expect(store.epochStats!.changed.size).toBe(0);
    expect(evaluated(store).has("b")).toBe(false);
  });

  it("a write to a missing node does nothing and records an empty epoch", () => {
    const store = make();
    setValue(store, "ghost", 1);
    expect(store.nodes.size).toBe(0);
    expect(evaluated(store).size).toBe(0);
  });

  it("R-07: a node whose expression stops resolving becomes none, and its readers follow", () => {
    const store = make();
    addNode(store, lit(1), "a");
    addNode(store, ref("a"), "b");
    setExpr(store, "a", ref("missing"));
    expect(isNone(readValue(store, "a"))).toBe(true);
    expect(isNone(readValue(store, "b"))).toBe(true);
  });

  it("R-07: a reader of a field becomes none when the field disappears", () => {
    const store = make();
    addNode(store, lit({ x: 1 }), "a");
    addNode(store, ref("a", "x"), "b");
    setValue(store, "a", { y: 2 });
    expect(isNone(readValue(store, "b"))).toBe(true);
    setValue(store, "a", { x: 3 });
    expect(v(store, "b")).toBe(3);
  });
});

describe("batch and fillMany", () => {
  it("fillMany writes all values, then runs one epoch", () => {
    const store = make();
    addNode(store, lit(0), "a");
    addNode(store, lit(0), "b");
    addNode(store, app("+", ref("a"), ref("b")), "c");
    fillMany(store, [["a", 3], ["b", 7]]);
    expect(v(store, "c")).toBe(10);
    expect([...evaluated(store)].toSorted()).toEqual(["a", "b", "c"]);
  });

  it("a batch evaluates each reader one time, after all its writes", () => {
    let calls = 0;
    const store = make({ ...dslOps, count: (a, b) => { calls++; return (a as number) + (b as number); } });
    addNode(store, lit(0), "a");
    addNode(store, lit(0), "b");
    addNode(store, app("count", ref("a"), ref("b")), "c");
    calls = 0;
    batch(store, () => {
      setValue(store, "a", 1);
      setValue(store, "b", 2);
      expect(v(store, "c")).toBe(0); // the epoch runs at the end of the batch
    });
    expect(v(store, "c")).toBe(3);
    expect(calls).toBe(1);
  });

  it("a batch inside a batch joins the outer batch", () => {
    const store = make();
    addNode(store, lit(0), "a");
    addNode(store, ref("a"), "b");
    batch(store, () => {
      batch(store, () => { setValue(store, "a", 1); });
      expect(v(store, "b")).toBe(0);
    });
    expect(v(store, "b")).toBe(1);
  });

  it("nodes added in a batch can read each other in any order", () => {
    const store = make();
    batch(store, () => {
      addNode(store, app("*", ref("w"), ref("h")), "area");
      addNode(store, lit(2), "w");
      addNode(store, lit(3), "h");
    });
    expect(v(store, "area")).toBe(6);
  });
});

describe("leaf-accurate propagation", () => {
  it("a reader of ref(root, cell) has a value seat on the cell and follows it", () => {
    const store = make();
    rootWithCell(store);
    addNode(store, ref("R", "key"), "reader");
    expect(v(store, "reader")).toBe("k1");
    expect(node(store, "R.key").seats.has("reader")).toBe(true);
    expect(node(store, "R").seatsStructural.has("reader")).toBe(true);
    setValue(store, "R.key", "k2");
    expect(v(store, "reader")).toBe("k2");
  });

  it("a container is the record of its slots, and a whole reader follows a slot change", () => {
    const store = make();
    rootWithCell(store);
    addNode(store, ref("R"), "reader");
    expect(v(store, "R")).toEqual({ key: "k1" });
    expect(v(store, "reader")).toEqual({ key: "k1" });
    setValue(store, "R.key", "k2");
    expect(v(store, "reader")).toEqual({ key: "k2" });
  });

  it("an epoch evaluates only the write and its true dependents", () => {
    const store = make();
    rootWithCell(store);
    addNode(store, ref("R", "key"), "reader");
    addNode(store, lit(42), "bystander");
    setValue(store, "R.key", "k2");
    expect([...evaluated(store)].toSorted()).toEqual(["R", "R.key", "reader"]);
  });
});

describe("ordered epochs", () => {
  it("AD-14: a node with paths of unequal length from the write reads settled values", () => {
    const store = make();
    addNode(store, lit(1), "a");
    addNode(store, app("+", ref("a"), lit(0)), "b");
    addNode(store, app("+", ref("b"), lit(0)), "c");
    addNode(store, app("+", ref("a"), ref("c")), "d");
    expect(v(store, "d")).toBe(2);
    setValue(store, "a", 10);
    expect(v(store, "d")).toBe(20);
  });

  it("the pruning: a reader of a value that did not change is not evaluated", () => {
    const store = make();
    addNode(store, lit(5), "a");
    addNode(store, app("abs", ref("a")), "m");
    addNode(store, ref("m"), "r");
    setValue(store, "a", -5);
    expect(evaluated(store).has("m")).toBe(true);
    expect(evaluated(store).has("r")).toBe(false);
  });

  it("an expression that makes a new equal object each time settles in one evaluation", () => {
    let calls = 0;
    const store = make({ fresh: (...args) => { calls++; return [...args]; } });
    addNode(store, app("fresh", lit(1), lit(2)), "obj");
    for (let i = 0; i < 4; i++) addNode(store, lit(i), `l${String(i)}`);
    calls = 0;
    resolveAll(store);
    expect(calls).toBe(1);
  });

  it("R-12: resolveAll evaluates a node that reads itself one time", () => {
    const store = make();
    for (let i = 0; i < 50; i++) addNode(store, lit(i), `z${String(i)}`);
    addNode(store, lit(0), "c");
    setExpr(store, "c", app("+", ref("c"), lit(1)));
    const before = v(store, "c") as number;
    resolveAll(store);
    expect(v(store, "c")).toBe(before + 1);
  });

  it("reports the nodes on a cycle and evaluates each of them one time", () => {
    const store = make();
    addNode(store, lit(1), "x");
    batch(store, () => {
      addNode(store, app("+", ref("x"), ref("q")), "p");
      addNode(store, ref("p"), "q");
    });
    expect([...store.epochStats!.cyclic].toSorted()).toEqual(["p", "q"]);
  });
});

describe("setSlot", () => {
  it("re-pointing a slot rewires and evaluates the readers of paths through it", () => {
    const store = make();
    addNode(store, lit(undefined), "R");
    addNode(store, lit("from-A"), "A");
    addNode(store, lit("from-B"), "B");
    setSlot(store, "R", "x", "A");
    addNode(store, ref("R", "x"), "reader");
    expect(v(store, "reader")).toBe("from-A");
    setSlot(store, "R", "x", "B");
    expect(v(store, "reader")).toBe("from-B");
    expect(node(store, "A").seats.has("reader")).toBe(false);
    setValue(store, "B", "updated");
    expect(v(store, "reader")).toBe("updated");
  });

  it("a new slot lets a path that ended early resolve deeper", () => {
    const store = make();
    addNode(store, lit(undefined), "R");
    addNode(store, ref("R", "later"), "reader");
    expect(isNone(readValue(store, "reader"))).toBe(true);
    addNode(store, lit(7), "C");
    setSlot(store, "R", "later", "C");
    expect(v(store, "reader")).toBe(7);
  });

  it("R-11: a whole reader of an ancestor follows a structural change, and the old child loses its owner", () => {
    const store = make();
    batch(store, () => {
      addNode(store, lit(undefined), "gp");
      addNode(store, lit(undefined), "p");
      addNode(store, lit(1), "c1");
      addNode(store, lit(2), "c2");
      setSlot(store, "gp", "p", "p");
      setSlot(store, "p", "c", "c1");
      addNode(store, ref("gp"), "whole");
    });
    expect(v(store, "whole")).toEqual({ p: { c: 1 } });
    setSlot(store, "p", "c", "c2");
    expect(v(store, "whole")).toEqual({ p: { c: 2 } });
    expect(node(store, "c1").parent).toBeUndefined();
    expect(node(store, "c2").parent).toBe("p");
  });

  it("removes a slot when the child is undefined", () => {
    const store = make();
    rootWithCell(store);
    addNode(store, ref("R", "key"), "reader");
    setSlot(store, "R", "key", undefined);
    expect(v(store, "R")).toEqual({});
    expect(isNone(readValue(store, "reader"))).toBe(true);
  });

  it("refuses a missing child and a slot to the container itself", () => {
    const store = make();
    addNode(store, lit(undefined), "R");
    setSlot(store, "R", "x", "ghost");
    setSlot(store, "R", "self", "R");
    expect(node(store, "R").slots.size).toBe(0);
  });
});

describe("expandNode", () => {
  const expanded = (): NodeStore => {
    const store = make();
    addNode(store, lit({ a: 1, b: { c: 2 } }), "cell");
    addNode(store, ref("cell", "a"), "readerA");
    addNode(store, ref("cell", "b", "c"), "readerC");
    addNode(store, ref("cell"), "whole");
    expect(node(store, "cell").seats.has("readerA")).toBe(true);
    expandNode(store, "cell");
    return store;
  };

  it("makes each field a slot, and moves the readers to the leaves", () => {
    const store = expanded();
    expect(node(store, "cell.a").seats.has("readerA")).toBe(true);
    expect(node(store, "cell.b.c").seats.has("readerC")).toBe(true);
    expect(v(store, "cell")).toEqual({ a: 1, b: { c: 2 } });
  });

  it("an edit of a leaf makes only its own readers dirty", () => {
    const store = expanded();
    setValue(store, "cell.a", 42);
    expect(v(store, "readerA")).toBe(42);
    expect(evaluated(store).has("readerC")).toBe(false);
    expect(v(store, "whole")).toEqual({ a: 42, b: { c: 2 } });
    setValue(store, "cell.b.c", 9);
    expect(v(store, "readerC")).toBe(9);
    expect(v(store, "whole")).toEqual({ a: 42, b: { c: 9 } });
  });

  it("R-09: a write to the expanded node replaces the expansion, and the readers see the new value", () => {
    const store = expanded();
    setValue(store, "cell", { a: 5, b: { c: 6 } });
    expect(v(store, "readerA")).toBe(5);
    expect(v(store, "readerC")).toBe(6);
    expect(store.nodes.has("cell.a")).toBe(false);
    expect(node(store, "cell").seats.has("readerA")).toBe(true);
  });

  it("R-10: an expansion does not overwrite a node whose ID it would use", () => {
    const store = make();
    addNode(store, lit({ x: 1 }), "a");
    addNode(store, lit("precious"), "a.x");
    expandNode(store, "a");
    expect(v(store, "a.x")).toBe("precious");
    const slot = node(store, "a").slots.get("x")!;
    expect(slot).not.toBe("a.x");
    expect(v(store, slot)).toBe(1);
  });

  it("does nothing for a value that is not a plain object", () => {
    const store = make();
    addNode(store, lit([1, 2]), "list");
    expandNode(store, "list");
    expect(node(store, "list").slots.size).toBe(0);
  });
});

describe("removeNode", () => {
  it("R-08: the readers of a removed node become none, and the owner loses the slot", () => {
    const store = make();
    rootWithCell(store);
    addNode(store, ref("R", "key"), "reader");
    addNode(store, ref("R"), "whole");
    removeNode(store, "R.key");
    expect(store.nodes.has("R.key")).toBe(false);
    expect(node(store, "R").slots.size).toBe(0);
    expect(isNone(readValue(store, "reader"))).toBe(true);
    expect(v(store, "whole")).toEqual({});
  });

  it("removes the owned slot subtree with the node", () => {
    const store = make();
    addNode(store, lit({ a: { b: 1 } }), "x");
    expandNode(store, "x");
    removeNode(store, "x");
    expect([...store.nodes.keys()]).toEqual([]);
  });

  it("a reader finds a node that comes back with the same ID", () => {
    const store = make();
    addNode(store, lit(1), "a");
    addNode(store, ref("a"), "b");
    removeNode(store, "a");
    expect(isNone(readValue(store, "b"))).toBe(true);
    addNode(store, lit(2), "a");
    expect(v(store, "b")).toBe(2);
  });
});

describe("custom NodeOps", () => {
  it("the engine uses the splash, flow and deref of the store", () => {
    const calls = { splash: 0, flow: 0, deref: 0 };
    const spy: NodeOps = {
      splash: (value, target, store) => { calls.splash++; return defaultOps.splash(value, target, store); },
      flow: (target, store) => { calls.flow++; return defaultOps.flow(target, store); },
      deref: (root, path, store) => { calls.deref++; return defaultOps.deref(root, path, store); },
    };
    const store = make(dslOps, spy);
    addNode(store, lit(1), "a");
    addNode(store, ref("a"), "b");
    setValue(store, "a", 2);
    expect(calls.splash).toBeGreaterThan(0);
    expect(calls.flow).toBeGreaterThan(0);
    expect(calls.deref).toBeGreaterThan(0);
    expect(v(store, "b")).toBe(2);
  });

  it("R-14: the semantics belong to the store, thus every write of the store uses them", () => {
    const clamp: NodeOps = {
      ...defaultOps,
      splash: (value, target, store) =>
        defaultOps.splash(
          value.tag === "some" && typeof value.value === "number" ? { tag: "some", value: Math.min(value.value, 10) } : value,
          target,
          store,
        ),
    };
    const store = make(dslOps, clamp);
    addNode(store, lit(50), "a");
    expect(v(store, "a")).toBe(10);
    resolveAll(store);
    expect(v(store, "a")).toBe(10);
  });

  it("a write from a custom op runs as a follow-up epoch", () => {
    let mirrorReady = false;
    const store = make(dslOps, {
      ...defaultOps,
      splash: (value, target, s) => {
        const changed = defaultOps.splash(value, target, s);
        if (changed && mirrorReady && target.id === "a") setValue(s, "mirror", value.tag === "some" ? value.value : null);
        return changed;
      },
    });
    addNode(store, lit(1), "a");
    addNode(store, lit(0), "mirror");
    addNode(store, ref("mirror"), "reader");
    mirrorReady = true;
    setValue(store, "a", 7);
    expect(v(store, "mirror")).toBe(7);
    expect(v(store, "reader")).toBe(7);
  });
});

describe("shared slots", () => {
  const shared = (): NodeStore => {
    const store = make();
    batch(store, () => {
      addNode(store, lit(undefined), "A");
      addNode(store, lit(undefined), "B");
      addNode(store, lit(7), "x");
      setSlot(store, "A", "x", "x");
      setSlot(store, "B", "y", "x");
    });
    return store;
  };

  it("a node in two containers belongs to the first one, and both records hold it", () => {
    const store = shared();
    expect(node(store, "x").parent).toBe("A");
    expect(v(store, "A")).toEqual({ x: 7 });
    expect(v(store, "B")).toEqual({ y: 7 });
    setValue(store, "x", 8);
    expect(v(store, "B")).toEqual({ y: 8 });
  });

  it("a write to the container that only shares a node keeps the node", () => {
    const store = shared();
    setValue(store, "B", "flat");
    expect(store.nodes.has("x")).toBe(true);
    expect(v(store, "A")).toEqual({ x: 7 });
  });

  it("the removal of the owner removes the node, and the other container loses its slot", () => {
    const store = shared();
    removeNode(store, "A");
    expect(store.nodes.has("x")).toBe(false);
    expect(v(store, "B")).toEqual({});
  });
});

describe("the limit of follow-up epochs", () => {
  it("throws when a custom op writes on each epoch", () => {
    const store = make(dslOps, {
      ...defaultOps,
      splash: (value, target, s) => {
        const changed = defaultOps.splash(value, target, s);
        if (target.id === "loop") setValue(s, "loop", Math.random());
        return changed;
      },
    });
    expect(() => addNode(store, lit(0), "loop")).toThrow(/did not settle/);
  });
});
