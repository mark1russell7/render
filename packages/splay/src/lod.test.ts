import { describe, it, expect } from "vitest";
import {
  splayKit, hydrate, hydrateAs, rehydrate, replaceValue, dehydrate, splay, viewPolicy, invalidateSplay,
  standardClasses, standardTraits, standardOps, exprClassFor, briefOf,
} from "@render/splay";
import type { RenderCtx, SplayCache } from "@render/splay";
import { biblo, registerClass, registerClasses, registerTrait, instantiate, classNodeOps } from "@render/biblo";
import { nodeStore } from "@render/node";
import type { Ops } from "@render/dsl";
import { app, evaluate, lit, objectResolver, ref } from "@render/dsl";
import { isSome } from "@render/optional";

/** The view atoms of a text kit: each one gives a short text, thus a test can compare the output. */
const textOps: Ops = {
  ...standardOps,
  textView: (v) => JSON.stringify(v),
  numView: (v) => String(v),
  boolView: (v) => String(v),
  kvp: (children, renderChild) => {
    const [k, v] = children as string[];
    const render = renderChild as (id: string) => string;
    return `${k === undefined ? "?" : render(k)}: ${v === undefined ? "?" : render(v)}`;
  },
  stack: (_c, children, renderChild) => `[${(children as string[]).map((id) => (renderChild as (i: string) => string)(id)).join(", ")}]`,
  grid: (_cells, children, renderChild) => `{${(children as string[]).map((id) => (renderChild as (i: string) => string)(id)).join(", ")}}`,
  exprLitView: (e) => `lit ${JSON.stringify((e as { value: unknown }).value)}`,
  exprRefView: (e) => `ref ${(e as { path: string[] }).path.join(".")}`,
  exprAppView: (e, children, renderChild) =>
    `${(e as { op: string }).op}(${(children as string[]).map((id) => (renderChild as (i: string) => string)(id)).join(", ")})`,
  summaryView: (label, text) => `<${String(label)} ${String(text)}>`,
  formulaView: (e) => `=${typeof e === "object" ? String(standardOps["formula"]!(e)) : "?"}`,
};

/** The frame of the text kit: a marker of the state of each collapsible instance. */
const frame = (ctx: RenderCtx<string>, output: string | undefined): string => `${ctx.detail === "full" ? "▾" : "▸"}${output ?? ""}`;

const setup = (withFrame = false) => {
  const b = biblo();
  const store = nodeStore({ nodeOps: classNodeOps(b), ops: standardOps });
  registerClasses(b, standardClasses);
  const kit = splayKit<string>(exprClassFor, textOps, undefined, withFrame ? frame : undefined);
  return { b, store, kit };
};

describe("level of detail", () => {
  it("without a view policy, each instance renders its full view", () => {
    const { b, store, kit } = setup();
    const root = hydrate(kit, b, store, { a: 1, b: [true, "x"] });
    expect(splay(kit, b, store, root.id)).toBe('{"a": 1, "b": [true, "x"]}');
  });

  it("a collapsed instance renders its summary: the boundary of its value", () => {
    const { b, store, kit } = setup();
    const root = hydrate(kit, b, store, { a: 1, b: [true, "x"] });
    expect(splay(kit, b, store, root.id, { view: viewPolicy(0) })).toBe("<Grid { a, b }>");
    expect(splay(kit, b, store, root.id, { view: viewPolicy(1) })).toBe('{"a": 1, "b": <VStack [2 items]>}');
    expect(splay(kit, b, store, root.id, { view: viewPolicy(2) })).toBe('{"a": 1, "b": [true, "x"]}');
  });

  it("the level counts only the collapsible instances above an instance", () => {
    const { b, store } = setup();
    const levels: [string, number][] = [];
    const kit = splayKit<string>(exprClassFor, textOps, undefined, (ctx, out) => {
      levels.push([ctx.classRef, ctx.level]);
      return out ?? "";
    });
    const root = hydrate(kit, b, store, { a: { b: [1] } });
    splay(kit, b, store, root.id, { view: viewPolicy(Infinity) });
    expect(levels.toSorted((x, y) => x[1] - y[1])).toEqual([["Grid", 0], ["Grid", 1], ["VStack", 2]]);
  });

  it("a leaf gives its render as its summary, thus it is not collapsible and has no frame", () => {
    const { b, store, kit } = setup(true);
    for (const value of ["s", 1, true, lit(2), ref("a", "b")]) {
      const inst = hydrate(kit, b, store, value);
      expect(splay(kit, b, store, inst.id, { view: viewPolicy(0) })).not.toMatch(/^[▸▾]/u);
    }
  });

  it("the frame wraps each collapsible instance, and the toggle of the context expands it", () => {
    const { b, store, kit } = setup(true);
    const root = hydrate(kit, b, store, [[1], [2]]);
    const overrides = new Map<string, boolean>();
    const cache: SplayCache<string> = new Map();
    const toggled: string[] = [];
    const view = viewPolicy(1, overrides, (id) => {
      toggled.push(id);
      invalidateSplay(b, cache, [id]);
    });
    expect(splay(kit, b, store, root.id, { view, cache })).toBe("▾[▸<VStack [1 item]>, ▸<VStack [1 item]>]");

    let toggle: (() => void) | undefined;
    const spy = splayKit<string>(exprClassFor, textOps, undefined, (ctx, out) => {
      if (ctx.instanceId === root.scope.children[0]) toggle = ctx.toggle;
      return frame(ctx, out);
    });
    cache.clear();
    splay(spy, b, store, root.id, { view, cache });
    toggle!();
    expect(toggled).toEqual([root.scope.children[0]]);
    expect(splay(kit, b, store, root.id, { view, cache })).toBe("▾[▾[1], ▸<VStack [1 item]>]");
  });

  it("without overrides, the policy is fixed: the context has no toggle", () => {
    const { b, store } = setup();
    let toggle: unknown = "unset";
    const kit = splayKit<string>(exprClassFor, textOps, undefined, (ctx, out) => {
      toggle = ctx.toggle;
      return out ?? "";
    });
    const root = hydrate(kit, b, store, [1]);
    splay(kit, b, store, root.id, { view: viewPolicy(1) });
    expect(toggle).toBeUndefined();
  });

  it("an ExprApp collapses to its formula on one line", () => {
    const { b, store, kit } = setup();
    const expr = app("+", app("*", ref("self", "a"), lit(2)), lit(1));
    const root = hydrate(kit, b, store, expr);
    expect(splay(kit, b, store, root.id, { view: viewPolicy(0) })).toBe("=self.a * 2 + 1");
    expect(splay(kit, b, store, root.id, { view: viewPolicy(1) })).toBe("+(=self.a * 2, lit 1)");
  });

  it("an HtmlElement summary shows its tag and the number of its children", () => {
    const { b, store, kit } = setup();
    const el = instantiate(b, store, "HtmlElement");
    instantiate(b, store, "Text", el.id);
    expect(splay(kit, b, store, el.id, { view: viewPolicy(0) })).toBe("<<div> [1 item]>");
  });

  it("a trait gives a summary to each class with its cells, and two traits make it ambiguous", () => {
    const { b, store, kit } = setup();
    for (const t of standardTraits) registerTrait(b, t);
    registerClass(b, { name: "Pos", extends: "Top", cells: { x: { expr: lit(3) }, y: { expr: lit(4) } } });
    registerClass(b, { name: "Tag", extends: "Grid", cells: { label: { expr: lit("hello") } } });
    registerClass(b, { name: "Both", extends: "Top", cells: { x: { expr: lit(1) }, y: { expr: lit(2) }, label: { expr: lit("b") } } });
    const view = viewPolicy(0);
    expect(splay(kit, b, store, instantiate(b, store, "Pos").id, { view })).toBe("<Pos (3, 4)>");
    expect(splay(kit, b, store, instantiate(b, store, "Tag").id, { view })).toBe("<Tag hello>");
    expect(splay(kit, b, store, instantiate(b, store, "Both").id, { view })).toBe("<Both { x, y, label }>");
  });

  it("the render context gives the dehydrated value", () => {
    const { b, store } = setup();
    let seen: unknown;
    registerClass(b, { name: "Probe", extends: "Grid", cells: {}, methods: { render: (ctx: RenderCtx<string>) => { seen = ctx.dehydrate(); return ""; } } });
    const root = hydrateAs(splayKit(exprClassFor, standardOps), b, store, "Probe", { k: "v" });
    splay(splayKit<string>(exprClassFor, textOps), b, store, root.id);
    expect(seen).toEqual({ k: "v" });
  });
});

describe("hydrateAs", () => {
  it("uses the named class at the root and classFor below it", () => {
    const { b, store, kit } = setup();
    registerClass(b, { name: "Card", extends: "Grid", cells: {} });
    const root = hydrateAs(kit, b, store, "Card", { a: [1] });
    expect(root.classRef).toBe("Card");
    const kvp = b.instances.get(root.scope.children[0]!)!;
    expect(b.instances.get(kvp.scope.children[1]!)!.classRef).toBe("VStack");
    expect(dehydrate(b, store, root.id)).toEqual({ a: [1] });
  });
});

describe("rehydrate and replaceValue", () => {
  it("rehydrate keeps the ID and the class, and makes new children", () => {
    const { b, store, kit } = setup();
    const root = hydrate(kit, b, store, [1, 2]);
    const again = rehydrate(kit, b, store, root.id, ["a"]);
    expect(again?.id).toBe(root.id);
    expect(dehydrate(b, store, root.id)).toEqual(["a"]);
    expect(b.instances.get(root.id)!.scope.children).toHaveLength(1);
  });

  it("rehydrate keeps the children of a class without a hydrate method", () => {
    const { b, store, kit } = setup();
    const el = instantiate(b, store, "HtmlElement");
    const kid = instantiate(b, store, "Text", el.id);
    rehydrate(kit, b, store, el.id, { tag: "p" });
    expect(b.instances.get(el.id)!.scope.children).toEqual([kid.id]);
  });

  it("rehydrate writes the value cell of a leaf", () => {
    const { b, store, kit } = setup();
    const t = hydrate(kit, b, store, "old");
    rehydrate(kit, b, store, t.id, "new");
    expect(dehydrate(b, store, t.id)).toBe("new");
  });

  it("replaceValue gives a new class at the same place among the children", () => {
    const { b, store, kit } = setup();
    const root = hydrate(kit, b, store, [1, "two", 3]);
    const middle = root.scope.children[1]!;
    const next = replaceValue(kit, b, store, middle, { k: true });
    expect(next?.id).not.toBe(middle);
    expect(next?.classRef).toBe("Grid");
    expect(b.instances.has(middle)).toBe(false);
    expect(b.instances.get(root.id)!.scope.children[1]).toBe(next?.id);
    expect(dehydrate(b, store, root.id)).toEqual([1, { k: true }, 3]);
  });

  it("replaceValue of an expression: a formula edit that gives a literal changes the class", () => {
    const { b, store, kit } = setup();
    const root = hydrate(kit, b, store, app("+", lit(1), lit(2)));
    const arg = root.scope.children[0]!;
    replaceValue(kit, b, store, arg, app("*", ref("self", "x"), lit(3)));
    expect(dehydrate(b, store, root.id)).toEqual(app("+", app("*", ref("self", "x"), lit(3)), lit(2)));
    const top = replaceValue(kit, b, store, root.id, lit(7));
    expect(top?.classRef).toBe("ExprLit");
    expect(dehydrate(b, store, top!.id)).toEqual(lit(7));
  });

  it("replaceValue with the same class keeps the ID", () => {
    const { b, store, kit } = setup();
    const root = hydrate(kit, b, store, ["a"]);
    const leaf = root.scope.children[0]!;
    expect(replaceValue(kit, b, store, leaf, "b")?.id).toBe(leaf);
    expect(dehydrate(b, store, root.id)).toEqual(["b"]);
  });

  it("an instance in a typed cell keeps its place and its class", () => {
    const { b, store, kit } = setup();
    registerClass(b, { name: "Holder", extends: "Top", cells: { kid: { expr: lit(undefined), type: "Text" } } });
    const holder = instantiate(b, store, "Holder");
    const kid = store.nodes.get(holder.id)!.slots.get("kid")!;
    expect(replaceValue(kit, b, store, kid, 42)?.id).toBe(kid);
    expect(b.instances.get(kid)!.classRef).toBe("Text");
  });

  it("gives undefined for a missing instance", () => {
    const { b, store, kit } = setup();
    expect(rehydrate(kit, b, store, "missing", 1)).toBeUndefined();
    expect(replaceValue(kit, b, store, "missing", 1)).toBeUndefined();
  });
});

describe("the ops of summaries", () => {
  const run = (e: Parameters<typeof evaluate>[0]) => {
    const r = evaluate(e, objectResolver({}), standardOps);
    return isSome(r) ? r.value : "none";
  };

  it("keys, count, join and call", () => {
    expect(run(app("keys", lit({ a: 1, b: 2 })))).toEqual(["a", "b"]);
    expect(run(app("count", lit([1, 2, 3])))).toBe(3);
    expect(run(app("count", lit({ a: 1 })))).toBe(1);
    expect(run(app("count", lit("abcd")))).toBe(4);
    expect(run(app("count", lit(5)))).toBe("none");
    expect(run(app("join", lit(["a", 1, true])))).toBe("a, 1, true");
    expect(run(app("join", lit(["a", "b"]), lit("|")))).toBe("a|b");
    expect(run(app("call", app("fn", lit(["d"]), app("+", ref("d"), lit(1))), lit(41)))).toBe(42);
    expect(run(app("call", lit(1)))).toBe("none");
  });

  it("formula and brief", () => {
    expect(run(app("formula", lit(app("+", ref("a"), lit(1)))))).toBe("a + 1");
    expect(run(app("formula", lit("text")))).toBe("none");
    expect(briefOf([1, 2])).toBe("[2 items]");
    expect(briefOf([1])).toBe("[1 item]");
    expect(briefOf({})).toBe("{}");
    expect(briefOf({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 })).toBe("{ a, b, c, d, e, f, … +1 }");
    expect(briefOf("x".repeat(80))).toHaveLength(48);
    expect(briefOf(undefined)).toBe("undefined");
    expect(briefOf(lit(3))).toBe("3");
  });
});
