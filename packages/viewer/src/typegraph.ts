import type { CellDef, ComponentClass } from "@render/biblo";
import type { Expr, Ops } from "@render/dsl";
import { isExpr } from "@render/dsl";
import { opCategories } from "@render/splay";

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The text that stands for a function method in the type graph. */
const atomText = (name: string): string => `[atom: ${name}]`;

/**
 * This function gives the JSON form of a class for the type graph. An `Expr` method is data, thus it is
 * in the JSON in full. A function method is an atom, thus only its name is in the JSON.
 */
export const classToJson = (cls: ComponentClass): Record<string, unknown> => {
  const result: Record<string, unknown> = { name: cls.name };
  if (cls.extends !== undefined) result["extends"] = cls.extends;

  const cells: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(cls.cells)) {
    const cell: Record<string, unknown> = { expr: def.expr };
    if (def.type !== undefined) cell["type"] = def.type;
    if (def.bindings !== undefined) cell["bindings"] = def.bindings;
    cells[name] = cell;
  }
  if (Object.keys(cells).length > 0) result["cells"] = cells;

  const methods: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(cls.methods ?? {})) {
    if (isExpr(method)) methods[name] = method;
    else if (typeof method === "function") methods[name] = atomText(name);
  }
  if (Object.keys(methods).length > 0) result["methods"] = methods;
  return result;
};

/** This function gives the ops of a registry by category, as data for the type graph. An op without a category is a view atom. */
export const atomsToJson = (ops: Ops): Record<string, string[]> => {
  const categorized = new Set<string>();
  const result: Record<string, string[]> = {};
  for (const [category, names] of Object.entries(opCategories)) {
    const matched = names.filter((n) => hasOwn(ops, n));
    if (matched.length > 0) result[category] = matched;
    for (const n of matched) categorized.add(n);
  }
  const view = Object.keys(ops).filter((n) => !categorized.has(n));
  if (view.length > 0) result["view"] = view;
  return result;
};

/** The result of the reconstruction of a class from the type graph. */
export type Reconstruction =
  | { readonly ok: true; readonly cls: ComponentClass }
  | { readonly ok: false; readonly reason: string };

/**
 * This function makes a class again from the JSON of its card in the type graph. It keeps each function
 * atom of the original class. It refuses JSON that is not a valid class. Examples are a cell or a method
 * that is not a well-formed expression, an incorrect type and incorrect bindings. The reason of the refusal
 * tells the person what is wrong.
 */
export const reconstructClass = (json: unknown, original: ComponentClass | undefined): Reconstruction => {
  if (!isRecord(json) || typeof json["name"] !== "string") return { ok: false, reason: "The class has no name." };
  const name = json["name"];
  const ext = json["extends"];
  if (ext !== undefined && typeof ext !== "string") return { ok: false, reason: `The extends of ${name} is not a class name.` };

  const cells: Record<string, CellDef> = {};
  const cellsJson = json["cells"] ?? {};
  if (!isRecord(cellsJson)) return { ok: false, reason: `The cells of ${name} are not an object.` };
  for (const [cellName, def] of Object.entries(cellsJson)) {
    if (!isRecord(def) || !isExpr(def["expr"])) {
      return { ok: false, reason: `The cell ${cellName} of ${name} has no valid expression.` };
    }
    const type = def["type"];
    if (type !== undefined && typeof type !== "string") return { ok: false, reason: `The type of the cell ${cellName} is not a class name.` };
    const bindings = def["bindings"];
    if (bindings !== undefined && (!isRecord(bindings) || !Object.values(bindings).every(isExpr))) {
      return { ok: false, reason: `The bindings of the cell ${cellName} are not valid expressions.` };
    }
    cells[cellName] = {
      expr: def["expr"],
      ...(type !== undefined ? { type } : {}),
      ...(bindings !== undefined ? { bindings: bindings as Readonly<Record<string, Expr>> } : {}),
    };
  }

  const methods: Record<string, unknown> = {};
  const methodsJson = json["methods"] ?? {};
  if (!isRecord(methodsJson)) return { ok: false, reason: `The methods of ${name} are not an object.` };
  for (const [methodName, value] of Object.entries(methodsJson)) {
    if (value === atomText(methodName)) {
      const atom = original?.methods?.[methodName];
      if (typeof atom === "function") methods[methodName] = atom;
    } else if (isExpr(value)) {
      methods[methodName] = value;
    } else {
      return { ok: false, reason: `The method ${methodName} of ${name} is not a valid expression.` };
    }
  }

  return {
    ok: true,
    cls: {
      name,
      cells,
      ...(ext !== undefined && ext !== "" ? { extends: ext } : {}),
      ...(Object.keys(methods).length > 0 ? { methods } : {}),
    },
  };
};
