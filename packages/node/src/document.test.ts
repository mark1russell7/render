import { describe, it, expect } from "vitest";
import { addNode, getNode, nodeStore, readValue, setExpr, setValue } from "@mark1russell7/render-node";
import type { NodeStore } from "@mark1russell7/render-node";
import { app, evaluate, exprEquals, lit, objectResolver, ref, toDocument } from "@mark1russell7/render-dsl";
import type { EvalIssue, ExprDocument, Ops } from "@mark1russell7/render-dsl";
import { isNone, unwrap } from "@mark1russell7/render-optional";

const ops: Ops = {
  "+": (a: number, b: number) => a + b,
  "*": (a: number, b: number) => a * b,
  map: (xs: readonly number[], f: (x: number) => number) => xs.map((x) => f(x)),
};
const make = (): NodeStore => nodeStore({ ops });
const v = (store: NodeStore, id: string): unknown => unwrap(readValue(store, id));
/** This function gives a document as JSON text gives it back, as a host reads it from storage. */
const stored = (doc: ExprDocument): ExprDocument => JSON.parse(JSON.stringify(doc)) as ExprDocument;

describe("a store takes documents", () => {
  it("addNode reads a document into the IR, and the node reacts to its world references", () => {
    const store = make();
    addNode(store, stored(toDocument(lit(2))), "w");
    addNode(store, stored(toDocument(lit(4))), "h");
    const area = app("*", ref("w"), ref("h"));
    addNode(store, stored(toDocument(area)), "area");
    expect(v(store, "area")).toBe(8);
    expect(exprEquals(getNode(store, "area")!.expr, area)).toBe(true);
    expect(getNode(store, "area")!.reads).toEqual([["w"], ["h"]]);
    setValue(store, "w", 3);
    expect(v(store, "area")).toBe(12);
  });

  it("a fn in a document reads its parameter, and only its free references are reads", () => {
    const store = make();
    addNode(store, lit([1, 2, 3]), "items");
    addNode(store, lit(10), "scale");
    addNode(store, stored(toDocument(app("map", ref("items"), app("fn", lit(["x"]), app("*", ref("x"), ref("scale")))))), "scaled");
    expect(v(store, "scaled")).toEqual([10, 20, 30]);
    expect(getNode(store, "scaled")!.reads).toEqual([["items"], ["scale"]]);
    setValue(store, "scale", 2);
    expect(v(store, "scaled")).toEqual([2, 4, 6]);
  });

  it("setExpr reads a document into the IR", () => {
    const store = make();
    addNode(store, lit(5), "a");
    addNode(store, lit(0), "b");
    setExpr(store, "b", stored(toDocument(app("+", ref("a"), lit(1)))));
    expect(v(store, "b")).toBe(6);
    expect(exprEquals(getNode(store, "b")!.expr, app("+", ref("a"), lit(1)))).toBe(true);
    setValue(store, "a", 9);
    expect(v(store, "b")).toBe(10);
  });

  it("a write of a value that has the shape of a document stays a literal value", () => {
    const store = make();
    const data = { type: "ref", value: ["world", "a"] };
    addNode(store, lit(1), "a");
    addNode(store, lit(0), "b");
    setValue(store, "b", data);
    expect(v(store, "b")).toEqual(data);
  });

  it("a malformed document gives none, as a malformed tree does, and does not throw", () => {
    const store = make();
    const bad = { type: "ref", value: ["self", "a"] } as ExprDocument;
    addNode(store, bad, "x");
    expect(isNone(readValue(store, "x"))).toBe(true);
    expect(getNode(store, "x")!.expr).toBe(bad);
    expect(getNode(store, "x")!.reads).toEqual([]);
    setExpr(store, "x", toDocument(lit(3)));
    expect(v(store, "x")).toBe(3);
  });

  it("the store keeps a tree of the IR as the same object", () => {
    const store = make();
    const e = app("+", lit(1), lit(2));
    addNode(store, e, "x");
    expect(getNode(store, "x")!.expr).toBe(e);
  });

  it("the issue of a malformed document names the problem", () => {
    const issues: EvalIssue[] = [];
    evaluate({ type: "ref", value: ["self", "a"] }, objectResolver({}), ops, issues);
    expect(issues).toEqual([{ code: "bad-expr", message: 'The root "self" is not names or world.' }]);
  });
});
