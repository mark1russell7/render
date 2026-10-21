/**
 * The machine of render: the formula kit of coeval with the profile of render. The kernel holds the evaluator, the
 * scope rules, the static kit and the errors (decision D13 of coeval). render gives only its profile and its ops.
 */
import type { Envelope, FormulaProfile, Issue, LazyOp, Machine, Namespace, Plan, World } from "@mark1russell7/coeval";
import { check, fail, formulaEvaluators, formulaKinds, isEnvelope, jsTruthy, ok, planner } from "@mark1russell7/coeval";

/**
 * An op: a function of the values of its arguments. The method form lets an op declare the types of its
 * parameters, for example `(x: number) => x * 2`. The kernel gives each argument as it is, without a check.
 */
type Op = { op(...args: readonly unknown[]): unknown }["op"];

/** The op registry: a map from op names to functions. The kernel reads only the own properties. */
export type Ops = Readonly<Record<string, Op>>;

/**
 * The value of a host thing that has no value of its own, for example the store of nodes at the root `world`.
 * A reference that ends on it gives no value: the profile calls it missing.
 */
export const NO_VALUE: unique symbol = Symbol("render.noValue");

const kit = formulaKinds();

/**
 * The world of render: the kinds of the formula kit. The keys `and` and `or` of the namespace `ops` are aliases of
 * the constructs `and` and `or`, thus a document of version 0.1.1 (`["ops", "and"]`) evaluates as the construct.
 */
export const renderWorld: World = {
  kinds: {
    ...kit,
    ops: {
      kinds: { and: { type: "ref", value: ["world", "and"] }, or: { type: "ref", value: ["world", "or"] } },
      ...((kit["ops"] as Namespace).fallback === undefined ? {} : { fallback: (kit["ops"] as Namespace).fallback }),
    },
  },
  defaults: {},
};

/** This function makes an own data property, thus a field `__proto__` stays a field. */
const setOwn = (target: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
};

/**
 * The forms of version 0.1.1 and the forms that a construct cannot hold. The kernel gives each one thunks of its
 * arguments, thus it evaluates only the arguments that it needs.
 *
 * - `if(test, then, else?)`: the form of version 0.1.1. An `if` with other arguments is a bad form.
 * - `record(name1, value1, ...)`: a record with computed or repeated names. A field with no value is not in the record.
 * - `fn`: a `fn` that the construct cannot hold, for example with computed parameters, is a bad form.
 */
const LAZY: Readonly<Record<string, LazyOp>> = {
  if: (args) => {
    const [test, then, other] = args;
    if (test === undefined || then === undefined || args.length > 3) return fail("#VALUE!", "if(test, then, else?)");
    const chosen = test();
    if (!chosen.ok) return chosen;
    if (jsTruthy(chosen.value)) return then();
    return other === undefined ? ok(undefined) : other();
  },
  record: (args) => {
    if (args.length % 2 !== 0) return fail("#VALUE!", "record(name1, value1, name2, value2, ...)");
    const out: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i += 2) {
      const name = (args[i] as () => ReturnType<LazyOp>)();
      if (!name.ok || (typeof name.value !== "string" && typeof name.value !== "number")) return fail("#VALUE!", "A field name of record is not a text.");
      const value = (args[i + 1] as () => ReturnType<LazyOp>)();
      if (value.ok) setOwn(out, String(name.value), value.value);
    }
    return ok(out);
  },
  fn: () => fail("#VALUE!", "fn([...params], body)"),
};

/**
 * This function gives the profile of render for an op registry. These are the rules of render:
 *
 * - The truth of a value is the truth of JavaScript, and `and` and `or` give the value that decided.
 * - An `if` without `else` gives `undefined`.
 * - A `record` leaves out a field whose value fails.
 * - A reference that ends on `NO_VALUE` gives `#N/A`.
 */
const profileOf = (ops: Ops): FormulaProfile => ({
  ops,
  lazy: LAZY,
  truthy: jsTruthy,
  otherwise: undefined,
  logic: "value",
  omit: () => true,
  missing: (value) => value === NO_VALUE,
});

const machines = new WeakMap<Ops, Machine>();
const planners = new WeakMap<Ops, (doc: unknown) => Plan>();

/**
 * This function gives the machine of render for an op registry. Each registry gets one machine, thus a plan
 * compiles one time for each registry. The values are data (`plain`), and a path starts at `names` or `world`.
 */
export const machineOf = (ops: Ops): Machine => {
  let machine = machines.get(ops);
  if (machine === undefined) {
    machine = { world: renderWorld, evaluators: formulaEvaluators(profileOf(ops)), plain: true, roots: ["names", "world"] };
    machines.set(ops, machine);
  }
  return machine;
};

/**
 * This function gives the planner of an op registry: a function that gives the compiled plan of an expression. A
 * plan compiles one time for each expression object. An expression does not change after it is made.
 */
export const plannerOf = (ops: Ops): ((doc: unknown) => Plan) => {
  let plan = planners.get(ops);
  if (plan === undefined) {
    plan = planner(machineOf(ops));
    planners.set(ops, plan);
  }
  return plan;
};

const STATIC: Ops = {};
const checked = new WeakMap<object, boolean>();

/**
 * This function checks an expression before an evaluation, with the static kit of the kernel. The root must be an
 * envelope. Each issue has a code, the place of its document and a reason. An unknown op is not an issue: the
 * registry of the evaluation decides.
 */
export const checkExpr = (doc: unknown): readonly Issue[] => {
  if (!isEnvelope(doc)) return [{ code: "#PART?", place: [], reason: "The root of an expression is an envelope: { type, value }." }];
  return check(machineOf(STATIC), doc);
};

/**
 * This function tells if a value is a valid expression: an envelope that `checkExpr` accepts. Use it at each
 * boundary where data becomes an expression, for example an edit in the viewer. The result of each object is kept.
 */
export const isExpr = (value: unknown): value is Envelope => {
  if (!isEnvelope(value)) return false;
  let valid = checked.get(value);
  if (valid === undefined) {
    valid = checkExpr(value).length === 0;
    checked.set(value, valid);
  }
  return valid;
};
