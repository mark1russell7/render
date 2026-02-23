import { describe, it, expect } from "vitest";
import {
  biblo, registerClass, resolveCells, resolveMethods,
  instantiate, resolveScope, componentClass,
} from "@render/biblo";
import { nodeStore } from "@render/node";
import { lit, ref } from "@render/dsl";
import { isSome } from "@render/optional";

describe("biblo", () => {
  it("creates an empty registry", () => {
    const b = biblo();
    expect(b.classes.size).toBe(0);
    expect(b.instances.size).toBe(0);
  });
});

describe("registerClass", () => {
  it("stores a class by name", () => {
    const b = biblo();
    const cls = componentClass("Foo", { x: { expr: lit(1) } });
    registerClass(b, cls);
    expect(b.classes.get("Foo")).toBe(cls);
  });
});

describe("resolveCells", () => {
  it("returns own cells for a class without extends", () => {
    const b = biblo();
    registerClass(b, componentClass("A", {
      x: { expr: lit(1) },
      y: { expr: lit(2) },
    }));
    const cells = resolveCells(b, "A");
    expect(Object.keys(cells)).toEqual(["x", "y"]);
    expect(cells["x"]!.expr).toEqual(lit(1));
  });

  it("walks extends chain, child overrides parent", () => {
    const b = biblo();
    registerClass(b, componentClass("Parent", {
      a: { expr: lit(1) },
      b: { expr: lit(2) },
    }));
    registerClass(b, componentClass("Child", {
      b: { expr: lit(20) },
      c: { expr: lit(30) },
    }, "Parent"));

    const cells = resolveCells(b, "Child");
    expect(cells["a"]!.expr).toEqual(lit(1));  // inherited
    expect(cells["b"]!.expr).toEqual(lit(20)); // overridden
    expect(cells["c"]!.expr).toEqual(lit(30)); // own
  });
});

describe("resolveMethods", () => {
  it("walks extends chain, most specific wins", () => {
    const b = biblo();
    const fnA = () => "a";
    const fnB = () => "b";
    const fnC = () => "c";
    registerClass(b, componentClass("Base", {}, undefined, { render: fnA, splash: fnB }));
    registerClass(b, componentClass("Sub", {}, "Base", { render: fnC }));

    const methods = resolveMethods(b, "Sub");
    expect(methods["render"]).toBe(fnC); // overridden
    expect(methods["splash"]).toBe(fnB); // inherited
  });
});

describe("instantiate", () => {
  it("creates instance with correct scope.parent, scope.self, scope.children", () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("A", {}));

    const parent = instantiate(b, store, "A");
    const child = instantiate(b, store, "A", parent.id);

    expect(parent.scope.self).toBe(parent.id);
    expect(parent.scope.parent).toBeUndefined();
    expect(parent.scope.children).toContain(child.id);

    expect(child.scope.self).toBe(child.id);
    expect(child.scope.parent).toBe(parent.id);
  });

  it("creates root node and cell nodes in NodeStore", () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("Widget", {
      width: { expr: lit(100) },
      height: { expr: lit(200) },
    }));

    const inst = instantiate(b, store, "Widget");

    // Root node exists
    const rootNode = store.nodes.get(inst.id);
    expect(rootNode).toBeDefined();

    // Cell nodes exist as slots on root
    const widthId = rootNode!.slots.get("width");
    const heightId = rootNode!.slots.get("height");
    expect(widthId).toBeDefined();
    expect(heightId).toBeDefined();
    expect(store.nodes.get(widthId!)).toBeDefined();
    expect(store.nodes.get(heightId!)).toBeDefined();
  });

  it("with typed cells recursively creates children", () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("Inner", { val: { expr: lit(0) } }));
    registerClass(b, componentClass("Outer", {
      child: { expr: lit(undefined), type: "Inner" },
    }));

    const inst = instantiate(b, store, "Outer");

    // The typed cell should have created a child instance
    expect(inst.scope.children.length).toBe(1);
    const childId = inst.scope.children[0]!;
    const childInst = b.instances.get(childId);
    expect(childInst).toBeDefined();
    expect(childInst!.classRef).toBe("Inner");
  });

  it("applies bindings to override cell exprs", () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("Cell", {
      value: { expr: lit("default") },
    }));

    const inst = instantiate(b, store, "Cell", undefined, {
      value: lit("overridden"),
    });

    // The cell node should have the overridden expression
    const rootNode = store.nodes.get(inst.id)!;
    const valueNodeId = rootNode.slots.get("value")!;
    const valueNode = store.nodes.get(valueNodeId)!;
    expect(valueNode.expr).toEqual(lit("overridden"));
  });
});

describe("resolveScope", () => {
  it('maps "self" to instance id', () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("A", {}));
    const inst = instantiate(b, store, "A");

    const resolved = resolveScope(b, inst.id, ["self", "width"]);
    expect(resolved).toEqual([inst.id, "width"]);
  });

  it('maps "parent" to parent id', () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("A", {}));
    const parent = instantiate(b, store, "A");
    const child = instantiate(b, store, "A", parent.id);

    const resolved = resolveScope(b, child.id, ["parent", "x"]);
    expect(resolved).toEqual([parent.id, "x"]);
  });

  it("returns undefined when no parent", () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("A", {}));
    const inst = instantiate(b, store, "A");

    const resolved = resolveScope(b, inst.id, ["parent", "x"]);
    expect(resolved).toBeUndefined();
  });
});
