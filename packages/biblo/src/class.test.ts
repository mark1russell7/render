import { describe, it, expect } from "vitest";
import { componentClass, extendClass } from "@render/biblo";
import { lit } from "@render/dsl";

describe("componentClass", () => {
  it("constructs with name and cells", () => {
    const cls = componentClass("Foo", {
      x: { expr: lit(1) },
      y: { expr: lit(2) },
    });
    expect(cls.name).toBe("Foo");
    expect(cls.cells).toEqual({
      x: { expr: lit(1) },
      y: { expr: lit(2) },
    });
    expect(cls.extends).toBeUndefined();
    expect(cls.methods).toBeUndefined();
  });

  it("constructs with extends", () => {
    const cls = componentClass("Bar", {}, "Foo");
    expect(cls.name).toBe("Bar");
    expect(cls.extends).toBe("Foo");
  });

  it("constructs with methods", () => {
    const renderFn = () => "rendered";
    const cls = componentClass("Baz", {}, undefined, { render: renderFn });
    expect(cls.methods).toBeDefined();
    expect(cls.methods!["render"]).toBe(renderFn);
    expect(cls.extends).toBeUndefined();
  });
});

describe("extendClass", () => {
  it("merges cells, child overrides parent", () => {
    const base = componentClass("Base", {
      a: { expr: lit(1) },
      b: { expr: lit(2) },
    });
    const extended = extendClass(base, {
      cells: {
        b: { expr: lit(20) },
        c: { expr: lit(30) },
      },
    });
    expect(extended.name).toBe("Base");
    expect(extended.cells["a"]).toEqual({ expr: lit(1) });
    expect(extended.cells["b"]).toEqual({ expr: lit(20) }); // overridden
    expect(extended.cells["c"]).toEqual({ expr: lit(30) }); // added
  });

  it("merges methods", () => {
    const fnA = () => "a";
    const fnB = () => "b";
    const fnC = () => "c";
    const base = componentClass("Base", {}, undefined, { render: fnA, splash: fnB });
    const extended = extendClass(base, {
      methods: { render: fnC },
    });
    expect(extended.methods!["render"]).toBe(fnC); // overridden
    expect(extended.methods!["splash"]).toBe(fnB); // inherited
  });
});
