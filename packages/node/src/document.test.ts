import { describe, it, expect } from "vitest";
import { docEquals } from "@mark1russell7/coeval";
import { addNode, batch, defaultOps, forkStore, getNode, nodeStore, readValue, setExpr, setSlot, setValue, storeResolver } from "@mark1russell7/render-node";
import type { NodeOps, NodeStore } from "@mark1russell7/render-node";
import { app, lit, record, ref } from "@mark1russell7/render-dsl";
import type { Expr, Ops } from "@mark1russell7/render-dsl";
import { isNone, some, unwrap } from "@mark1russell7/render-optional";

const ops: Ops = {
  "+": (a: number, b: number) => a + b,
  "*": (a: number, b: number) => a * b,
  map: (xs: readonly number[], f: (x: number) => number) => xs.map((x) => f(x)),
};
const make = (): NodeStore => nodeStore({ ops });
const v = (store: NodeStore, id: string): unknown => unwrap(readValue(store, id));
/** This function gives a document as JSON text gives it back, as a host reads it from storage. */
const stored = (doc: Expr): Expr => JSON.parse(JSON.stringify(doc)) as Expr;

describe("a store evaluates coeval documents through the kernel", () => {
  it("a node reacts to its world references, also after JSON text", () => {
    const store = make();
    addNode(store, stored(lit(2)), "w");
    addNode(store, stored(lit(4)), "h");
    const area = app("*", ref("w"), ref("h"));
    addNode(store, stored(area), "area");
    expect(v(store, "area")).toBe(8);
    expect(docEquals(getNode(store, "area")!.expr, area)).toBe(true);
    expect(getNode(store, "area")!.reads).toEqual([["w"], ["h"]]);
    setValue(store, "w", 3);
    expect(v(store, "area")).toBe(12);
  });

  it("R-04: the reads are the free world references that the kernel finds, and a parameter of a fn is not a read", () => {
    const store = make();
    addNode(store, lit([1, 2, 3]), "items");
    addNode(store, lit(10), "scale");
    addNode(store, stored(app("map", ref("items"), app("fn", lit(["x"]), app("*", ref("x"), ref("scale"))))), "scaled");
    expect(v(store, "scaled")).toEqual([10, 20, 30]);
    expect(getNode(store, "scaled")!.reads).toEqual([["items"], ["scale"]]);
    setValue(store, "scale", 2);
    expect(v(store, "scaled")).toEqual([2, 4, 6]);
  });

  it("the reads have no duplicates, and keep a path with a space apart from a path of two segments", () => {
    const store = make();
    addNode(store, app("+", ref("a b"), app("+", ref("a", "b"), ref("a b"))), "x");
    expect(getNode(store, "x")!.reads).toEqual([["a b"], ["a", "b"]]);
    addNode(store, lit(5), "y");
    expect(getNode(store, "y")!.reads).toEqual([]);
  });

  it("setExpr compiles the new document, and the node follows it", () => {
    const store = make();
    addNode(store, lit(5), "a");
    addNode(store, lit(0), "b");
    setExpr(store, "b", stored(app("+", ref("a"), lit(1))));
    expect(v(store, "b")).toBe(6);
    setValue(store, "a", 9);
    expect(v(store, "b")).toBe(10);
  });

  it("the kernel compiles the expression of a write one time, and each epoch evaluates the same plan", () => {
    const store = make();
    const e = app("+", ref("a"), lit(2));
    addNode(store, lit(1), "a");
    addNode(store, e, "x");
    const planOf = (id: string): unknown => (getNode(store, id) as unknown as { plan: unknown }).plan;
    const first = planOf("x");
    expect(getNode(store, "x")!.expr).toBe(e);
    setValue(store, "a", 5);
    expect(v(store, "x")).toBe(7);
    expect(planOf("x")).toBe(first);
    setExpr(store, "x", app("*", ref("a"), lit(2)));
    expect(planOf("x")).not.toBe(first);
    expect(v(store, "x")).toBe(10);
  });

  it("a store value with the shape of a reference stays a value: the navigation is plain", () => {
    const store = make();
    const data = { type: "ref", value: ["world", "a"] };
    addNode(store, lit(1), "a");
    addNode(store, lit(0), "b");
    setValue(store, "b", data);
    expect(v(store, "b")).toEqual(data);
    addNode(store, ref("b"), "reader");
    expect(v(store, "reader")).toEqual(data);
    addNode(store, ref("b", "value"), "deep");
    expect(v(store, "deep")).toEqual(["world", "a"]);
  });

  it("the store is the host thing of the root world: each path goes to the deref op in one call", () => {
    const calls: string[] = [];
    const counting: NodeOps = { ...defaultOps, deref: (root, path, s) => { calls.push([root.id, ...path].join(".")); return defaultOps.deref(root, path, s); } };
    const store = nodeStore({ ops, nodeOps: counting });
    addNode(store, lit({ w: 3 }), "box");
    calls.length = 0;
    addNode(store, app("+", ref("box", "w"), ref("box", "w")), "sum");
    expect(v(store, "sum")).toBe(6);
    expect(calls).toEqual(["box.w", "box.w"]);
    expect(storeResolver(store)(["box", "w"])).toEqual(some(3));
  });

  it("a reference to the root world alone, or to a missing node, gives none", () => {
    const store = make();
    addNode(store, ref(), "root");
    addNode(store, ref("ghost"), "ghost");
    expect(isNone(readValue(store, "root"))).toBe(true);
    expect(isNone(readValue(store, "ghost"))).toBe(true);
    addNode(store, lit(7), "ghost.target");
    setExpr(store, "ghost", ref("ghost.target"));
    expect(v(store, "ghost")).toBe(7);
  });

  it("a container is the record construct of its slots, and a slot named __proto__ stays a field", () => {
    const store = make();
    addNode(store, lit(undefined), "box");
    addNode(store, lit(1), "one");
    batch(store, () => {
      setSlot(store, "box", "a", "one");
      setSlot(store, "box", "__proto__", "one");
    });
    const expr = getNode(store, "box")!.expr;
    expect(expr.type).toBe("record");
    expect(Object.keys(expr.value as object)).toEqual(["a", "__proto__"]);
    const value = v(store, "box") as object;
    expect(Object.keys(value)).toEqual(["a", "__proto__"]);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it("a fork with another op registry compiles the plans again", () => {
    const store = make();
    addNode(store, app("+", lit(1), lit(2)), "x");
    const other = forkStore(store, { ops: { "+": (a: number, b: number) => a * 10 + b } });
    setExpr(other, "x", getNode(other, "x")!.expr);
    expect(v(other, "x")).toBe(12);
    expect(v(store, "x")).toBe(3);
  });

  it("a malformed document gives none, and does not throw", () => {
    const store = make();
    const bad = { type: "ref", value: ["self", "a"] } as Expr;
    addNode(store, bad, "x");
    expect(isNone(readValue(store, "x"))).toBe(true);
    expect(getNode(store, "x")!.expr).toBe(bad);
    expect(getNode(store, "x")!.reads).toEqual([]);
    setExpr(store, "x", lit(3));
    expect(v(store, "x")).toBe(3);
    addNode(store, record({ ok: lit(1), bad: { type: "nope", value: 1 } }), "r");
    expect(v(store, "r")).toEqual({ ok: 1 });
  });
});
