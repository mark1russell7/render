import { describe, it, expect } from "vitest";
import { Vector } from "@render/pack";

describe("Vector", () => {
  it("constructor defaults to 0,0", () => {
    const v = new Vector();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it("of(scalar) creates vector with both components equal", () => {
    const v = Vector.of(5);
    expect(v.x).toBe(5);
    expect(v.y).toBe(5);
  });

  it("set(x, y) updates both components", () => {
    const v = new Vector();
    v.set(3, 7);
    expect(v.x).toBe(3);
    expect(v.y).toBe(7);
  });

  it("setTo(other) copies components from another vector", () => {
    const v = new Vector();
    const other = new Vector(10, 20);
    v.setTo(other);
    expect(v.x).toBe(10);
    expect(v.y).toBe(20);
  });

  it("add returns a new vector with summed components", () => {
    const a = new Vector(1, 2);
    const b = new Vector(3, 4);
    const result = a.add(b);
    expect(result.x).toBe(4);
    expect(result.y).toBe(6);
    // original is unchanged
    expect(a.x).toBe(1);
    expect(a.y).toBe(2);
  });

  it("area returns x * y", () => {
    const v = new Vector(3, 5);
    expect(v.area()).toBe(15);
  });

  it("clone creates an independent copy", () => {
    const v = new Vector(7, 11);
    const c = v.clone();
    expect(c.x).toBe(7);
    expect(c.y).toBe(11);

    c.set(0, 0);
    expect(v.x).toBe(7);
    expect(v.y).toBe(11);
  });

  it("clamp constrains to bounds", () => {
    const v = new Vector(50, 200);
    const lo = new Vector(10, 10);
    const hi = new Vector(100, 100);
    const clamped = v.clamp(lo, hi);
    expect(clamped.x).toBe(50);
    expect(clamped.y).toBe(100);

    const v2 = new Vector(-5, 3);
    const clamped2 = v2.clamp(lo, hi);
    expect(clamped2.x).toBe(10);
    expect(clamped2.y).toBe(10);
  });

  it("static min returns component-wise minimum", () => {
    const vectors = [new Vector(3, 10), new Vector(1, 5), new Vector(7, 2)];
    const result = Vector.min(vectors);
    expect(result.x).toBe(1);
    expect(result.y).toBe(2);
  });

  it("static max returns component-wise maximum", () => {
    const vectors = [new Vector(3, 10), new Vector(1, 5), new Vector(7, 2)];
    const result = Vector.max(vectors);
    expect(result.x).toBe(7);
    expect(result.y).toBe(10);
  });

  it("Infinity constant has very large values", () => {
    expect(Vector.Infinity.x).toBe(Infinity);
    expect(Vector.Infinity.y).toBe(Infinity);
  });
});
