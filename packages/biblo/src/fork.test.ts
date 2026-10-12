import { describe, it, expect } from "vitest";
import { biblo, classNodeOps, componentClass, forkBiblo, instantiate, registerClass, updateClass } from "@render/biblo";
import { forkStore, nodeStore, readValue } from "@render/node";
import { lit } from "@render/dsl";

const setup = () => {
  const b = biblo();
  const store = nodeStore({ nodeOps: classNodeOps(b) });
  registerClass(b, componentClass("Box", { w: { expr: lit(1) } }));
  const root = instantiate(b, store, "Box");
  instantiate(b, store, "Box", root.id, { w: lit(5) });
  return { b, store, root };
};

describe("forkBiblo", () => {
  it("gives a copy whose instances and classes change independently, with the same next IDs", () => {
    const { b, store, root } = setup();
    const b2 = forkBiblo(b);
    const store2 = forkStore(store, { nodeOps: classNodeOps(b2) });
    const x = instantiate(b, store, "Box", root.id);
    const y = instantiate(b2, store2, "Box", root.id);
    expect(y.id).toBe(x.id);
    expect(b.instances.get(root.id)!.scope.children).toHaveLength(2);
    expect(b2.instances.get(root.id)!.scope.children).toHaveLength(2);
    instantiate(b, store, "Box", root.id);
    expect(b2.instances.get(root.id)!.scope.children).toHaveLength(2);
    updateClass(b2, store2, componentClass("Box", { w: { expr: lit(9) } }));
    const slot = (s: typeof store, id: string) => s.nodes.get(id)!.slots.get("w")!;
    expect(readValue(store2, slot(store2, root.id))).toEqual({ tag: "some", value: 9 });
    expect(readValue(store, slot(store, root.id))).toEqual({ tag: "some", value: 1 });
    expect(b.classes.get("Box")!.cells["w"]!.expr).toEqual(lit(1));
    // A bound cell stays bound in the copy: the class update does not reach it
    const bound = b2.instances.get(root.id)!.scope.children[0]!;
    expect(readValue(store2, slot(store2, bound))).toEqual({ tag: "some", value: 5 });
  });
});
