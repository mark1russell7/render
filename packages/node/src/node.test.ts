import { describe, it, expect } from "vitest";
import { node, generateNodeId } from "@render/node";
import { lit, ref, app } from "@render/dsl";
import { isNone } from "@render/optional";

describe("generateNodeId", () => {
  it("returns unique ids on each call", () => {
    const a = generateNodeId();
    const b = generateNodeId();
    expect(a).not.toBe(b);
  });

  it("returns a string", () => {
    expect(typeof generateNodeId()).toBe("string");
  });
});

describe("node", () => {
  it("creates a node with given expression and default fields", () => {
    const n = node(lit(42), "test-id");
    expect(n.id).toBe("test-id");
    expect(n.expr).toEqual(lit(42));
    expect(isNone(n.value)).toBe(true);
    expect(n.seats.size).toBe(0);
    expect(n.slots.size).toBe(0);
  });

  it("auto-generates an id if not provided", () => {
    const n = node(lit(0));
    expect(typeof n.id).toBe("string");
    expect(n.id.length).toBeGreaterThan(0);
  });

  it("extracts reads from a ref expression", () => {
    const n = node(ref("a", "b"), "r1");
    expect(n.reads).toEqual([["a", "b"]]);
  });

  it("extracts reads from an app expression", () => {
    const n = node(app("+", ref("x"), ref("y")), "r2");
    expect(n.reads).toEqual([["x"], ["y"]]);
  });

  it("has empty reads for a literal expression", () => {
    const n = node(lit(99), "r3");
    expect(n.reads).toEqual([]);
  });
});
