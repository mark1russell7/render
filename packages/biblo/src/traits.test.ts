import { describe, it, expect } from "vitest";
import {
  biblo, componentClass, registerClass, registerTrait, unregisterTrait, resolveTraits, resolveMethods,
  classFingerprint, primeOf, renameClass, instantiate, resolveCells,
} from "@render/biblo";
import { nodeStore } from "@render/node";
import { lit } from "@render/dsl";

const summaryA = (): string => "A";
const summaryB = (): string => "B";
const summaryAB = (): string => "AB";
const rootSummary = (): string => "root";

const withBox = () => {
  const b = biblo();
  registerClass(b, componentClass("Root", {}, undefined, { summary: rootSummary, other: rootSummary }));
  registerClass(b, componentClass("Box", { width: { expr: lit(1) }, height: { expr: lit(1) }, label: { expr: lit("x") } }, "Root"));
  return b;
};

describe("prime fingerprints", () => {
  it("gives each feature a unique prime, and a fingerprint that does not depend on the order", () => {
    const b = biblo();
    const p = [primeOf(b, "cell:a"), primeOf(b, "cell:b"), primeOf(b, "cell:c"), primeOf(b, "cell:a")];
    expect(p).toEqual([2n, 3n, 5n, 2n]);
    registerClass(b, componentClass("X", { a: { expr: lit(1) }, b: { expr: lit(1) } }));
    registerClass(b, componentClass("Y", { b: { expr: lit(2) }, a: { expr: lit(2) } }));
    expect(classFingerprint(b, "X")).toBe(6n);
    expect(classFingerprint(b, "Y")).toBe(classFingerprint(b, "X"));
  });

  it("a typed cell adds a feature for its type", () => {
    const b = biblo();
    registerClass(b, componentClass("P", { kid: { expr: lit(undefined), type: "Point" } }));
    expect(classFingerprint(b, "P")).toBe(primeOf(b, "cell:kid") * primeOf(b, "cell:kid:Point"));
  });
});

describe("traits (granular polymorphism)", () => {
  it("a trait applies when its fingerprint divides the fingerprint of the class", () => {
    const b = withBox();
    registerTrait(b, { name: "Sized", requires: ["width", "height"], methods: { summary: summaryA } });
    registerTrait(b, { name: "Colored", requires: ["color"], methods: { summary: summaryB } });
    expect(resolveTraits(b, "Box").applied.map((t) => t.name)).toEqual(["Sized"]);
    expect(resolveMethods(b, "Box")["summary"]).toBe(summaryA);
  });

  it("two maximal traits that give the same method make it ambiguous, and the default of the root stays", () => {
    const b = withBox();
    registerTrait(b, { name: "Sized", requires: ["width", "height"], methods: { summary: summaryA } });
    registerTrait(b, { name: "Labeled", requires: ["label"], methods: { summary: summaryB } });
    const r = resolveTraits(b, "Box");
    expect(r.applied.map((t) => t.name).toSorted()).toEqual(["Labeled", "Sized"]);
    expect(r.ambiguous).toEqual(["summary"]);
    expect(resolveMethods(b, "Box")["summary"]).toBe(rootSummary);
  });

  it("a trait that requires more features dominates, thus it removes the ambiguity", () => {
    const b = withBox();
    registerTrait(b, { name: "Sized", requires: ["width", "height"], methods: { summary: summaryA } });
    registerTrait(b, { name: "Labeled", requires: ["label"], methods: { summary: summaryB } });
    registerTrait(b, { name: "LabeledBox", requires: ["label", "width", "height"], methods: { summary: summaryAB } });
    expect(resolveTraits(b, "Box")).toEqual({ applied: [b.traits.get("LabeledBox")], ambiguous: [] });
    expect(resolveMethods(b, "Box")["summary"]).toBe(summaryAB);
    unregisterTrait(b, "LabeledBox");
    expect(resolveTraits(b, "Box").ambiguous).toEqual(["summary"]);
  });

  it("a method of the class or of a parent that is not the root wins over a trait", () => {
    const b = withBox();
    registerTrait(b, { name: "Sized", requires: ["width", "height"], methods: { summary: summaryA } });
    registerClass(b, componentClass("Special", {}, "Box", { summary: summaryB }));
    expect(resolveMethods(b, "Special")["summary"]).toBe(summaryB);
    expect(resolveMethods(b, "Box")["other"]).toBe(rootSummary);
  });

  it("a class without a parent keeps its own methods over a trait", () => {
    const b = biblo();
    registerClass(b, componentClass("Alone", { width: { expr: lit(1) } }, undefined, { summary: summaryB }));
    registerTrait(b, { name: "Wide", requires: ["width"], methods: { summary: summaryA } });
    expect(resolveMethods(b, "Alone")["summary"]).toBe(summaryB);
  });

  it("a typed requirement needs the cell with that type", () => {
    const b = biblo();
    registerClass(b, componentClass("Root", {}));
    registerClass(b, componentClass("Holder", { kid: { expr: lit(undefined), type: "Point" } }, "Root"));
    registerClass(b, componentClass("Other", { kid: { expr: lit(undefined), type: "Line" } }, "Root"));
    registerTrait(b, { name: "HasPoint", requires: ["kid:Point"], methods: { summary: summaryA } });
    expect(resolveMethods(b, "Holder")["summary"]).toBe(summaryA);
    expect(resolveMethods(b, "Other")["summary"]).toBeUndefined();
  });
});

describe("renameClass", () => {
  it("renames a class, its subclasses, its typed cells and its live instances, in the same place of the order", () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("A", { v: { expr: lit(1) } }));
    registerClass(b, componentClass("B", {}, "A"));
    registerClass(b, componentClass("C", { kid: { expr: lit(undefined), type: "A" } }));
    const inst = instantiate(b, store, "A");
    expect(renameClass(b, "A", "Z")).toBe(true);
    expect([...b.classes.keys()]).toEqual(["Z", "B", "C"]);
    expect(b.classes.get("B")!.extends).toBe("Z");
    expect(b.classes.get("C")!.cells["kid"]!.type).toBe("Z");
    expect(b.instances.get(inst.id)!.classRef).toBe("Z");
    expect(Object.keys(resolveCells(b, "B"))).toEqual(["v"]);
  });

  it("refuses a missing class, an empty name and a name in use", () => {
    const b = biblo();
    registerClass(b, componentClass("A", {}));
    registerClass(b, componentClass("B", {}));
    expect(renameClass(b, "Nope", "X")).toBe(false);
    expect(renameClass(b, "A", "")).toBe(false);
    expect(renameClass(b, "A", "B")).toBe(false);
    expect([...b.classes.keys()]).toEqual(["A", "B"]);
  });
});
