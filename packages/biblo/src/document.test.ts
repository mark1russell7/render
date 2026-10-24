import { describe, it, expect } from "vitest";
import {
  biblo, instantiate, registerClass, registerClasses, registerTrait, resolveCells, resolveMethods, updateClass,
} from "@mark1russell7/render-biblo";
import type { Biblo, ComponentClass, Instance } from "@mark1russell7/render-biblo";
import { getNode, nodeStore, readValue, setExpr, setValue } from "@mark1russell7/render-node";
import type { NodeStore } from "@mark1russell7/render-node";
import { app, lit, ref } from "@mark1russell7/render-dsl";
import type { Expr, Ops } from "@mark1russell7/render-dsl";
import { unwrap } from "@mark1russell7/render-optional";

const ops: Ops = {
  "+": (a: number, b: number) => a + b,
  "*": (a: number, b: number) => a * b,
  map: (xs: readonly number[], f: (x: number) => number) => xs.map((x) => f(x)),
};
const setup = (): { b: Biblo; store: NodeStore } => ({ b: biblo(), store: nodeStore({ ops }) });
const cellId = (store: NodeStore, inst: Instance, cell: string): string => getNode(store, inst.id)!.slots.get(cell)!;
const cell = (store: NodeStore, inst: Instance, name: string): unknown => unwrap(readValue(store, cellId(store, inst, name)));
/** This function gives a value as JSON text gives it back, as from storage. */
const stored = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The class `Box`, as JSON text gives it back: a class from data. */
const BoxData: ComponentClass = stored({
  name: "Box",
  cells: {
    w: { expr: lit(2) },
    h: { expr: lit(3) },
    area: { expr: app("*", ref("self", "w"), ref("self", "h")) },
  },
  methods: { summary: app("+", ref("self", "w"), lit(1)) },
});

describe("a class is data: its expressions are coeval documents", () => {
  it("registerClass keeps the class as it is, also a class from JSON text", () => {
    const { b } = setup();
    registerClass(b, BoxData);
    expect(b.classes.get("Box")).toBe(BoxData);
    expect(resolveCells(b, "Box")["area"]!.expr).toEqual(app("*", ref("self", "w"), ref("self", "h")));
    expect(resolveMethods(b, "Box")["summary"]).toEqual(app("+", ref("self", "w"), lit(1)));
  });

  it("an instance of a class from data computes its cells, and its self references read the instance", () => {
    const { b, store } = setup();
    registerClasses(b, [BoxData]);
    const box = instantiate(b, store, "Box");
    expect(cell(store, box, "area")).toBe(6);
    expect(getNode(store, cellId(store, box, "area"))!.expr).toEqual(app("*", ref(box.id, "w"), ref(box.id, "h")));
    setValue(store, cellId(store, box, "w"), 5);
    expect(cell(store, box, "area")).toBe(15);
  });

  it("the scoping changes only the free world references: a parameter of a fn stays", () => {
    const { b, store } = setup();
    registerClass(b, {
      name: "Scaled",
      cells: {
        k: { expr: lit(10) },
        items: { expr: lit([1, 2]) },
        out: { expr: app("map", ref("self", "items"), app("fn", lit(["self"]), app("*", ref("self"), lit(2)))) },
        mixed: { expr: app("map", ref("self", "items"), app("fn", lit(["x"]), app("*", ref("x"), ref("self", "k")))) },
      },
    });
    const inst = instantiate(b, store, "Scaled");
    expect(cell(store, inst, "out")).toEqual([2, 4]);
    expect(cell(store, inst, "mixed")).toEqual([10, 20]);
    const mixed = getNode(store, cellId(store, inst, "mixed"))!;
    expect(mixed.reads).toEqual([[inst.id, "items"], [inst.id, "k"]]);
  });

  it("the bindings of a typed cell and of instantiate are documents in the scope of the instance", () => {
    const { b, store } = setup();
    registerClass(b, BoxData);
    registerClass(b, stored({
      name: "Frame",
      cells: {
        size: { expr: lit(10) },
        box: { expr: lit(null), type: "Box", bindings: { w: ref("parent", "size") } },
      },
    }));
    const frame = instantiate(b, store, "Frame");
    const box = b.instances.get(cellId(store, frame, "box"))!;
    expect(cell(store, box, "area")).toBe(30);
    const other = instantiate(b, store, "Box", undefined, { h: stored(lit(7)) });
    expect(cell(store, other, "area")).toBe(14);
  });

  it("updateClass compares documents (docEquals): a cell that follows its class changes, and an edited cell stays", () => {
    const { b, store } = setup();
    registerClass(b, BoxData);
    const box = instantiate(b, store, "Box");
    const edited = instantiate(b, store, "Box");
    setExpr(store, cellId(store, edited, "area"), lit(99));
    updateClass(b, store, stored({ ...BoxData, cells: { ...BoxData.cells, area: { expr: app("+", ref("self", "w"), ref("self", "h")) } } }));
    expect(cell(store, box, "area")).toBe(5);
    expect(cell(store, edited, "area")).toBe(99);
  });

  it("updateClass compares a host value of a document by identity (coeval 0.4.3): an edit with an equal date stays", () => {
    const b = biblo();
    const store = nodeStore({ ops: { ...ops, at: (d: Date, n: number) => d.getTime() + n } });
    const epoch = new Date(0);
    const Stamp: ComponentClass = { name: "Stamp", cells: { w: { expr: lit(2) }, t: { expr: app("at", lit(epoch), ref("self", "w")) } } };
    registerClass(b, Stamp);
    const follows = instantiate(b, store, "Stamp");
    const edited = instantiate(b, store, "Stamp");
    // The same document as the class gives, but with another date of the same time: it is an edit of the cell.
    setExpr(store, cellId(store, edited, "t"), app("at", lit(new Date(0)), ref(edited.id, "w")));
    updateClass(b, store, { ...Stamp, cells: { ...Stamp.cells, t: { expr: app("at", lit(epoch), lit(10)) } } });
    expect(cell(store, follows, "t")).toBe(10);
    expect(cell(store, edited, "t")).toBe(2);
  });

  it("registerTrait keeps the trait as it is", () => {
    const { b } = setup();
    registerClass(b, BoxData);
    const atom = (): string => "atom";
    const trait = { name: "Sized", requires: ["w", "h"], methods: { size: stored(app("*", ref("self", "w"), lit(2))) as Expr, atom } };
    registerTrait(b, trait);
    expect(b.traits.get("Sized")).toBe(trait);
    expect(resolveMethods(b, "Box")["size"]).toEqual(app("*", ref("self", "w"), lit(2)));
  });
});
