import { describe, it, expect } from "vitest";
import { seatPath, resolve, rewalk } from "./path.ts";
import { registry, register, subscribe, unsubscribe, peek, touch, setRoot } from "./registry.ts";
import type { Seat } from "./seat.ts";
import { some, isNone, unwrap } from "@render/optional";

describe("seatPath / resolve", () => {
  it("resolves a path against a root, populating every seat", () => {
    const path = seatPath(["farm", "pen", "dog"]);
    const root = { farm: { pen: { dog: "rex" } } };
    expect(resolve(path, root)).toEqual(some("rex"));
    expect(path.seats.map((s) => unwrap(s.value))).toEqual([
      { pen: { dog: "rex" } },
      { dog: "rex" },
      "rex",
    ]);
  });

  it("invalidates from the first missing segment", () => {
    const path = seatPath(["farm", "pen", "dog"]);
    expect(isNone(resolve(path, { farm: {} }))).toBe(true);
    expect(isNone(path.seats[1]!.value)).toBe(true);
    expect(isNone(path.seats[2]!.value)).toBe(true);
  });
});

describe("rewalk", () => {
  it("notifies listeners only when the resolved value changes", () => {
    const path = seatPath(["a", "b"]);
    const notified: unknown[] = [];
    path.tail.listeners.add((s: Seat) => notified.push(unwrap(s.value)));

    resolve(path, { a: { b: 1 } });
    rewalk(path, 0, { a: { b: 2 } });
    expect(notified).toEqual([2]);

    rewalk(path, 0, { a: { b: 2 } }); // unchanged — no notification
    expect(notified).toEqual([2]);
  });

  it("notifies on invalidation when the value had been resolved", () => {
    const path = seatPath(["a", "b"]);
    let invalidated = 0;
    path.tail.listeners.add((s: Seat) => {
      if (isNone(s.value)) invalidated++;
    });
    resolve(path, { a: { b: 1 } });
    rewalk(path, 0, { a: {} });
    expect(invalidated).toBe(1);
  });
});

describe("registry", () => {
  it("register dedupes by segments; peek reads current value", () => {
    const reg = registry({ x: { y: 10 } });
    const p1 = register(reg, ["x", "y"]);
    const p2 = register(reg, ["x", "y"]);
    expect(p1).toBe(p2);
    expect(peek(reg, ["x", "y"])).toEqual(some(10));
  });

  it("touch rewalks paths through the changed point", () => {
    const root: { x: { y: number }; other: number } = { x: { y: 1 }, other: 0 };
    const reg = registry(root);
    const seen: unknown[] = [];
    subscribe(reg, ["x", "y"], (s) => seen.push(unwrap(s.value)));

    root.x.y = 2;
    touch(reg, ["x"]);
    expect(seen).toEqual([2]);

    // Unrelated touch does not renotify
    touch(reg, ["other"]);
    expect(seen).toEqual([2]);
  });

  it("setRoot rewalks everything; unsubscribe stops notifications", () => {
    const reg = registry({ a: 1 });
    const seen: unknown[] = [];
    const listener = (s: Seat): void => { seen.push(unwrap(s.value)); };
    const path = subscribe(reg, ["a"], listener);

    setRoot(reg, { a: 2 });
    expect(seen).toEqual([2]);

    unsubscribe(path, listener);
    setRoot(reg, { a: 3 });
    expect(seen).toEqual([2]);
  });
});

describe("regressions (docs/REVIEW.md)", () => {
  it("R-25: touch with an empty path walks each path again from the root", () => {
    const root = { a: { b: 1 } };
    const reg = registry(root);
    const seen: unknown[] = [];
    subscribe(reg, ["a", "b"], (s) => seen.push(unwrap(s.value)));
    root.a.b = 2;
    expect(() => { touch(reg, []); }).not.toThrow();
    expect(seen).toEqual([2]);
  });

  it("R-25: an empty seat path throws a RangeError", () => {
    expect(() => seatPath([])).toThrow(RangeError);
  });

  it("R-25: a path does not resolve through an inherited property", () => {
    expect(isNone(resolve(seatPath(["a", "constructor"]), { a: {} }))).toBe(true);
  });
});
