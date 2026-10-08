/**
 * The class sync demo. One class `Badge` has three live instances. An edit of the class reaches each instance
 * that still follows the class (`updateClass`). An edit of an instance gives that instance its own value, and
 * a later edit of the class does not change it.
 */
import { useState, type ReactElement } from "react";
import { biblo, componentClass, instantiate, registerClass, updateClass } from "@render/biblo";
import type { Biblo, ComponentClass, Instance } from "@render/biblo";
import { app, lit, ref } from "@render/dsl";
import { nodeStore, readValue, setValue } from "@render/node";
import type { NodeStore } from "@render/node";
import { standardOps } from "@render/splay";
import { formatValue } from "../lib/format.ts";

const badge = (label: string): ComponentClass =>
  componentClass("Badge", {
    label: { expr: lit(label) },
    count: { expr: lit(1) },
    text: { expr: app("concat", ref("self", "label"), lit(" × "), ref("self", "count")) },
  });

type Model = { readonly b: Biblo; readonly store: NodeStore; readonly instances: readonly Instance[] };

const makeModel = (): Model => {
  const b = biblo();
  const store = nodeStore({ ops: standardOps });
  registerClass(b, badge("star"));
  const instances = ["A", "B", "C"].map(() => instantiate(b, store, "Badge"));
  return { b, store, instances };
};

const cellOf = (m: Model, inst: Instance, name: string): string => m.store.nodes.get(inst.id)!.slots.get(name)!;
const show = (m: Model, inst: Instance, name: string): string => formatValue(readValue(m.store, cellOf(m, inst, name)));

/** The demo. */
export default function ClassSync(props: { readonly title?: string }): ReactElement {
  const title = props.title ?? "A class and three instances";
  const [model, setModel] = useState(makeModel);
  const [classLabel, setClassLabel] = useState("star");
  const [, setTick] = useState(0);
  const rerender = (): void => { setTick((t) => t + 1); };

  const editClass = (label: string): void => {
    setClassLabel(label);
    updateClass(model.b, model.store, badge(label));
    rerender();
  };

  const editInstance = (inst: Instance, label: string): void => {
    setValue(model.store, cellOf(model, inst, "label"), label);
    rerender();
  };

  const reset = (): void => {
    setModel(makeModel());
    setClassLabel("star");
  };

  return (
    <section className="rd-frame not-content" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <button type="button" className="rd-button" onClick={reset}>Reset</button>
      </header>
      <div className="rd-body rd-stack">
        <label className="rd-row">
          <span className="rd-label">class Badge, cell label</span>
          <input className="rd-input" value={classLabel} aria-label="the label of the class" onChange={(e) => { editClass(e.target.value); }} />
        </label>
        <table className="rd-table">
          <thead>
            <tr><th scope="col">instance</th><th scope="col">its own label</th><th scope="col">text = concat(label, " × ", count)</th></tr>
          </thead>
          <tbody>
            {model.instances.map((inst, i) => (
              <tr key={inst.id} data-instance={["A", "B", "C"][i]}>
                <td className="rd-mono">{["A", "B", "C"][i]}</td>
                <td>
                  <input
                    className="rd-input"
                    aria-label={`the label of instance ${["A", "B", "C"][i] ?? ""}`}
                    value={JSON.parse(show(model, inst, "label")) as string}
                    onChange={(e) => { editInstance(inst, e.target.value); }}
                  />
                </td>
                <td className="rd-mono" data-cell="text">{show(model, inst, "text")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
