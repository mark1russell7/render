import type { NodeOps, SplashFn, FlowFn, DerefFn, Node, NodeStore } from "@render/node";
import { defaultOps } from "@render/node";
import type { Biblo } from "./registry.ts";
import { ownerOf, resolveMethods } from "./registry.ts";

/**
 * This function makes the class-level reactive semantics (the defaults of `Top`).
 *
 * The ops of the result use the `splash`, `flow` and `deref` methods of the class that owns each node.
 * The extends chain resolves them, thus the defaults of `Top` apply to all classes, and a class can
 * change them. A node without an owner, or a class without the method, uses `fallback`.
 *
 * The node layer knows nothing of biblo. This factory is how the class layer gives semantics to the
 * node layer without a dependency in the wrong direction. Give the result to `nodeStore`.
 */
export const classNodeOps = (b: Biblo, fallback: NodeOps = defaultOps): NodeOps => {
  const methodFor = <F>(n: Node, store: NodeStore, name: "splash" | "flow" | "deref"): F | undefined => {
    const owner = ownerOf(b, store, n.id);
    if (owner === undefined) return undefined;
    const inst = b.instances.get(owner);
    if (!inst) return undefined;
    const method = resolveMethods(b, inst.classRef)[name];
    return typeof method === "function" ? (method as F) : undefined;
  };

  return {
    splash: (value, target, store) => (methodFor<SplashFn>(target, store, "splash") ?? fallback.splash)(value, target, store),
    flow: (target, store) => (methodFor<FlowFn>(target, store, "flow") ?? fallback.flow)(target, store),
    deref: (root, path, store) => (methodFor<DerefFn>(root, store, "deref") ?? fallback.deref)(root, path, store),
  };
};
