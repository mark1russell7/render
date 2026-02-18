import { createElement } from "react";
import type { ReactNode, DragEvent } from "react";
import type { ComponentClass } from "@render/biblo";
import { extendClass } from "@render/biblo";
import type { RenderFn } from "@render/splay";
import {
  splayKit, defaultClassFor,
  Top, Text, Num, Bool, KeyValuePair, VStack, HStack, Grid, HtmlElement,
} from "@render/splay";

/** Known class names — text matching one of these becomes draggable */
const classNames = new Set(["Top", "Text", "Num", "Bool", "KeyValuePair", "VStack", "HStack", "Grid", "HtmlElement"]);

const onDragStart = (e: DragEvent, className: string): void => {
  e.dataTransfer.setData("text/x-classname", className);
  e.dataTransfer.effectAllowed = "copy";
};

const onDragOver = (e: DragEvent): void => {
  if (e.dataTransfer.types.includes("text/x-classname")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
};

const makeOnDrop = (addChild: ((className: string) => void) | undefined) =>
  (e: DragEvent): void => {
    e.preventDefault();
    const className = e.dataTransfer.getData("text/x-classname");
    if (className && addChild) {
      addChild(className);
    }
  };

/**
 * React render methods — layered onto standard classes via extendClass.
 * The base classes define cells + hydrate + splash/flow/deref.
 * We extend each with a React render method.
 */
export const reactClasses: readonly ComponentClass[] = [
  Top,

  extendClass(Text, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => {
      const value = String(ctx.cells["value"] ?? "");
      const isDraggable = classNames.has(value);
      // Class names are always draggable, never editable — they're type references
      if (isDraggable) {
        return (
          <span
            className="rv-text rv-draggable"
            draggable
            onDragStart={(e) => { onDragStart(e, value); }}
          >
            {value}
          </span>
        );
      }
      if (ctx.setCell) {
        return (
          <input
            className="rv-text rv-text-edit"
            type="text"
            value={value}
            onChange={(e) => { ctx.setCell!("value", e.target.value); }}
          />
        );
      }
      return <span className="rv-text">{value}</span>;
    }) as RenderFn<ReactNode>,
  }}),

  extendClass(Num, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => {
      const value = ctx.cells["value"] ?? 0;
      if (!ctx.setCell) {
        return <span className="rv-num">{String(value)}</span>;
      }
      return (
        <input
          className="rv-num rv-num-edit"
          type="number"
          value={Number(value)}
          onChange={(e) => { ctx.setCell!("value", e.target.valueAsNumber); }}
        />
      );
    }) as RenderFn<ReactNode>,
  }}),

  extendClass(Bool, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => {
      const value = Boolean(ctx.cells["value"]);
      if (!ctx.setCell) {
        return <span className="rv-bool">{value ? "true" : "false"}</span>;
      }
      return (
        <label className="rv-bool rv-bool-edit">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => { ctx.setCell!("value", e.target.checked); }}
          />
          <span>{value ? "true" : "false"}</span>
        </label>
      );
    }) as RenderFn<ReactNode>,
  }}),

  extendClass(KeyValuePair, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => {
      const [keyViewId, valueViewId] = ctx.children;
      return (
        <div className="rv-kvp">
          <div className="rv-kvp-key">
            {keyViewId != null ? ctx.renderChild(keyViewId) : null}
          </div>
          <div className="rv-kvp-value">
            {valueViewId != null ? ctx.renderChild(valueViewId) : null}
          </div>
        </div>
      );
    }) as RenderFn<ReactNode>,
  }}),

  extendClass(VStack, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => (
      <div
        className={`rv-vstack${ctx.addChild ? " rv-drop-target" : ""}`}
        onDragOver={ctx.addChild ? onDragOver : undefined}
        onDrop={ctx.addChild ? makeOnDrop(ctx.addChild) : undefined}
      >
        {ctx.children.map((id) => (
          <div key={id} className="rv-vstack-item">
            {ctx.renderChild(id)}
          </div>
        ))}
        {ctx.addChild ? <div className="rv-drop-zone">drop to add</div> : null}
      </div>
    )) as RenderFn<ReactNode>,
  }}),

  extendClass(HStack, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => (
      <div className="rv-hstack">
        {ctx.children.map((id) => (
          <div key={id} className="rv-hstack-item">
            {ctx.renderChild(id)}
          </div>
        ))}
      </div>
    )) as RenderFn<ReactNode>,
  }}),

  extendClass(Grid, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => {
      const cols = typeof ctx.cells["cols"] === "number" ? ctx.cells["cols"] : 2;
      return (
        <div
          className={`rv-grid${ctx.addChild ? " rv-drop-target" : ""}`}
          style={{ gridTemplateColumns: `repeat(${String(cols)}, auto)` }}
          onDragOver={ctx.addChild ? onDragOver : undefined}
          onDrop={ctx.addChild ? makeOnDrop(ctx.addChild) : undefined}
        >
          {ctx.children.map((id) => (
            <div key={id} className="rv-grid-item">
              {ctx.renderChild(id)}
            </div>
          ))}
          {ctx.addChild ? (
            <div className="rv-drop-zone" style={{ gridColumn: `1 / -1` }}>drop to add</div>
          ) : null}
        </div>
      );
    }) as RenderFn<ReactNode>,
  }}),

  extendClass(HtmlElement, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => {
      const tag = typeof ctx.cells["tag"] === "string" ? ctx.cells["tag"] : "div";
      return createElement(
        tag,
        { className: "rv-html" },
        ...ctx.children.map((id) => ctx.renderChild(id)),
      );
    }) as RenderFn<ReactNode>,
  }}),
];

export const reactKit = splayKit<ReactNode>(
  defaultClassFor,
  (ctx) => (
    <div className="rv-unknown">
      <em>{ctx.classRef}</em>: {JSON.stringify(ctx.cells)}
    </div>
  ),
);
