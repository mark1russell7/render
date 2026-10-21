import { describe, it, expect } from "vitest";
import type { ComponentClass } from "@mark1russell7/render-biblo";
import { app, exprEquals, isExpr, lit, ref, toDocument } from "@mark1russell7/render-dsl";
import type { Expr } from "@mark1russell7/render-dsl";
import { classToJson, reconstructClass } from "./typegraph.ts";

/** This function gives the document of an expression as JSON text gives it back. */
const doc = (e: Expr): unknown => JSON.parse(JSON.stringify(toDocument(e))) as unknown;

describe("the card of a class takes documents", () => {
  it("reconstructClass reads the documents of the cells, the bindings and the methods into the IR", () => {
    const area = app("*", ref("self", "w"), ref("self", "h"));
    const summary = app("summaryView", ref("self", "classRef"), app("fn", lit(["x"]), ref("x")));
    const json = {
      name: "Box",
      extends: "Grid",
      cells: {
        w: { expr: doc(lit(2)) },
        area: { expr: doc(area) },
        kid: { expr: { tag: "lit", value: null }, type: "Box", bindings: { w: doc(ref("parent", "w")), h: { tag: "lit", value: 1 } } },
      },
      methods: { summary: doc(summary) },
    };
    const back = reconstructClass(json, undefined);
    if (!back.ok) throw new Error(back.reason);
    const cls: ComponentClass = back.cls;
    expect(exprEquals(cls.cells["w"]!.expr, lit(2))).toBe(true);
    expect(exprEquals(cls.cells["area"]!.expr, area)).toBe(true);
    expect(exprEquals(cls.cells["kid"]!.bindings!["w"]!, ref("parent", "w"))).toBe(true);
    expect(exprEquals(cls.cells["kid"]!.bindings!["h"]!, lit(1))).toBe(true);
    expect(exprEquals(cls.methods!["summary"] as Expr, summary)).toBe(true);
    // The card of the class shows the trees of the IR again
    const card = classToJson(cls) as { cells: Record<string, { expr: unknown }> };
    expect(isExpr(card.cells["area"]!.expr)).toBe(true);
  });

  it("reconstructClass refuses a document that is not valid, and tells where", () => {
    const badRef = { type: "ref", value: ["self", "w"] };
    expect(reconstructClass({ name: "X", cells: { a: { expr: badRef } } }, undefined))
      .toEqual({ ok: false, reason: "The cell a of X has no valid expression." });
    expect(reconstructClass({ name: "X", cells: { a: { expr: 1, bindings: { b: badRef } } } }, undefined))
      .toEqual({ ok: false, reason: "The cell a of X has no valid expression." });
    expect(reconstructClass({ name: "X", cells: { a: { expr: doc(lit(1)), bindings: { b: badRef } } } }, undefined))
      .toEqual({ ok: false, reason: "The bindings of the cell a are not valid expressions." });
    expect(reconstructClass({ name: "X", cells: { a: { expr: doc(lit(1)), bindings: 5 } } }, undefined))
      .toEqual({ ok: false, reason: "The bindings of the cell a are not valid expressions." });
    expect(reconstructClass({ name: "X", cells: {}, methods: { m: badRef } }, undefined))
      .toEqual({ ok: false, reason: "The method m of X is not a valid expression." });
  });
});
