import { describe, it, expect } from "vitest";
import { biblo, registerClass, instantiate, classNodeOps, componentClass } from "@render/biblo";
import type { Biblo } from "@render/biblo";
import { nodeStore, getNode, readValue, setValue, defaultOps } from "@render/node";
import type { NodeStore, SplashFn } from "@render/node";
import { lit } from "@render/dsl";
import { unwrap } from "@render/optional";

const setup = (): { b: Biblo; store: NodeStore } => {
  const b = biblo();
  return { b, store: nodeStore({ nodeOps: classNodeOps(b) }) };
};
const cellOf = (store: NodeStore, instId: string, name: string): string => getNode(store, instId)!.slots.get(name)!;

describe("classNodeOps: class-level reactive methods", () => {
  it("uses the splash method of the class that owns the node", () => {
    const { b, store } = setup();
    const seen: unknown[] = [];
    const loggingSplash: SplashFn = (value, target, s) => {
      seen.push(unwrap(value));
      return defaultOps.splash(value, target, s);
    };
    registerClass(b, componentClass("Logged", { x: { expr: lit(0) } }, undefined, { splash: loggingSplash }));
    registerClass(b, componentClass("Plain", { x: { expr: lit(0) } }));
    const logged = instantiate(b, store, "Logged");
    const plain = instantiate(b, store, "Plain");

    setValue(store, cellOf(store, logged.id, "x"), 7);
    expect(seen).toContain(7);
    const before = seen.length;
    setValue(store, cellOf(store, plain.id, "x"), 9);
    expect(seen.length).toBe(before);
    expect(unwrap(readValue(store, cellOf(store, plain.id, "x")))).toBe(9);
  });

  it("resolves a method through the extends chain", () => {
    const { b, store } = setup();
    let calls = 0;
    const countingSplash: SplashFn = (value, target, s) => {
      calls++;
      return defaultOps.splash(value, target, s);
    };
    registerClass(b, componentClass("Base", {}, undefined, { splash: countingSplash }));
    registerClass(b, componentClass("Sub", { x: { expr: lit(0) } }, "Base"));
    const inst = instantiate(b, store, "Sub");
    calls = 0;
    setValue(store, cellOf(store, inst.id, "x"), 3);
    expect(calls).toBeGreaterThan(0);
  });

  it("R-20: a new registration of the class changes the semantics of its live instances", () => {
    const { b, store } = setup();
    registerClass(b, componentClass("C", { x: { expr: lit(0) } }));
    const inst = instantiate(b, store, "C");
    const clamp: SplashFn = (value, target, s) =>
      defaultOps.splash(value.tag === "some" ? { tag: "some", value: Math.min(value.value as number, 5) } : value, target, s);
    registerClass(b, componentClass("C", { x: { expr: lit(0) } }, undefined, { splash: clamp }));
    setValue(store, cellOf(store, inst.id, "x"), 50);
    expect(unwrap(readValue(store, cellOf(store, inst.id, "x")))).toBe(5);
  });
});
