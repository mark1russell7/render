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
  type Methods = { readonly splash: SplashFn; readonly flow: FlowFn; readonly deref: DerefFn };
  const methodFor = <K extends keyof Methods>(n: Node, store: NodeStore, name: K): Methods[K] => {
    const owner = ownerOf(b, store, n.id);
    const inst = owner === undefined ? undefined : b.instances.get(owner);
    const method = inst ? resolveMethods(b, inst.classRef)[name] : undefined;
    return typeof method === "function" ? (method as Methods[K]) : fallback[name];
  };

  return {
    splash: (value, target, store) => methodFor(target, store, "splash")(value, target, store),
    flow: (target, store) => methodFor(target, store, "flow")(target, store),
    deref: (root, path, store) => methodFor(root, store, "deref")(root, path, store),
  };
};
