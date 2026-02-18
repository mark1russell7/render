import type { Biblo, InstanceId, Instance } from "@render/biblo";
import type { NodeStore, NodeId } from "@render/node";
import type { Ops } from "@render/dsl";
import type { NodeOps } from "@render/node";
import { instantiate } from "@render/biblo";
import { setValue } from "@render/node";

/**
 * Determine which viewer class to use for a runtime value.
 */
export const classFor = (value: unknown): string => {
  if (typeof value === "string") return "Text";
  if (typeof value === "number") return "Num";
  if (typeof value === "boolean") return "Bool";
  if (Array.isArray(value)) return "VStack";
  if (typeof value === "object" && value !== null) return "Grid";
  return "Text";
};

/**
 * Hydrate: recursively build an instance tree from a runtime value.
 *
 * - Primitives become leaf viewers (Text, Num, Bool)
 * - Objects become a Grid of KeyValuePairs
 * - Arrays become a VStack of hydrated children
 *
 * Returns the root instance.
 */
export const hydrate = (
  b: Biblo,
  store: NodeStore,
  nodeOps: NodeOps,
  dslOps: Ops,
  value: unknown,
  parentId?: InstanceId,
): Instance => {
  const className = classFor(value);
  const inst = instantiate(b, store, className, parentId);

  // Set the value cell
  const valueNodeId: NodeId = `${inst.id}.value`;
  if (store.nodes.has(valueNodeId)) {
    setValue(store, nodeOps, dslOps, valueNodeId, value);
  }

  // For objects, create KeyValuePair children
  if (className === "Grid" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      const kvp = instantiate(b, store, "KeyValuePair", inst.id);
      const keyNodeId: NodeId = `${kvp.id}.key`;
      const valNodeId: NodeId = `${kvp.id}.value`;
      if (store.nodes.has(keyNodeId)) {
        setValue(store, nodeOps, dslOps, keyNodeId, k);
      }
      if (store.nodes.has(valNodeId)) {
        setValue(store, nodeOps, dslOps, valNodeId, v);
      }
    }
  }

  // For arrays, hydrate each item as a child
  if (className === "VStack" && Array.isArray(value)) {
    for (const item of value) {
      hydrate(b, store, nodeOps, dslOps, item, inst.id);
    }
  }

  return inst;
};
