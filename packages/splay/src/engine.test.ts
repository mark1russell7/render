import { describe, it, expect } from "vitest";
import {
  splayKit, hydrate, dehydrate, splay, registerClasses,
  standardClasses, readCells, standardOps, defaultClassFor, exprClassFor,
} from "@render/splay";
import { biblo } from "@render/biblo";
import { nodeStore, defaultOps, resolveAll, wireSeats } from "@render/node";

/** Helper: set up a fresh biblo + store with standard classes registered */
const setup = () => {
  const b = biblo();
  const store = nodeStore();
  registerClasses(b, standardClasses);
  return { b, store };
};

/** Helper: hydrate a value and resolve the store so cell values are populated */
const hydrateAndResolve = (value: unknown) => {
  const { b, store } = setup();
  const kit = splayKit(defaultClassFor, standardOps);
  const inst = hydrate(kit, b, store, value);
  wireSeats(store);
  resolveAll(store, defaultOps, standardOps);
  return { b, store, kit, inst };
};

describe("registerClasses", () => {
  it("registers all standard classes", () => {
    const b = biblo();
    registerClasses(b, standardClasses);
    for (const cls of standardClasses) {
      expect(b.classes.has(cls.name)).toBe(true);
    }
    expect(b.classes.size).toBe(standardClasses.length);
  });
});

describe("hydrate", () => {
  it("hydrates a string into a Text instance", () => {
    const { inst } = hydrateAndResolve("hello");
    expect(inst.classRef).toBe("Text");
  });

  it("hydrates a number into a Num instance", () => {
    const { inst } = hydrateAndResolve(42);
    expect(inst.classRef).toBe("Num");
  });

  it("hydrates a boolean into a Bool instance", () => {
    const { inst } = hydrateAndResolve(true);
    expect(inst.classRef).toBe("Bool");
  });

  it("hydrates an array into a VStack with children", () => {
    const { b, inst } = hydrateAndResolve([1, 2, 3]);
    expect(inst.classRef).toBe("VStack");
    expect(inst.scope.children.length).toBe(3);

    // Each child should be a Num
    for (const childId of inst.scope.children) {
      const child = b.instances.get(childId);
      expect(child).toBeDefined();
      expect(child!.classRef).toBe("Num");
    }
  });

  it("hydrates an object into a Grid with KVP children", () => {
    const { b, inst } = hydrateAndResolve({ a: 1, b: "two" });
    expect(inst.classRef).toBe("Grid");
    expect(inst.scope.children.length).toBe(2);

    // Each child should be a KeyValuePair
    for (const childId of inst.scope.children) {
      const child = b.instances.get(childId);
      expect(child).toBeDefined();
      expect(child!.classRef).toBe("KeyValuePair");
    }
  });
});

describe("dehydrate", () => {
  it("roundtrips a string", () => {
    const { b, store, inst } = hydrateAndResolve("hello");
    expect(dehydrate(b, store, inst.id)).toBe("hello");
  });

  it("roundtrips a number", () => {
    const { b, store, inst } = hydrateAndResolve(42);
    expect(dehydrate(b, store, inst.id)).toBe(42);
  });

  it("roundtrips a boolean", () => {
    const { b, store, inst } = hydrateAndResolve(false);
    expect(dehydrate(b, store, inst.id)).toBe(false);
  });

  it("roundtrips an array", () => {
    const { b, store, inst } = hydrateAndResolve([1, 2, 3]);
    expect(dehydrate(b, store, inst.id)).toEqual([1, 2, 3]);
  });

  it("roundtrips an object", () => {
    const { b, store, inst } = hydrateAndResolve({ x: 10, y: 20 });
    expect(dehydrate(b, store, inst.id)).toEqual({ x: 10, y: 20 });
  });
});

describe("readCells", () => {
  it("returns cell values for an instance", () => {
    const { store, inst } = hydrateAndResolve("test");
    const cells = readCells(store, inst.id);
    expect(cells["value"]).toBe("test");
  });

  it("returns empty object for non-existent instance", () => {
    const { store } = hydrateAndResolve("x");
    const cells = readCells(store, "nonexistent");
    expect(cells).toEqual({});
  });
});

describe("Expr hydrate + dehydrate", () => {
  it("defaultClassFor routes Expr objects to Grid (JSON rendering by default)", () => {
    expect(defaultClassFor({ tag: "lit", value: 42 })).toBe("Grid");
    expect(defaultClassFor({ tag: "ref", path: ["self"] })).toBe("Grid");
    expect(defaultClassFor({ tag: "app", op: "+", args: [] })).toBe("Grid");
    expect(defaultClassFor({ foo: "bar" })).toBe("Grid");
  });

  it("exprClassFor routes Expr objects to ExprLit/ExprRef/ExprApp", () => {
    expect(exprClassFor({ tag: "lit", value: 42 })).toBe("ExprLit");
    expect(exprClassFor({ tag: "ref", path: ["self"] })).toBe("ExprRef");
    expect(exprClassFor({ tag: "app", op: "+", args: [] })).toBe("ExprApp");
    expect(exprClassFor({ foo: "bar" })).toBe("Grid");
  });

  it("hydrates Expr with exprClassFor into ExprLit/ExprRef/ExprApp", () => {
    const { b, store } = setup();
    const kit = splayKit(exprClassFor, standardOps);
    const inst = hydrate(kit, b, store, {
      tag: "app", op: "+",
      args: [{ tag: "lit", value: 1 }, { tag: "lit", value: 2 }],
    });
    wireSeats(store);
    resolveAll(store, defaultOps, standardOps);

    expect(inst.classRef).toBe("ExprApp");
    expect(inst.scope.children.length).toBe(2);
    const child0 = b.instances.get(inst.scope.children[0]!);
    const child1 = b.instances.get(inst.scope.children[1]!);
    expect(child0?.classRef).toBe("ExprLit");
    expect(child1?.classRef).toBe("ExprLit");
  });

  it("roundtrips Expr with exprClassFor", () => {
    const { b, store } = setup();
    const kit = splayKit(exprClassFor, standardOps);
    const expr = {
      tag: "app", op: "textView",
      args: [
        { tag: "app", op: "get", args: [{ tag: "ref", path: ["self", "cells"] }, { tag: "lit", value: "value" }] },
        { tag: "ref", path: ["self", "setCell"] },
      ],
    };
    const inst = hydrate(kit, b, store, expr);
    wireSeats(store);
    resolveAll(store, defaultOps, standardOps);
    expect(dehydrate(b, store, inst.id)).toEqual(expr);
  });
});

describe("splay", () => {
  it("returns truthy result with a custom kit providing render ops", () => {
    const { b, store } = setup();

    // Text's render method is: app("textView", app("get", ref("self","cells"), lit("value")), ref("self","setCell"))
    // We need a "textView" op so the Expr evaluation succeeds.
    const opsWithViews = {
      ...standardOps,
      textView: (value: unknown, _setCell: unknown) => `<text>${String(value)}</text>`,
    };
    const kit = splayKit<string>(defaultClassFor, opsWithViews);
    const inst = hydrate(kit, b, store, "hello");
    wireSeats(store);
    resolveAll(store, defaultOps, standardOps);

    const result = splay(kit, b, store, inst.id);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});
