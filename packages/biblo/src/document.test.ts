import { describe, it, expect } from "vitest";
import {
  biblo, instantiate, registerClass, registerClasses, registerTrait, resolveCells, resolveMethods, updateClass,
} from "@mark1russell7/render-biblo";
import type { Biblo, ComponentClass, Instance } from "@mark1russell7/render-biblo";
import { getNode, nodeStore, readValue, setValue } from "@mark1russell7/render-node";
import type { NodeStore } from "@mark1russell7/render-node";
import { app, exprEquals, isExpr, lit, ref, toDocument } from "@mark1russell7/render-dsl";
import type { Expr, ExprDocument, Ops } from "@mark1russell7/render-dsl";
import { unwrap } from "@mark1russell7/render-optional";

const ops: Ops = { "+": (a: number, b: number) => a + b, "*": (a: number, b: number) => a * b };
const setup = (): { b: Biblo; store: NodeStore } => ({ b: biblo(), store: nodeStore({ ops }) });
const cellId = (store: NodeStore, inst: Instance, cell: string): string => getNode(store, inst.id)!.slots.get(cell)!;
const cell = (store: NodeStore, inst: Instance, name: string): unknown => unwrap(readValue(store, cellId(store, inst, name)));
/** This function gives the document of an expression as JSON text gives it back, as from storage. */
const doc = (e: Expr): ExprDocument => JSON.parse(JSON.stringify(toDocument(e))) as ExprDocument;

/** The class `Box` with documents in place of expressions: a class from data. */
const BoxData: ComponentClass<Expr | ExprDocument> = {
  name: "Box",
  cells: {
    w: { expr: doc(lit(2)) },
    h: { expr: doc(lit(3)) },
    area: { expr: doc(app("*", ref("self", "w"), ref("self", "h"))) },
  },
  methods: {
    summary: doc(app("+", ref("self", "w"), lit(1))),
    render: (): string => "an atom",
    note: { type: "ref", value: ["self", "w"] },
  },
};

describe("biblo reads the documents of a class", () => {
  it("registerClass reads each cell and each method that is a valid document into the IR", () => {
    const { b } = setup();
    registerClass(b, BoxData);
    const cells = resolveCells(b, "Box");
    expect(Object.values(cells).every((c) => isExpr(c.expr))).toBe(true);
    expect(exprEquals(cells["area"]!.expr, app("*", ref("self", "w"), ref("self", "h")))).toBe(true);
    const methods = resolveMethods(b, "Box");
    expect(exprEquals(methods["summary"] as Expr, app("+", ref("self", "w"), lit(1)))).toBe(true);
    expect(methods["render"]).toBe(BoxData.methods!["render"]);
    // A document that is not valid stays as it is, as a malformed tree of the IR does
    expect(methods["note"]).toBe(BoxData.methods!["note"]);
  });

  it("an instance of a class from data computes its cells, and its self references are scoped", () => {
    const { b, store } = setup();
    registerClasses(b, [BoxData]);
    const box = instantiate(b, store, "Box");
    expect(cell(store, box, "area")).toBe(6);
    setValue(store, cellId(store, box, "w"), 5);
    expect(cell(store, box, "area")).toBe(15);
  });

  it("a class without documents stays the same object", () => {
    const { b } = setup();
    const plain: ComponentClass = { name: "Plain", cells: { a: { expr: lit(1), bindings: { x: lit(2) } } }, methods: { m: lit(3) } };
    registerClass(b, plain);
    expect(b.classes.get("Plain")).toBe(plain);
  });

  it("the bindings of a typed cell and of instantiate can be documents", () => {
    const { b, store } = setup();
    registerClass(b, BoxData);
    registerClass(b, {
      name: "Frame",
      cells: {
        size: { expr: doc(lit(10)) },
        box: { expr: lit(undefined), type: "Box", bindings: { w: doc(ref("parent", "size")) } },
      },
    });
    const frame = instantiate(b, store, "Frame");
    const box = b.instances.get(cellId(store, frame, "box"))!;
    expect(cell(store, box, "area")).toBe(30);
    const other = instantiate(b, store, "Box", undefined, { h: doc(lit(7)) });
    expect(cell(store, other, "area")).toBe(14);
  });

  it("updateClass reads a new version from data, and the instances follow it", () => {
    const { b, store } = setup();
    registerClass(b, BoxData);
    const box = instantiate(b, store, "Box");
    updateClass(b, store, { ...BoxData, cells: { ...BoxData.cells, area: { expr: doc(app("+", ref("self", "w"), ref("self", "h"))) } } });
    expect(cell(store, box, "area")).toBe(5);
  });

  it("registerTrait reads a method that is a valid document", () => {
    const { b } = setup();
    registerClass(b, BoxData);
    const atom = (): string => "atom";
    registerTrait(b, { name: "Sized", requires: ["w", "h"], methods: { size: doc(app("*", ref("self", "w"), lit(2))), atom } });
    const trait = b.traits.get("Sized")!;
    expect(exprEquals(trait.methods["size"] as Expr, app("*", ref("self", "w"), lit(2)))).toBe(true);
    expect(trait.methods["atom"]).toBe(atom);
    const plain = { name: "Plain", requires: ["w"], methods: { m: lit(1) } };
    registerTrait(b, plain);
    expect(b.traits.get("Plain")).toBe(plain);
  });
});
