import type { NodeOps, SplashFn, FlowFn, DerefFn, Node, NodeId } from "@render/node";
import { defaultOps } from "@render/node";
import type { Biblo } from "./registry.js";
import { resolveMethods } from "./registry.js";

/**
 * Class-level reactive methods.
 *
 * Builds a NodeOps whose splash/flow/deref consult the owning
 * instance's class methods — resolved through the extends chain, so
 * Top's defaults apply everywhere and any class can refine them —
 * falling back to the given ops (engine defaults) when a class doesn't
 * define one.
 *
 * Layering note: node knows nothing of biblo; this factory is how the
 * class layer injects semantics downward without a dependency inversion.
 */
export const classNodeOps = (b: Biblo, fallback: NodeOps = defaultOps): NodeOps => {
  /** node id → owning instance (cell nodes are `${instanceId}.${cell}`) */
  const methodFor = (n: Node, name: string): unknown => {
    const nodeId: NodeId = n.id;
    const dot = nodeId.indexOf(".");
    const instanceId = dot >= 0 ? nodeId.slice(0, dot) : nodeId;
    const inst = b.instances.get(instanceId);
    if (!inst) return undefined;
    const method = resolveMethods(b, inst.classRef)[name];
    return typeof method === "function" ? method : undefined;
  };

  return {
    splash: (value, target, store) => {
      const m = methodFor(target, "splash") as SplashFn | undefined;
      return (m ?? fallback.splash)(value, target, store);
    },
    flow: (target, store) => {
      const m = methodFor(target, "flow") as FlowFn | undefined;
      return (m ?? fallback.flow)(target, store);
    },
    deref: (root, path, store) => {
      const m = methodFor(root, "deref") as DerefFn | undefined;
      return (m ?? fallback.deref)(root, path, store);
    },
  };
};
