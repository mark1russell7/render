import { describe, it, expect } from "vitest";
import {
  biblo, registerClass, resolveCells, resolveMethods,
  instantiate, destroyInstance, resolveScope, componentClass,
} from "@render/biblo";
import { nodeStore, wireSeats, addNode, node } from "@render/node";
import { lit, ref } from "@render/dsl";

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

  it("terminates on extends cycles instead of overflowing the stack", () => {
    const b = biblo();
    registerClass(b, componentClass("A", { x: { expr: lit(1) } }, "B"));
    registerClass(b, componentClass("B", { y: { expr: lit(2) } }, "A"));

    const cells = resolveCells(b, "A");
    expect(cells["x"]!.expr).toEqual(lit(1));
    expect(cells["y"]!.expr).toEqual(lit(2));

    // self-extends is the degenerate cycle
    registerClass(b, componentClass("Selfie", { z: { expr: lit(3) } }, "Selfie"));
    expect(resolveCells(b, "Selfie")["z"]!.expr).toEqual(lit(3));
    expect(resolveMethods(b, "Selfie")).toEqual({});
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

describe("destroyInstance", () => {
  it("removes the instance tree: instances, nodes, parent scope entry", () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("Leaf", { v: { expr: lit(1) } }));
    registerClass(b, componentClass("Holder", {
      kid: { expr: lit(undefined), type: "Leaf" },
      own: { expr: lit(2) },
    }));

    const nodesBefore = store.nodes.size;
    const parent = instantiate(b, store, "Holder");
    const instancesCreated = b.instances.size;
    expect(instancesCreated).toBe(2); // Holder + typed Leaf

    destroyInstance(b, store, parent.id);
    expect(b.instances.size).toBe(0);
    expect(store.nodes.size).toBe(nodesBefore);
  });

  it("detaches from the parent's scope and slots", () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("A", {}));
    const parent = instantiate(b, store, "A");
    const child = instantiate(b, store, "A", parent.id);
    expect(parent.scope.children).toContain(child.id);

    destroyInstance(b, store, child.id);
    expect(parent.scope.children).not.toContain(child.id);
    expect(b.instances.has(parent.id)).toBe(true); // parent untouched
  });

  it("leaves no stale seat entries on surviving nodes", () => {
    const b = biblo();
    const store = nodeStore();
    registerClass(b, componentClass("Src", { out: { expr: lit(5) } }));

    const src = instantiate(b, store, "Src");
    // External reader seated on the instance's cell
    const reader = node(ref(src.id, "out"), "reader");
    addNode(store, reader);
    wireSeats(store);
    expect(reader.seatedOn.size).toBeGreaterThan(0);

    destroyInstance(b, store, src.id);
    // The reader's reverse index no longer points at destroyed nodes
    expect(reader.seatedOn.size).toBe(0);
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
