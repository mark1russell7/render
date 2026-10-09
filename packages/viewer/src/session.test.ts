import { describe, it, expect } from "vitest";
import type { InstanceId } from "@render/biblo";
import { resolveMethods } from "@render/biblo";
import { readCells, standardClasses, standardOps } from "@render/splay";
import { ViewerSession } from "./session.ts";
import { classToJson, reconstructClass } from "./typegraph.ts";

/** This helper finds the first instance under a root (depth first) that matches the test. */
const find = (s: ViewerSession, root: InstanceId, test: (id: InstanceId) => boolean): InstanceId | undefined => {
  if (test(root)) return root;
  for (const child of s.b.instances.get(root)?.scope.children ?? []) {
    const hit = find(s, child, test);
    if (hit !== undefined) return hit;
  }
  return undefined;
};

const card = (s: ViewerSession, name: string): InstanceId => {
  const definition = s.definitionOf(name);
  if (definition === undefined) throw new Error(`no card for ${name}`);
  return definition;
};

const value = (s: ViewerSession, id: InstanceId): unknown => readCells(s.store, id)["value"];

/** The ExprApp instance of a card whose op is `op`. */
const opNode = (s: ViewerSession, className: string, op: string): InstanceId => {
  const id = find(s, card(s, className), (i) => {
    const v = value(s, i) as { tag?: unknown; op?: unknown } | undefined;
    return s.b.instances.get(i)?.classRef === "ExprApp" && v?.op === op;
  });
  if (id === undefined) throw new Error(`no ${op} in ${className}`);
  return id;
};

const textCell = (s: ViewerSession, id: InstanceId): unknown => value(s, id);

describe("the type graph", () => {
  it("has one card for each class, with the standard classes and the classes of the viewer", () => {
    const s = new ViewerSession(standardOps);
    const names = s.cards().map(([n]) => n);
    for (const cls of standardClasses) expect(names).toContain(cls.name);
    expect(names).toContain("ClassName");
    expect(names).toContain("Label");
  });

  it("the search box filters the cards, and its value is the filter", () => {
    const s = new ViewerSession(standardOps);
    s.editCell(s.searchId, "value", "grid");
    expect(s.search).toBe("grid");
    expect(s.cards().map(([n]) => n)).toEqual(["Grid"]);
    s.dropClass("Text");
    expect(s.search).toBe("grid");
  });
});

describe("the canvas", () => {
  it("a drop makes a subclass, an instance and a card", () => {
    const s = new ViewerSession(standardOps);
    const id = s.dropClass("Text")!;
    expect(s.canvas).toEqual([id]);
    expect(s.b.instances.get(id)!.classRef).toBe("Text_1");
    expect(s.b.classes.get("Text_1")!.extends).toBe("Text");
    expect(s.cards().map(([n]) => n)).toContain("Text_1");
  });

  it("ex-P0-1: an edit survives later drops", () => {
    const s = new ViewerSession(standardOps);
    const id = s.dropClass("Text")!;
    s.editCell(id, "value", "hello world");
    s.dropClass("Num");
    s.dropClass("Grid");
    expect(textCell(s, id)).toBe("hello world");
  });

  it("an edit of a user class instance changes the class and the card", () => {
    const s = new ViewerSession(standardOps);
    const id = s.dropClass("Text")!;
    s.editCell(id, "value", "hi");
    expect(s.b.classes.get("Text_1")!.cells["value"]!.expr).toEqual({ tag: "lit", value: "hi" });
    const lit = find(s, card(s, "Text_1"), (i) => s.b.instances.get(i)?.classRef === "ExprLit");
    expect(value(s, lit!)).toEqual({ tag: "lit", value: "hi" });
  });

  it("an instance of a subclass follows the class until it has its own edit", () => {
    const s = new ViewerSession(standardOps);
    const parent = s.dropClass("Text")!;
    const child = s.dropClass("Text_1")!;
    s.editCell(parent, "value", "from the parent");
    expect(textCell(s, child)).toBe("from the parent");
    s.editCell(child, "value", "own");
    s.editCell(parent, "value", "again");
    expect(textCell(s, child)).toBe("own");
  });

  it("a write to a cell that holds an instance is refused with a notice", () => {
    const s = new ViewerSession(standardOps);
    const id = s.dropClass("Text")!;
    s.editCell(id, "nope", 1);
    expect(s.notice).toMatch(/no cell nope/);
    s.dismissNotice();
    expect(s.notice).toBeNull();
  });

  it("the epoch summary and the flash name the edited instance", () => {
    const s = new ViewerSession(standardOps);
    const id = s.dropClass("Num")!;
    s.editCell(id, "value", 42);
    expect(s.epoch!.evaluated).toBeGreaterThan(0);
    expect(s.flash.has(id)).toBe(true);
    s.clearFlash();
    expect(s.flash.size).toBe(0);
  });
});

describe("edits in the type graph", () => {
  it("R-29: a render method edit reaches the live instances, and the memo is cleared", () => {
    const s = new ViewerSession(standardOps);
    s.dropClass("Text");
    s.cache.set("stale", "output");
    const op = opNode(s, "Text", "textView");
    s.editCell(op, "value", { ...(value(s, op) as object), op: "numView" });
    const render = resolveMethods(s.b, "Text_1")["render"] as { op: string };
    expect(render.op).toBe("numView");
    expect(s.cache.has("stale")).toBe(false);
  });

  it("a cell edit of a class reaches each instance that follows the class", () => {
    const s = new ViewerSession(standardOps);
    const a = s.dropClass("Text")!;
    const b = s.dropClass("Text_1")!;
    const lit = find(s, card(s, "Text_1"), (i) => s.b.instances.get(i)?.classRef === "ExprLit");
    expect(lit).toBeUndefined(); // Text_1 has no own cells yet
    s.editCell(a, "value", "x");
    const litNow = find(s, card(s, "Text_1"), (i) => s.b.instances.get(i)?.classRef === "ExprLit")!;
    s.editCell(litNow, "value", { tag: "lit", value: "from the card" });
    // The edit of a went into the class, thus a follows the class too
    expect(textCell(s, a)).toBe("from the card");
    expect(textCell(s, b)).toBe("from the card");
  });

  it("R-31: a drop that makes an invalid method is refused, the card goes back, and the class stays", () => {
    const s = new ViewerSession(standardOps);
    const before = resolveMethods(s.b, "Num")["render"];
    const args = opNode(s, "Num", "numView");
    s.addChild(args, "Text");
    expect(s.notice).toMatch(/render of Num is not a valid expression/);
    expect(resolveMethods(s.b, "Num")["render"]).toBe(before);
    const restored = opNode(s, "Num", "numView");
    expect(s.b.instances.get(restored)!.scope.children).toHaveLength(2);
  });

  it("a new name in a card renames a user class, its card, its subclasses and its instances", () => {
    const s = new ViewerSession(standardOps);
    const item = s.dropClass("Text")!;
    s.dropClass("Text_1");
    const nameCell = find(s, card(s, "Text_1"), (i) => value(s, i) === "Text_1" && s.b.instances.get(i)?.classRef === "Text")!;
    s.editCell(nameCell, "value", "Title");
    expect(s.notice).toBeNull();
    expect(s.b.classes.has("Text_1")).toBe(false);
    expect(s.b.instances.get(item)!.classRef).toBe("Title");
    expect(s.b.classes.get("Text_1_2")!.extends).toBe("Title");
    const names = s.cards().map(([n]) => n);
    expect(names).toContain("Title");
    expect(names).not.toContain("Text_1");
    // The card of the subclass shows the new parent
    expect(find(s, card(s, "Text_1_2"), (i) => value(s, i) === "Title")).toBeDefined();
  });

  it("a standard class keeps its name, a name in use is refused, and the card goes back", () => {
    const s = new ViewerSession(standardOps);
    const textName = find(s, card(s, "Text"), (i) => value(s, i) === "Text" && s.b.instances.get(i)?.classRef === "Text")!;
    s.editCell(textName, "value", "Words");
    expect(s.notice).toMatch(/standard class keeps its name/);
    expect(s.b.classes.has("Text")).toBe(true);
    s.dropClass("Num");
    const numName = find(s, card(s, "Num_1"), (i) => value(s, i) === "Num_1" && s.b.instances.get(i)?.classRef === "Text")!;
    s.editCell(numName, "value", "Grid");
    expect(s.notice).toMatch(/class Grid exists/);
    expect(s.cards().map(([n]) => n)).toContain("Num_1");
  });
});

describe("lifecycle", () => {
  it("data-view toggles and removals leave no nodes and no instances behind", () => {
    const s = new ViewerSession(standardOps);
    const id = s.dropClass("Grid")!;
    s.editCell(id, "cols", 3);
    const nodes = s.store.nodes.size;
    const instances = s.b.instances.size;
    for (let i = 0; i < 5; i++) {
      s.toggleView(id);
      expect(s.dataRoot(id)).toBeDefined();
      s.toggleView(id);
    }
    expect(s.store.nodes.size).toBe(nodes);
    expect(s.b.instances.size).toBe(instances);

    s.toggleView(id);
    s.removeCanvasItem(id);
    expect(s.canvas).toEqual([]);
    expect(s.b.instances.has(id)).toBe(false);
    expect(s.store.nodes.size).toBeLessThan(nodes);
  });

  it("R-30: the data view is read-only and shows the dehydrated value", () => {
    const s = new ViewerSession(standardOps);
    const id = s.dropClass("Text")!;
    s.editCell(id, "value", "shown");
    s.toggleView(id);
    const root = s.dataRoot(id)!;
    const shown = find(s, root, (i) => value(s, i) === "shown");
    expect(shown).toBeDefined();
  });

  it("reset gives the standard state again", () => {
    const s = new ViewerSession(standardOps);
    s.dropClass("Text");
    s.editCell(s.searchId, "value", "text");
    s.reset();
    expect(s.canvas).toEqual([]);
    expect(s.search).toBe("");
    expect(s.b.classes.has("Text_1")).toBe(false);
  });

  it("notifies each subscriber on each action, and a removed subscriber no longer", () => {
    const s = new ViewerSession(standardOps);
    let calls = 0;
    const off = s.subscribe(() => { calls++; });
    const v0 = s.getSnapshot();
    s.dropClass("Text");
    expect(calls).toBe(1);
    expect(s.getSnapshot()).toBeGreaterThan(v0);
    off();
    s.dropClass("Text");
    expect(calls).toBe(1);
  });
});

describe("regressions of the independent review (docs/REVIEW.md)", () => {
  it("R-39: an ExprLit or an ExprRef dropped into the arguments of an op is a valid change", () => {
    const s = new ViewerSession(standardOps);
    const args = opNode(s, "Num", "numView");
    s.addChild(args, "ExprLit");
    expect(s.notice).toBeNull();
    s.addChild(args, "ExprRef");
    expect(s.notice).toBeNull();
    const render = resolveMethods(s.b, "Num")["render"] as { args: readonly unknown[] };
    expect(render.args).toHaveLength(4);
  });

  it("R-41: a class with a cell named __proto__ keeps the cell through its card", () => {
    const cls = { name: "X", cells: Object.fromEntries([["__proto__", { expr: { tag: "lit", value: 1 } }], ["a", { expr: { tag: "lit", value: 2 } }]]) };
    const json = classToJson(cls as never);
    const back = reconstructClass(json, undefined);
    expect(back.ok ? Object.keys(back.cls.cells).toSorted() : back.reason).toEqual(["__proto__", "a"]);
  });

  it("R-42: the memo forgets the instances that a toggle or a removal destroyed", () => {
    const s = new ViewerSession(standardOps);
    const id = s.dropClass("Grid")!;
    for (let i = 0; i < 5; i++) {
      s.toggleView(id);
      for (const [inst] of s.b.instances) s.cache.set(inst, "rendered");
      s.toggleView(id);
    }
    for (const key of s.cache.keys()) expect(s.b.instances.has(key)).toBe(true);
    s.removeCanvasItem(id);
    expect(s.cache.has(id)).toBe(false);
  });

  it("R-43: an edit of the default of Text does not change the search box", () => {
    const s = new ViewerSession(standardOps);
    const lit = find(s, card(s, "Text"), (i) => s.b.instances.get(i)?.classRef === "ExprLit")!;
    s.editCell(lit, "value", { tag: "lit", value: "x" });
    expect(s.notice).toBeNull();
    expect(s.search).toBe("");
    expect(s.cards().length).toBeGreaterThan(5);
  });
});
