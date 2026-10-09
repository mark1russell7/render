import { describe, it, expect } from "vitest";
import type { InstanceId } from "@render/biblo";
import { resolveMethods } from "@render/biblo";
import type { Ops } from "@render/dsl";
import { app, lit, parseExpr, ref } from "@render/dsl";
import type { RenderCtx } from "@render/splay";
import { dehydrate, readCells, splay, splayKit, standardOps, exprClassFor, textOf } from "@render/splay";
import { ViewerSession, decodeValue, encodeValue } from "./session.ts";
import { viewerOps } from "./renderers.tsx";

// === A text kit with the atoms of the viewer: a test can compare the output as text ===

type Render = (id: string) => string;
const each = (children: unknown, renderChild: unknown): string[] =>
  (children as string[]).map((id) => (renderChild as Render)(id));

const textOps: Ops = {
  ...standardOps,
  textView: (v) => JSON.stringify(v),
  numView: (v) => String(v),
  boolView: (v) => String(v),
  labelView: (v) => textOf(v),
  classChip: (name, traits) => [textOf(name), ...(traits as string[]).map((t) => `#${t}`)].join(" "),
  kvp: (children, renderChild) => {
    const [k, v] = each(children, renderChild);
    return `${k ?? "?"}: ${v ?? "?"}`;
  },
  stack: (_c, children, renderChild) => `[${each(children, renderChild).join(", ")}]`,
  grid: (_cells, children, renderChild) => `{${each(children, renderChild).join(", ")}}`,
  exprLitView: (e) => JSON.stringify((e as { value: unknown }).value) ?? "undefined",
  exprRefView: (e) => (e as { path: string[] }).path.join("."),
  exprAppView: (e, children, renderChild) => `${(e as { op: string }).op}(${each(children, renderChild).join(", ")})`,
  summaryView: (label, text) => `<${textOf(label)} ${textOf(text)}>`,
  formulaView: (e) => `=${String(standardOps["formula"]!(e))}`,
  boundaryView: (ext, cells, methods) =>
    `<${[ext === undefined ? "" : `extends ${textOf(ext)}`, `cells ${(cells as string[]).join(" ")}`, `methods ${(methods as string[]).join(" ")}`].join(" | ")}>`,
};
const frame = (ctx: RenderCtx<string>, out: string | undefined): string => `${ctx.detail === "full" ? "▾" : "▸"}${out ?? ""}`;
const textKit = splayKit<string>(exprClassFor, textOps, undefined, frame);

const show = (s: ViewerSession, id: InstanceId, panel: "types" | "canvas"): string =>
  splay(textKit, s.b, s.store, id, { view: s.view(panel) }) ?? "";

const find = (s: ViewerSession, root: InstanceId, test: (id: InstanceId) => boolean): InstanceId | undefined => {
  if (test(root)) return root;
  for (const child of s.b.instances.get(root)?.scope.children ?? []) {
    const hit = find(s, child, test);
    if (hit !== undefined) return hit;
  }
  return undefined;
};

const value = (s: ViewerSession, id: InstanceId): unknown => readCells(s.store, id)["value"];

const opNode = (s: ViewerSession, className: string, op: string): InstanceId => {
  const id = find(s, s.definitionOf(className)!, (i) =>
    s.b.instances.get(i)?.classRef === "ExprApp" && (value(s, i) as { op?: unknown } | undefined)?.op === op);
  if (id === undefined) throw new Error(`no ${op} in ${className}`);
  return id;
};

const formula = (text: string): unknown => {
  const r = parseExpr(text);
  if (!r.ok) throw new Error(r.message);
  return r.expr;
};

describe("level of detail in the viewer", () => {
  it("at level 0, a class card shows the boundary of the class", () => {
    const s = new ViewerSession(viewerOps);
    expect(show(s, s.definitionOf("Text")!, "types")).toBe("▸<extends Top | cells value | methods dehydrate render summary>");
    expect(show(s, s.definitionOf("Top")!, "types")).toBe("▸< | cells  | methods splash flow deref targets dehydrate summary>");
  });

  it("a higher level expands the card, and each method collapses to its formula", () => {
    const s = new ViewerSession(viewerOps);
    s.setLevel("types", 1);
    const text = show(s, s.definitionOf("Text")!, "types");
    expect(text).toContain('"name": "Text"');
    expect(text).toContain("\"methods\": ▸<Grid { dehydrate, render, summary }>");
    s.setLevel("types", 2);
    expect(show(s, s.definitionOf("Text")!, "types")).toContain(`"render": ▸=textView(get(self.cells, "value"), self.setCell)`);
  });

  it("a person expands one instance, and a new level removes the choice", () => {
    const s = new ViewerSession(viewerOps);
    const def = s.definitionOf("Num")!;
    s.setExpanded(def, true);
    expect(show(s, def, "types")).toMatch(/^▾\{/u);
    expect(show(s, s.definitionOf("Text")!, "types")).toMatch(/^▸/u);
    s.setLevel("types", 0);
    expect(show(s, def, "types")).toMatch(/^▸/u);
  });

  it("the chip of a class shows its traits", () => {
    const s = new ViewerSession(viewerOps);
    s.dropClass("Grid");
    s.replace(s.definitionOf("Grid_1")!, { name: "Grid_1", extends: "Grid", cells: { x: { expr: lit(1) }, y: { expr: lit(2) } } });
    expect(s.notice).toBeNull();
    const kvp = s.cards().find(([n]) => n === "Grid_1")![1];
    expect(show(s, kvp, "types")).toMatch(/^Grid_1 #Point: /u);
    // The trait gives the summary of the instance on the canvas
    s.setLevel("canvas", 0);
    expect(show(s, s.canvas[0]!, "canvas")).toBe("▸<Grid_1 (1, 2)>");
  });
});

describe("formula edits", () => {
  it("a formula edit of a method in a card changes the class", () => {
    const s = new ViewerSession(viewerOps);
    s.dropClass("Text");
    s.replace(opNode(s, "Text", "textView"), formula('numView(get(self.cells, "value"), self.setCell)'));
    expect(s.notice).toBeNull();
    expect((resolveMethods(s.b, "Text_1")["render"] as { op: string }).op).toBe("numView");
  });

  it("a formula that gives a literal replaces the op with a literal", () => {
    const s = new ViewerSession(viewerOps);
    s.replace(opNode(s, "Num", "numView"), formula('textView("fixed")'));
    s.replace(opNode(s, "Num", "textView"), formula("42"));
    expect(resolveMethods(s.b, "Num")["render"]).toEqual(lit(42));
  });

  it("a canvas item keeps its class: an ExprApp item accepts an application, and refuses a literal", () => {
    const s = new ViewerSession(viewerOps);
    const id = s.dropClass("ExprApp")!;
    s.replace(id, app("+", ref("self", "a"), lit(1)));
    expect(dehydrate(s.b, s.store, id)).toEqual(app("+", ref("self", "a"), lit(1)));
    s.replace(id, lit(3));
    expect(s.notice).toMatch(/cannot hold a value of the class ExprLit/);
    expect(s.b.instances.get(id)!.classRef).toBe("ExprApp_1");
  });

  it("a card that a replacement makes invalid goes back", () => {
    const s = new ViewerSession(viewerOps);
    s.dropClass("Text");
    s.replace(s.definitionOf("Text_1")!, "not a class");
    expect(s.notice).toMatch(/no name/);
    expect(s.cards().map(([n]) => n)).toContain("Text_1");
  });
});

describe("the data view writes back", () => {
  it("an edit of a text in the data view changes the item and its class", () => {
    const s = new ViewerSession(viewerOps);
    const id = s.dropClass("Text")!;
    s.toggleView(id);
    s.editCell(s.dataRoot(id)!, "value", "from data");
    expect(value(s, id)).toBe("from data");
    expect(s.b.classes.get("Text_1")!.cells["value"]!.expr).toEqual(lit("from data"));
  });

  it("an add in the data view of a stack makes a child of the item", () => {
    const s = new ViewerSession(viewerOps);
    const id = s.dropClass("VStack")!;
    s.toggleView(id);
    s.addChild(s.dataRoot(id)!, "Num");
    expect(dehydrate(s.b, s.store, id)).toEqual([0]);
  });

  it("an edit of a field of a class without a value cell goes to its cell", () => {
    const s = new ViewerSession(viewerOps);
    const id = s.dropClass("HtmlElement")!;
    s.toggleView(id);
    const tag = find(s, s.dataRoot(id)!, (i) => value(s, i) === "div")!;
    s.editCell(tag, "value", "p");
    expect(readCells(s.store, id)["tag"]).toBe("p");
  });
});

describe("the twin of a data instance", () => {
  it("a value edit in the data view keeps the user class of a child", () => {
    const s = new ViewerSession(viewerOps);
    const stack = s.dropClass("VStack")!;
    s.dropClass("Text");
    s.addChild(stack, "Text_2");
    const child = s.b.instances.get(stack)!.scope.children[0]!;
    s.toggleView(stack);
    const leaf = s.b.instances.get(s.dataRoot(stack)!)!.scope.children[0]!;
    s.editCell(leaf, "value", "kept class");
    expect(s.b.instances.get(stack)!.scope.children).toEqual([child]);
    expect(s.b.instances.get(child)!.classRef).toBe("Text_2");
    expect(value(s, child)).toBe("kept class");
  });

  it("a structural edit in the data view hydrates the data again", () => {
    const s = new ViewerSession(viewerOps);
    const stack = s.dropClass("VStack")!;
    s.toggleView(stack);
    s.addChild(s.dataRoot(stack)!, "Text");
    s.addChild(s.dataRoot(stack)!, "Num");
    expect(dehydrate(s.b, s.store, stack)).toEqual(["", 0]);
  });
});

describe("the children of a container", () => {
  it("a child moves and goes, the actions are in the record, and undo brings it back", () => {
    const s = new ViewerSession(viewerOps);
    const stack = s.dropClass("VStack")!;
    s.addChild(stack, "Num");
    s.addChild(stack, "Bool");
    const [num, bool] = s.b.instances.get(stack)!.scope.children;
    s.moveChild(bool!, 0);
    expect(s.b.instances.get(stack)!.scope.children).toEqual([bool, num]);
    expect(dehydrate(s.b, s.store, stack)).toEqual([false, 0]);
    s.removeChild(num!);
    expect(dehydrate(s.b, s.store, stack)).toEqual([false]);
    s.undo();
    expect(dehydrate(s.b, s.store, stack)).toEqual([false, 0]);
    s.undo();
    expect(dehydrate(s.b, s.store, stack)).toEqual([0, false]);
  });

  it("refuses the root of a canvas item, a card, the chip of a card, and a position out of range", () => {
    const s = new ViewerSession(viewerOps);
    const id = s.dropClass("Text")!;
    const before = s.canUndo;
    s.removeChild(id);
    s.removeChild(s.definitionOf("Text")!);
    const chip = s.b.instances.get(s.b.instances.get(s.definitionOf("Text")!)!.scope.parent!)!.scope.children[0]!;
    s.removeChild(chip);
    expect(s.b.instances.has(id) && s.b.instances.has(chip)).toBe(true);
    const stack = s.dropClass("VStack")!;
    s.addChild(stack, "Num");
    const undoDepth = s.save().actions.length;
    s.moveChild(s.b.instances.get(stack)!.scope.children[0]!, 5);
    expect(s.save().actions.length).toBe(undoDepth);
    expect(before).toBe(true);
  });

  it("a removed method in a card changes the class, and a removed name is refused", () => {
    const s = new ViewerSession(viewerOps);
    s.dropClass("Text");
    s.replace(s.definitionOf("Text_1")!, { name: "Text_1", extends: "Text", methods: { summary: lit(1) } });
    const methods = find(s, s.definitionOf("Text_1")!, (i) => value(s, i) === "methods")!;
    s.removeChild(s.b.instances.get(methods)!.scope.parent!);
    expect(s.b.classes.get("Text_1")!.methods).toBeUndefined();
    const name = find(s, s.definitionOf("Text_1")!, (i) => value(s, i) === "name")!;
    s.removeChild(s.b.instances.get(name)!.scope.parent!);
    expect(s.notice).toMatch(/no name/);
    expect(s.b.classes.has("Text_1")).toBe(true);
  });

  it("structural edits in the data view apply to the twin, thus the user classes stay", () => {
    const s = new ViewerSession(viewerOps);
    const stack = s.dropClass("VStack")!;
    s.dropClass("Text");
    s.addChild(stack, "Text_2");
    s.toggleView(stack);
    const data = s.dataRoot(stack)!;
    s.addChild(data, "Text_2");
    s.addChild(data, "Num");
    expect(s.b.instances.get(stack)!.scope.children.map((c) => s.b.instances.get(c)!.classRef)).toEqual(["Text_2", "Text_2", "Num"]);
    const dataNum = s.b.instances.get(data)!.scope.children[2]!;
    s.moveChild(dataNum, 0);
    expect(s.b.instances.get(stack)!.scope.children.map((c) => s.b.instances.get(c)!.classRef)).toEqual(["Num", "Text_2", "Text_2"]);
    s.removeChild(s.b.instances.get(data)!.scope.children[1]!);
    expect(s.b.instances.get(stack)!.scope.children.map((c) => s.b.instances.get(c)!.classRef)).toEqual(["Num", "Text_2"]);
    s.replace(s.b.instances.get(data)!.scope.children[0]!, { k: 1 });
    expect(dehydrate(s.b, s.store, stack)).toEqual([{ k: 1 }, ""]);
    expect(s.b.instances.get(s.b.instances.get(stack)!.scope.children[1]!)!.classRef).toBe("Text_2");
  });
});

describe("undo and redo", () => {
  it("undo takes back an edit and redo applies it again, with the same IDs", () => {
    const s = new ViewerSession(viewerOps);
    const id = s.dropClass("Text")!;
    s.editCell(id, "value", "one");
    s.editCell(id, "value", "two");
    s.undo();
    expect(s.canRedo).toBe(true);
    expect(value(s, id)).toBe("one");
    s.redo();
    expect(value(s, id)).toBe("two");
    s.undo();
    s.undo();
    s.undo();
    expect(s.canvas).toEqual([]);
    expect(s.canUndo).toBe(false);
  });

  it("a new action removes the redo record", () => {
    const s = new ViewerSession(viewerOps);
    const id = s.dropClass("Num")!;
    s.editCell(id, "value", 1);
    s.undo();
    s.editCell(id, "value", 2);
    expect(s.canRedo).toBe(false);
  });

  it("undo brings back the state before a reset", () => {
    const s = new ViewerSession(viewerOps);
    const id = s.dropClass("Text")!;
    s.editCell(id, "value", "kept");
    s.reset();
    expect(s.canvas).toEqual([]);
    s.undo();
    expect(s.canvas).toEqual([id]);
    expect(value(s, id)).toBe("kept");
  });

  it("the search box is not in the record, and it keeps its text through an undo", () => {
    const s = new ViewerSession(viewerOps);
    s.dropClass("Text");
    s.editCell(s.searchId, "value", "text");
    s.undo();
    expect(s.canvas).toEqual([]);
    expect(s.search).toBe("text");
  });

  it("undo keeps the choices of the person for the instances that stay", () => {
    const s = new ViewerSession(viewerOps);
    const def = s.definitionOf("Grid")!;
    s.setExpanded(def, true);
    const id = s.dropClass("Text")!;
    s.editCell(id, "value", "x");
    s.undo();
    expect(show(s, def, "types")).toMatch(/^▾/u);
  });
});

describe("save and restore", () => {
  it("a saved session replays to the same model", () => {
    const s = new ViewerSession(viewerOps);
    const id = s.dropClass("Text")!;
    s.editCell(id, "value", "saved");
    const n = s.dropClass("Num")!;
    s.editCell(n, "value", 7);
    const json = JSON.parse(JSON.stringify(s.save())) as unknown;
    const t = new ViewerSession(viewerOps);
    expect(t.restore(json)).toBe(true);
    expect(t.canvas).toEqual([id, n]);
    expect(value(t, id)).toBe("saved");
    expect(value(t, n)).toBe(7);
    expect(t.canUndo).toBe(true);
  });

  it("a saved session keeps the levels and the choices of the person", () => {
    const s = new ViewerSession(viewerOps);
    const def = s.definitionOf("Grid")!;
    s.setExpanded(def, true);
    s.setLevel("canvas", 3);
    const t = new ViewerSession(viewerOps);
    t.restore(JSON.parse(JSON.stringify(s.save())) as unknown);
    expect(t.level("canvas")).toBe(3);
    expect(t.view("types").isExpanded(def, 0)).toBe(true);
    expect(t.view("types").isExpanded(t.definitionOf("Text")!, 0)).toBe(false);
  });

  it("refuses a value that is not a session, and a session of another version", () => {
    const s = new ViewerSession(viewerOps);
    expect(s.restore({ hello: 1 })).toBe(false);
    expect(s.notice).toMatch(/not a saved session/);
    expect(s.restore({ ...s.save(), baseline: "other" })).toBe(false);
    expect(s.notice).toMatch(/another version/);
  });

  it("an action that is not valid stops the replay, with a notice", () => {
    const s = new ViewerSession(viewerOps);
    s.dropClass("Text");
    const saved = s.save();
    const t = new ViewerSession(viewerOps);
    t.restore({ ...saved, actions: [...saved.actions, { kind: "explode" }] });
    expect(t.canvas).toHaveLength(1);
    expect(t.notice).toMatch(/action 2/);
  });

  it("the JSON form keeps undefined, NaN, the infinities, -0 and a field named $render", () => {
    const v = { a: undefined, b: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 1], $render: "x" };
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue(v)))) as typeof v;
    expect(Object.hasOwn(back, "a")).toBe(true);
    expect(back.a).toBeUndefined();
    expect(back.b).toEqual([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 1]);
    expect(Object.is(back.b[3], -0)).toBe(true);
    expect(back.$render).toBe("x");
  });
});

describe("the memo after a class change", () => {
  it("deletes only the entries of the instances of the changed class and of its subclasses", () => {
    const s = new ViewerSession(viewerOps);
    const text = s.dropClass("Text")!;
    const num = s.dropClass("Num")!;
    s.cache.set(text, "text output");
    s.cache.set(num, "num output");
    const lit0 = find(s, s.definitionOf("Text")!, (i) => s.b.instances.get(i)?.classRef === "ExprLit")!;
    s.editCell(lit0, "value", lit("new default"));
    expect(s.cache.has(text)).toBe(false);
    expect(s.cache.get(num)).toBe("num output");
  });
});
