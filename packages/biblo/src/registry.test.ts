import { describe, it, expect } from "vitest";
import {
  biblo, registerClass, registerClasses, resolveCells, resolveMethods,
  instantiate, destroyInstance, ownerOf, componentClass,
} from "@render/biblo";
import type { Biblo, Instance } from "@render/biblo";
import { nodeStore, addNode, getNode, readValue, setValue, expandNode } from "@render/node";
import type { NodeStore } from "@render/node";
import { lit, ref, app } from "@render/dsl";
import type { Ops } from "@render/dsl";
import { isNone, unwrap } from "@render/optional";

const ops: Ops = { "+": (a, b) => (a as number) + (b as number), "*": (a, b) => (a as number) * (b as number) };
const setup = (extraOps: Ops = {}): { b: Biblo; store: NodeStore } => ({ b: biblo(), store: nodeStore({ ops: { ...ops, ...extraOps } }) });
const cellId = (store: NodeStore, inst: Instance | string, cell: string): string =>
  getNode(store, typeof inst === "string" ? inst : inst.id)!.slots.get(cell)!;
const cell = (store: NodeStore, inst: Instance | string, name: string): unknown =>
  unwrap(readValue(store, cellId(store, inst, name)));

const fnA = (): string => "a";
const fnB = (): string => "b";
const fnC = (): string => "c";

describe("registerClass and the resolution of the extends chain", () => {
  it("an empty biblo has no classes and no instances", () => {
    const b = biblo();
    expect(b.classes.size).toBe(0);
    expect(b.instances.size).toBe(0);
  });

  it("stores a class by name", () => {
    const b = biblo();
    const cls = componentClass("Foo", { x: { expr: lit(1) } });
    registerClass(b, cls);
    expect(b.classes.get("Foo")).toBe(cls);
  });

  it("resolveCells walks the extends chain, and the child cell wins", () => {
    const b = biblo();
    registerClasses(b, [
      componentClass("Parent", { a: { expr: lit(1) }, b: { expr: lit(2) } }),
      componentClass("Child", { b: { expr: lit(20) }, c: { expr: lit(30) } }, "Parent"),
    ]);
    const cells = resolveCells(b, "Child");
    expect(cells["a"]!.expr).toEqual(lit(1));
    expect(cells["b"]!.expr).toEqual(lit(20));
    expect(cells["c"]!.expr).toEqual(lit(30));
  });

  it("resolveMethods walks the extends chain, and the most specific method wins", () => {
    const b = biblo();
    registerClass(b, componentClass("Base", {}, undefined, { render: fnA, splash: fnB }));
    registerClass(b, componentClass("Sub", {}, "Base", { render: fnC }));
    const methods = resolveMethods(b, "Sub");
    expect(methods["render"]).toBe(fnC);
    expect(methods["splash"]).toBe(fnB);
  });

  it("stops at an extends cycle", () => {
    const b = biblo();
    registerClass(b, componentClass("A", { x: { expr: lit(1) } }, "B"));
    registerClass(b, componentClass("B", { y: { expr: lit(2) } }, "A"));
    expect(Object.keys(resolveCells(b, "A")).sort()).toEqual(["x", "y"]);
    registerClass(b, componentClass("Selfie", { z: { expr: lit(3) } }, "Selfie"));
    expect(resolveCells(b, "Selfie")["z"]!.expr).toEqual(lit(3));
    expect(resolveMethods(b, "Selfie")).toEqual({});
  });

  it("R-20: a registration replaces the cached resolution of each subclass", () => {
    const b = biblo();
    registerClass(b, componentClass("Base", {}, undefined, { render: fnA }));
    registerClass(b, componentClass("Sub", {}, "Base"));
    expect(resolveMethods(b, "Sub")["render"]).toBe(fnA);
    registerClass(b, componentClass("Base", {}, undefined, { render: fnB }));
    expect(resolveMethods(b, "Sub")["render"]).toBe(fnB);
  });
});

describe("instantiate", () => {
  it("makes an instance with its scope", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("A", {}));
    const parent = instantiate(b, store, "A");
    const child = instantiate(b, store, "A", parent.id);
    expect(parent.scope).toEqual({ self: parent.id, parent: undefined, children: [child.id] });
    expect(child.scope.parent).toBe(parent.id);
  });

  it("makes a root node whose slots are the cells, and evaluates them", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("Widget", {
      width: { expr: lit(100) },
      height: { expr: lit(200) },
      area: { expr: app("*", ref("self", "width"), ref("self", "height")) },
    }));
    const inst = instantiate(b, store, "Widget");
    expect(cell(store, inst, "area")).toBe(20000);
    expect(unwrap(readValue(store, inst.id))).toEqual({ width: 100, height: 200, area: 20000 });
  });

  it("R-18: an instance is live at once, without a call to wireSeats or resolveAll", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("Sum", { a: { expr: lit(1) }, s: { expr: app("+", ref("self", "a"), lit(1)) } }));
    const inst = instantiate(b, store, "Sum");
    setValue(store, cellId(store, inst, "a"), 10);
    expect(cell(store, inst, "s")).toBe(11);
  });

  it("makes a child instance for a typed cell, and binds its cells in the scope of the child", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("Child", { value: { expr: lit("unset") } }));
    registerClass(b, componentClass("Parent", {
      key: { expr: lit("k1") },
      kid: { expr: lit(undefined), type: "Child", bindings: { value: ref("parent", "key") } },
    }));
    const parent = instantiate(b, store, "Parent");
    const kid = cellId(store, parent, "kid");
    expect(b.instances.get(kid)!.classRef).toBe("Child");
    expect(cell(store, kid, "value")).toBe("k1");
    // ex-P0-2: an edit of the parent cell reaches the bound child cell
    setValue(store, cellId(store, parent, "key"), "k2");
    expect(cell(store, kid, "value")).toBe("k2");
    expect(unwrap(readValue(store, parent.id))).toEqual({ key: "k2", kid: { value: "k2" } });
  });

  it("applies the bindings of the caller", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("Cell", { value: { expr: lit("default") } }));
    const inst = instantiate(b, store, "Cell", undefined, { value: lit("overridden") });
    expect(cell(store, inst, "value")).toBe("overridden");
  });

  it("R-16: a binding of the caller for a typed cell makes it a plain cell", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("Child", { value: { expr: lit("default") } }));
    registerClass(b, componentClass("Mid", { kid: { expr: lit(undefined), type: "Child" } }));
    const mid = instantiate(b, store, "Mid", undefined, { kid: lit("override") });
    expect(cell(store, mid, "kid")).toBe("override");
    expect(mid.scope.children).toEqual([]);
  });

  it("R-17: a fn parameter named self is not a scope reference", () => {
    const { b, store } = setup({ call: (f, x) => (f as (v: unknown) => unknown)(x) });
    registerClass(b, componentClass("F", {
      a: { expr: lit(5) },
      r: { expr: app("call", app("fn", lit(["self"]), app("+", ref("self"), lit(1))), ref("self", "a")) },
    }));
    const inst = instantiate(b, store, "F");
    expect(cell(store, inst, "r")).toBe(6);
  });

  it("a cell named like an Object.prototype property is a normal cell", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("Odd", { toString: { expr: lit("own") } }));
    const inst = instantiate(b, store, "Odd", undefined, {});
    expect(cell(store, inst, "toString")).toBe("own");
  });

  it("R-19: the IDs come from the biblo, not from a global counter", () => {
    const a = setup();
    const c = setup();
    registerClass(a.b, componentClass("A", {}));
    registerClass(c.b, componentClass("A", {}));
    expect(instantiate(a.b, a.store, "A").id).toBe(instantiate(c.b, c.store, "A").id);
  });
});

describe("destroyInstance", () => {
  it("removes the instance tree: instances, nodes and the entry in the parent scope", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("Leaf", { v: { expr: lit(1) } }));
    registerClass(b, componentClass("Holder", {
      kid: { expr: lit(undefined), type: "Leaf" },
      own: { expr: lit(2) },
    }));
    const parent = instantiate(b, store, "Holder");
    expect(b.instances.size).toBe(2);
    destroyInstance(b, store, parent.id);
    expect(b.instances.size).toBe(0);
    expect(store.nodes.size).toBe(0);
  });

  it("detaches a child from the scope of its parent", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("A", {}));
    const parent = instantiate(b, store, "A");
    const child = instantiate(b, store, "A", parent.id);
    destroyInstance(b, store, child.id);
    expect(parent.scope.children).not.toContain(child.id);
    expect(b.instances.has(parent.id)).toBe(true);
  });

  it("R-08: an outside reader of a destroyed cell becomes none and keeps no stale seat", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("Src", { out: { expr: lit(5) } }));
    const src = instantiate(b, store, "Src");
    addNode(store, ref(src.id, "out"), "reader");
    expect(unwrap(readValue(store, "reader"))).toBe(5);
    destroyInstance(b, store, src.id);
    expect(isNone(readValue(store, "reader"))).toBe(true);
    expect(getNode(store, "reader")!.seatedOn.size).toBe(0);
  });

  it("removes a typed child from the record of the parent root", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("Leaf", { v: { expr: lit(1) } }));
    registerClass(b, componentClass("Holder", { kid: { expr: lit(undefined), type: "Leaf" } }));
    const holder = instantiate(b, store, "Holder");
    destroyInstance(b, store, cellId(store, holder, "kid"));
    expect(unwrap(readValue(store, holder.id))).toEqual({});
  });
});

describe("ownerOf", () => {
  it("finds the instance of a root, of a cell and of an expanded field", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("Rec", { data: { expr: lit({ a: { b: 1 } }) } }));
    const inst = instantiate(b, store, "Rec");
    const data = cellId(store, inst, "data");
    expandNode(store, data);
    const a = getNode(store, data)!.slots.get("a")!;
    const deep = getNode(store, a)!.slots.get("b")!;
    expect(ownerOf(b, store, inst.id)).toBe(inst.id);
    expect(ownerOf(b, store, data)).toBe(inst.id);
    expect(ownerOf(b, store, deep)).toBe(inst.id);
    addNode(store, lit(0), "free");
    expect(ownerOf(b, store, "free")).toBeUndefined();
  });
});
