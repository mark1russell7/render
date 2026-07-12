import { describe, it, expect } from "vitest";
import { biblo, registerClass, instantiate, classNodeOps, componentClass } from "@render/biblo";
import {
  nodeStore, addNode, node, defaultOps, setValue, resolveAll, wireSeats,
} from "@render/node";
import type { NodeOps, SplashFn } from "@render/node";
import { lit, ref } from "@render/dsl";
import type { Ops } from "@render/dsl";
import { unwrap } from "@render/optional";

const dslOps: Ops = {
  "+": (a, b) => (a as number) + (b as number),
};

describe("NodeOps conformance — the engine consults the ops (ex-P1-3)", () => {
  it("custom flow and deref overrides are observed by setValue/resolveAll", () => {
    const store = nodeStore();
    addNode(store, node(lit(0), "a"));
    addNode(store, node(ref("a"), "b"));
    wireSeats(store);

    let flowCalls = 0;
    let derefCalls = 0;
    const spyOps: NodeOps = {
      splash: defaultOps.splash,
      flow: (target, s) => {
        flowCalls++;
        return defaultOps.flow(target, s);
      },
      deref: (root, path, s) => {
        derefCalls++;
        return defaultOps.deref(root, path, s);
      },
    };

    resolveAll(store, spyOps, dslOps);
    setValue(store, spyOps, dslOps, "a", 42);

    expect(unwrap(store.nodes.get("b")!.value)).toBe(42);
    expect(flowCalls).toBeGreaterThan(0);
    expect(derefCalls).toBeGreaterThan(0);
  });

  it("custom splash override controls the write", () => {
    const store = nodeStore();
    addNode(store, node(lit(0), "a"));

    let splashCalls = 0;
    const spyOps: NodeOps = {
      ...defaultOps,
      splash: (value, target, s) => {
        splashCalls++;
        return defaultOps.splash(value, target, s);
      },
    };

    setValue(store, spyOps, dslOps, "a", 1);
    resolveAll(store, spyOps, dslOps);
    expect(splashCalls).toBeGreaterThan(1);
  });
});

describe("classNodeOps — class-level reactive methods (Top, ex-D2)", () => {
  it("a class's splash method is consulted for its instances' nodes", () => {
    const b = biblo();
    const store = nodeStore();

    const seen: unknown[] = [];
    const loggingSplash: SplashFn = (value, target, s) => {
      seen.push(value);
      return defaultOps.splash(value, target, s);
    };

    registerClass(b, componentClass("Logged", { x: { expr: lit(0) } }, undefined, {
      splash: loggingSplash,
    }));
    registerClass(b, componentClass("Plain", { x: { expr: lit(0) } }));

    const logged = instantiate(b, store, "Logged");
    const plain = instantiate(b, store, "Plain");
    wireSeats(store);

    const ops = classNodeOps(b);
    const loggedCell = store.nodes.get(logged.id)!.slots.get("x")!;
    const plainCell = store.nodes.get(plain.id)!.slots.get("x")!;

    setValue(store, ops, dslOps, loggedCell, 7);
    expect(seen).toContain(7);

    const before = seen.length;
    setValue(store, ops, dslOps, plainCell, 9); // Plain has no splash method
    expect(seen.length).toBe(before);
    expect(unwrap(store.nodes.get(plainCell)!.value)).toBe(9); // fallback applied
  });

  it("methods resolve through the extends chain (Top-style defaults)", () => {
    const b = biblo();
    const store = nodeStore();

    let calls = 0;
    const countingSplash: SplashFn = (value, target, s) => {
      calls++;
      return defaultOps.splash(value, target, s);
    };

    registerClass(b, componentClass("Base", {}, undefined, { splash: countingSplash }));
    registerClass(b, componentClass("Sub", { x: { expr: lit(0) } }, "Base"));

    const inst = instantiate(b, store, "Sub");
    const cell = store.nodes.get(inst.id)!.slots.get("x")!;
    setValue(store, classNodeOps(b), dslOps, cell, 3);

    expect(calls).toBeGreaterThan(0); // inherited from Base
  });
});
