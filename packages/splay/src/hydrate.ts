import type { Biblo, InstanceId, Instance } from "@render/biblo";
import type { NodeStore } from "@render/node";
import { lit } from "@render/dsl";
import { instantiate } from "@render/biblo";

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
 * Values are passed as **bindings** (lit expressions), not setValue.
 * This way resolveAll correctly evaluates them — the expression IS the value.
 *
 * - Primitives become leaf viewers (Text, Num, Bool)
 * - Objects become a Grid of KeyValuePairs
 * - Arrays become a VStack of hydrated children
 */
export const hydrate = (
  b: Biblo,
  store: NodeStore,
  value: unknown,
  parentId?: InstanceId,
): Instance => {
  const className = classFor(value);

  // Pass value as a binding so the cell expr is lit(value), not lit(undefined)
  const bindings = hasValueCell(className) ? { value: lit(value) } : undefined;
  const inst = instantiate(b, store, className, parentId, bindings);

  // For objects, create KeyValuePair children with key/value bindings
  if (className === "Grid" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      instantiate(b, store, "KeyValuePair", inst.id, {
        key: lit(k),
        value: lit(v),
      });
    }
  }

  // For arrays, hydrate each item as a child
  if (className === "VStack" && Array.isArray(value)) {
    for (const item of value) {
      hydrate(b, store, item, inst.id);
    }
  }

  return inst;
};

/** Check if a class has a "value" cell that should receive the data */
const hasValueCell = (className: string): boolean => {
  switch (className) {
    case "Text":
    case "Num":
    case "Bool":
      return true;
    default:
      return false;
  }
};
