import { bench, describe } from "vitest";
import {
  splayKit, hydrate, splay, registerClasses,
  standardClasses, standardOps, defaultClassFor,
} from "@render/splay";
import { biblo } from "@render/biblo";
import { nodeStore, defaultOps, resolveAll, wireSeats, setValue } from "@render/node";
import type { SplayCache } from "@render/splay";

/** A ~1k-node value: 50 objects × ~10 fields */
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
    // Recurse like real output ops do — the splay bench must walk the tree
    kvp: (children: unknown, renderChild: unknown) => `[${joinChildren(children, renderChild)}]`,
    stack: (_cls: unknown, children: unknown, renderChild: unknown) => joinChildren(children, renderChild),
    grid: (_cells: unknown, children: unknown, renderChild: unknown) => `{${joinChildren(children, renderChild)}}`,
  });
  return { b, store, kit };
};

describe("hydrate", () => {
  bench("hydrate ~1k-node value", () => {
    const { b, store, kit } = setup();
    hydrate(kit, b, store, bigValue);
  });
});

describe("resolution & epochs", () => {
  const { b, store, kit } = setup();
  const root = hydrate(kit, b, store, bigValue);
  wireSeats(store);
  resolveAll(store, defaultOps, standardOps);
  const someCell = ((): string => {
    // find a leaf Num cell to edit
    for (const [id, n] of store.nodes) {
      if (id.endsWith(".value") && typeof n.value === "object") return id;
    }
    return root.id;
  })();

  bench("resolveAll on settled ~1k store", () => {
    resolveAll(store, defaultOps, standardOps);
  });

  let tick = 0;
  bench("epoch: single leaf edit in ~1k store", () => {
    tick++;
    setValue(store, defaultOps, standardOps, someCell, tick);
  });
});

describe("splay", () => {
  const { b, store, kit } = setup();
  const root = hydrate(kit, b, store, bigValue);
  wireSeats(store);
  resolveAll(store, defaultOps, standardOps);

  bench("full splay, no cache", () => {
    splay(kit, b, store, root.id);
  });

  const cache: SplayCache<string> = new Map();
  bench("full splay, warm cache", () => {
    splay(kit, b, store, root.id, undefined, undefined, cache);
  });
});
