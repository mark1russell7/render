import { createElement } from "react";
import type { ReactNode } from "react";
import { renderKit } from "@render/splay";

/**
 * React render kit — maps class names to React components.
 * Each render function receives splay context and returns ReactNode.
 */
export const reactKit = renderKit<ReactNode>({
  Text: (ctx) => (
    <span className="rv-text">{String(ctx.cells["value"] ?? "")}</span>
  ),

  Num: (ctx) => (
    <span className="rv-num">{String(ctx.cells["value"] ?? 0)}</span>
  ),

  Bool: (ctx) => (
    <span className="rv-bool">{ctx.cells["value"] ? "true" : "false"}</span>
  ),

  KeyValuePair: (ctx) => {
    // Typed children: keyView and valueView are the first two children
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
  },

  VStack: (ctx) => (
    <div className="rv-vstack">
      {ctx.children.map((id) => (
        <div key={id} className="rv-vstack-item">
          {ctx.renderChild(id)}
        </div>
      ))}
    </div>
  ),

  HStack: (ctx) => (
    <div className="rv-hstack">
      {ctx.children.map((id) => (
        <div key={id} className="rv-hstack-item">
          {ctx.renderChild(id)}
        </div>
      ))}
    </div>
  ),

  Grid: (ctx) => {
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
  },

  HtmlElement: (ctx) => {
    const tag = typeof ctx.cells["tag"] === "string" ? ctx.cells["tag"] : "div";
    return createElement(
      tag,
      { className: "rv-html" },
      ...ctx.children.map((id) => ctx.renderChild(id)),
    );
  },
}, /* fallback */ (ctx) => (
  <div className="rv-unknown">
    <em>{ctx.classRef}</em>: {JSON.stringify(ctx.cells)}
  </div>
));
