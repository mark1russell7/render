import type { CellDef, ComponentClass, Trait } from "@mark1russell7/render-biblo";
import type { Expr, Ops } from "@mark1russell7/render-dsl";
import { asExpr, isExpr, isExprDocument } from "@mark1russell7/render-dsl";
import { opCategories } from "@mark1russell7/render-splay";

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

  // fromEntries makes own data properties, thus a cell or a method named "__proto__" stays a field
  const cells = Object.fromEntries(Object.entries(cls.cells).map(([name, def]) => [name, {
    expr: def.expr,
    ...(def.type !== undefined ? { type: def.type } : {}),
    ...(def.bindings !== undefined ? { bindings: def.bindings } : {}),
  }]));
  if (Object.keys(cells).length > 0) result["cells"] = cells;

  const methods = Object.fromEntries(
    Object.entries(cls.methods ?? {}).flatMap(([name, method]): [string, unknown][] =>
      isExpr(method) ? [[name, method]] : typeof method === "function" ? [[name, atomText(name)]] : []),
  );
  if (Object.keys(methods).length > 0) result["methods"] = methods;
  return result;
};

/**
 * This function gives the traits as data for the type graph: the cells that each trait must find, and its
 * methods. An `Expr` method is in full, and a function method is only its name.
 */
export const traitsToJson = (traits: Iterable<Trait>): Record<string, unknown> =>
  // fromEntries makes own data properties, thus a trait named "__proto__" stays a field
  Object.fromEntries([...traits].map((t): [string, unknown] => [t.name, {
    requires: [...t.requires],
    methods: Object.fromEntries(Object.entries(t.methods).flatMap(([name, method]): [string, unknown][] =>
      isExpr(method) ? [[name, method]] : typeof method === "function" ? [[name, atomText(name)]] : [])),
  }]));

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

/** This function reads an expression of a card: a tree of the IR, or its document. Another value gives `undefined`. */
const exprOf = (value: unknown): Expr | undefined => (isExpr(value) ? value : isExprDocument(value) ? asExpr(value) : undefined);

/** The result of the reconstruction of a class from the type graph. */
export type Reconstruction =
  | { readonly ok: true; readonly cls: ComponentClass }
  | { readonly ok: false; readonly reason: string };

/**
 * This function makes a class again from the JSON of its card in the type graph. It keeps each function
 * atom of the original class. It refuses JSON that is not a valid class. Examples are a cell or a method
 * that is not a well-formed expression, an incorrect type and incorrect bindings. The reason of the refusal
 * tells the person what is wrong.
 *
 * An expression can also be a document (`ExprDocument`). The class gets the tree of the IR of each document.
 */
export const reconstructClass = (json: unknown, original: ComponentClass | undefined): Reconstruction => {
  if (!isRecord(json) || typeof json["name"] !== "string") return { ok: false, reason: "The class has no name." };
  const name = json["name"];
  const ext = json["extends"];
  if (ext !== undefined && typeof ext !== "string") return { ok: false, reason: `The extends of ${name} is not a class name.` };

  const cells: [string, CellDef][] = [];
  const cellsJson = json["cells"] ?? {};
  if (!isRecord(cellsJson)) return { ok: false, reason: `The cells of ${name} are not an object.` };
  for (const [cellName, def] of Object.entries(cellsJson)) {
    const expr = isRecord(def) ? exprOf(def["expr"]) : undefined;
    if (!isRecord(def) || expr === undefined) {
      return { ok: false, reason: `The cell ${cellName} of ${name} has no valid expression.` };
    }
    const type = def["type"];
    if (type !== undefined && typeof type !== "string") return { ok: false, reason: `The type of the cell ${cellName} is not a class name.` };
    const bindingsJson = def["bindings"];
    // fromEntries makes own data properties, thus a binding named "__proto__" stays a binding
    const bindings = isRecord(bindingsJson)
      ? Object.fromEntries(Object.entries(bindingsJson).map(([k, v]) => [k, exprOf(v)]))
      : undefined;
    if (bindingsJson !== undefined && (bindings === undefined || Object.values(bindings).includes(undefined))) {
      return { ok: false, reason: `The bindings of the cell ${cellName} are not valid expressions.` };
    }
    cells.push([cellName, {
      expr,
      ...(type !== undefined ? { type } : {}),
      ...(bindings !== undefined ? { bindings: bindings as Readonly<Record<string, Expr>> } : {}),
    }]);
  }

  const methods: [string, unknown][] = [];
  const methodsJson = json["methods"] ?? {};
  if (!isRecord(methodsJson)) return { ok: false, reason: `The methods of ${name} are not an object.` };
  for (const [methodName, value] of Object.entries(methodsJson)) {
    if (value === atomText(methodName)) {
      const atom = original?.methods !== undefined && hasOwn(original.methods, methodName) ? original.methods[methodName] : undefined;
      if (typeof atom === "function") methods.push([methodName, atom]);
    } else {
      const expr = exprOf(value);
      if (expr === undefined) return { ok: false, reason: `The method ${methodName} of ${name} is not a valid expression.` };
      methods.push([methodName, expr]);
    }
  }

  return {
    ok: true,
    cls: {
      name,
      // fromEntries makes own data properties, thus a cell or a method named "__proto__" is not lost
      cells: Object.fromEntries(cells),
      ...(ext !== undefined && ext !== "" ? { extends: ext } : {}),
      ...(methods.length > 0 ? { methods: Object.fromEntries(methods) } : {}),
    },
  };
};
