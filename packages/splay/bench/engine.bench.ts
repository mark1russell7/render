/**
 * The speed lane of the engine. `pnpm bench` runs it, and the nightly workflow keeps the report.
 * The lane only reports: no time limit fails it.
 */
import { test } from "vitest";
import {
  splayKit, hydrate, splay, registerClasses,
  standardClasses, standardOps, defaultClassFor,
} from "@render/splay";
import { biblo } from "@render/biblo";
import { nodeStore, defaultOps, resolveAll, wireSeats, setValue } from "@render/node";
import type { SplayCache } from "@render/splay";

/** A value with approximately 1000 nodes: 50 objects of 5 fields */
const bigValue = Object.fromEntries(
  Array.from({ length: 50 }, (_, i) => [
    `section${String(i)}`,
    Object.fromEntries(Array.from({ length: 5 }, (_, j) => [`field${String(j)}`, i * 10 + j])),
  ]),
);

const setup = () => {
  const b = biblo();
  const store = nodeStore();
  registerClasses(b, standardClasses);
  type RenderChild = (id: string) => string | undefined;
  const joinChildren = (children: unknown, renderChild: unknown): string =>
    (children as string[]).map((id) => (renderChild as RenderChild)(id) ?? "").join(",");
  const kit = splayKit<string>(defaultClassFor, {
    ...standardOps,
    textView: (v: unknown) => String(v),
    numView: (v: unknown) => String(v),
    boolView: (v: unknown) => String(v),
    // The output ops recurse like real output ops, thus the splay bench walks the full tree
    kvp: (children: unknown, renderChild: unknown) => `[${joinChildren(children, renderChild)}]`,
    stack: (_cls: unknown, children: unknown, renderChild: unknown) => joinChildren(children, renderChild),
    grid: (_cells: unknown, children: unknown, renderChild: unknown) => `{${joinChildren(children, renderChild)}}`,
  });
  return { b, store, kit };
};

const settled = () => {
  const { b, store, kit } = setup();
  const root = hydrate(kit, b, store, bigValue);
  wireSeats(store);
  resolveAll(store, defaultOps, standardOps);
  return { b, store, kit, root };
};

test("hydrate a value of approximately 1000 nodes", async ({ bench }) => {
  await bench("hydrate", () => {
    const { b, store, kit } = setup();
    hydrate(kit, b, store, bigValue);
  });
});

test("resolution and epochs in a store of approximately 1000 nodes", async ({ bench }) => {
  const { store } = settled();
  const leaf = [...store.nodes.keys()].find((id) => id.endsWith(".value")) ?? "";
  let tick = 0;
  await bench.compare(
    bench("resolveAll on a settled store", () => {
      resolveAll(store, defaultOps, standardOps);
    }),
    bench("epoch: one leaf edit", () => {
      tick++;
      setValue(store, defaultOps, standardOps, leaf, tick);
    }),
  );
});

test("splay a tree of approximately 1000 nodes", async ({ bench }) => {
  const { b, store, kit, root } = settled();
  const cache: SplayCache<string> = new Map();
  await bench.compare(
    bench("full splay, no cache", () => {
      splay(kit, b, store, root.id);
    }),
    bench("full splay, warm cache", () => {
      splay(kit, b, store, root.id, undefined, undefined, cache);
    }),
  );
});
