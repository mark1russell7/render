import { createElement } from "react";
import type { ReactNode } from "react";
import type { ComponentClass } from "@render/biblo";
import { extendClass } from "@render/biblo";
import type { RenderFn } from "@render/splay";
import {
  splayKit, defaultClassFor,
  Top, Text, Num, Bool, KeyValuePair, VStack, HStack, Grid, HtmlElement,
} from "@render/splay";

/**
 * React render methods — layered onto standard classes via extendClass.
 * The base classes define cells + hydrate + splash/flow/deref.
 * We extend each with a React render method.
 */
export const reactClasses: readonly ComponentClass[] = [
  Top,

  extendClass(Text, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => (
      <span className="rv-text">{String(ctx.cells["value"] ?? "")}</span>
    )) as RenderFn<ReactNode>,
  }}),

  extendClass(Num, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => (
      <span className="rv-num">{String(ctx.cells["value"] ?? 0)}</span>
    )) as RenderFn<ReactNode>,
  }}),

  extendClass(Bool, { methods: {
    render: ((ctx: Parameters<RenderFn<ReactNode>>[0]) => (
      <span className="rv-bool">{ctx.cells["value"] ? "true" : "false"}</span>
    )) as RenderFn<ReactNode>,
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
      <div className="rv-vstack">
        {ctx.children.map((id) => (
          <div key={id} className="rv-vstack-item">
            {ctx.renderChild(id)}
          </div>
        ))}
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
          className="rv-grid"
          style={{ gridTemplateColumns: `repeat(${String(cols)}, auto)` }}
        >
          {ctx.children.map((id) => (
            <div key={id} className="rv-grid-item">
              {ctx.renderChild(id)}
            </div>
          ))}
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
