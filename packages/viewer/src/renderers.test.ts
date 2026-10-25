import { describe, it, expect } from "vitest";
import { createElement } from "react";
import type { DragEvent, ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { app, lit, record, ref } from "@mark1russell7/render-dsl";
import { CLASS_DRAG_TYPE, isClassDrag, takeDraggedClass, viewerOps } from "./renderers.tsx";

type Props = {
  readonly className?: string;
  readonly draggable?: boolean;
  readonly parse?: (draft: string) => { readonly value: unknown } | null;
  readonly onDragStart?: (e: unknown) => void;
};

const op = (name: string): ((...args: readonly unknown[]) => unknown) => {
  const f = viewerOps[name];
  if (!f) throw new Error(`no op ${name}`);
  return f;
};

const element = (v: unknown): ReactElement<Props> => v as ReactElement<Props>;
const noop = (): void => undefined;

/** This helper makes a drag event with the given drag data. */
const dragEvent = (types: readonly string[], data: Readonly<Record<string, string>> = {}): DragEvent =>
  ({ dataTransfer: { types, getData: (t: string) => data[t] ?? "", setData: noop } }) as unknown as DragEvent;

describe("the drag of a class", () => {
  it("R-50: a drop finds the class of a drag of this page without the custom type of the drag data (WebKit)", () => {
    // WebKit keeps only the standard types, thus the drag data has no class name
    element(op("classChip")("Grid", [])).props.onDragStart?.(dragEvent([]));
    expect(isClassDrag(dragEvent([]))).toBe(true);
    expect(takeDraggedClass(dragEvent([]))).toBe("Grid");
    // The drop ends the drag of this page
    expect(isClassDrag(dragEvent([]))).toBe(false);
    expect(takeDraggedClass(dragEvent([]))).toBe("");
  });

  it("a drag from another page gives its class with the custom type", () => {
    const e = dragEvent([CLASS_DRAG_TYPE], { [CLASS_DRAG_TYPE]: "Text" });
    expect(isClassDrag(e)).toBe(true);
    expect(takeDraggedClass(e)).toBe("Text");
  });
});

describe("the view atoms", () => {
  it("R-27: a text equal to a class name is an editable text, not a drag chip", () => {
    const text = element(op("textView")("Grid", noop));
    expect(text.props.draggable).toBeUndefined();
    expect(typeof text.type).toBe("function");
    expect(text.props.className).toBe("rv-text");
    const chip = element(op("classChip")("Grid"));
    expect(chip.props.draggable).toBe(true);
    expect(element(op("classChip")("Top")).props.draggable).toBeUndefined();
  });

  it("R-28: a number edit refuses an empty draft and a draft that is not a number", () => {
    const parse = element(op("numView")(5, noop)).props.parse!;
    expect(parse("")).toBeNull();
    expect(parse("  ")).toBeNull();
    expect(parse("abc")).toBeNull();
    expect(parse("Infinity")).toBeNull();
    expect(parse("7.5")).toEqual({ value: 7.5 });
  });

  it("a reference edit refuses an empty segment", () => {
    const parse = element(op("exprRefView")(ref("self", "a"), noop)).props.parse!;
    expect(parse("self..a")).toBeNull();
    expect(parse("self.b")).toEqual({ value: ref("self", "b") });
    expect(element(op("exprRefView")(ref("self", "a"), noop)).props).toMatchObject({ draft: "self.a" });
  });

  it("a reference edit keeps the root of the reference: a parameter of a fn stays a parameter", () => {
    const param = { type: "ref", value: ["names", "x", "y"] };
    const view = element(op("exprRefView")(param, noop));
    expect(view.props).toMatchObject({ draft: "x.y" });
    expect(view.props.parse!("x.z")).toEqual({ value: { type: "ref", value: ["names", "x", "z"] } });
  });

  it("an edit of the op name keeps the arguments, and the document stays an op application", () => {
    const view = op("exprAppView")(app("+", ref("a"), lit(1)), [], () => null, noop, undefined) as ReactElement<{
      readonly children: readonly ReactElement<Props>[];
    }>;
    const parse = view.props.children[0]!.props.parse!;
    expect(parse("max")).toEqual({ value: { type: ["ops", "max"], value: [ref("a"), 1] } });
    // A name such as if keeps one argument for each child, thus the form does not become the construct if
    expect(parse("if")).toEqual({ value: { type: ["ops", "if"], value: [ref("a"), 1] } });
    expect(parse(" ")).toBeNull();
  });

  it("a construct shows its kind, its data and each part with its key, and a term of a list has no key", () => {
    const html = (doc: unknown, children: readonly string[]): string =>
      renderToStaticMarkup(createElement("div", null, op("exprFormView")(doc, children, (id: string): ReactNode => `[${id}]`) as ReactNode));
    const fn = html(app("fn", lit(["x"]), app("+", ref("x"), lit(1))), ["b"]);
    expect(fn).toContain(">fn(<");
    expect(fn).toContain(">params:<");
    expect(fn).toContain("[&quot;x&quot;]");
    expect(fn).toContain(">body:<");
    expect(fn).toContain("[b]");
    const choice = html(app("if", ref("c"), lit(1), lit(2)), ["t", "y", "n"]);
    expect(choice.match(/rv-expr-key/g)).toHaveLength(3);
    expect(choice).toMatch(/test:.*\[t\].*then:.*\[y\].*else:.*\[n\]/);
    expect(html(app("and", ref("a"), ref("b")), ["p", "q"])).not.toContain("rv-expr-key");
    expect(html(record({ area: ref("w") }), ["a"])).toContain(">area:<");
    // Without one child for each part, for example a new instance, the construct shows its formula
    expect(html(app("if", ref("c"), lit(1)), [])).toContain("if(c, 1)");
  });

  it("a literal edit reads JSON, and keeps other text as a string", () => {
    const parse = element(op("exprLitView")(lit(1), noop)).props.parse!;
    expect(parse("[1, 2]")).toEqual({ value: lit([1, 2]) });
    expect(parse("hello")).toEqual({ value: lit("hello") });
  });

  it("without setCell, each atom is read-only", () => {
    expect(element(op("textView")("x", undefined)).type).toBe("span");
    expect(element(op("numView")(1, undefined)).type).toBe("span");
    expect(element(op("exprLitView")(lit(1), undefined)).type).toBe("span");
  });
});

describe("regressions of the independent review (docs/REVIEW.md)", () => {
  type EditProps = Props & { readonly draft?: string; readonly display?: string };
  const literal = (value: unknown): ReactElement<EditProps> => op("exprLitView")(lit(value), noop) as ReactElement<EditProps>;

  it("R-38: the text of each special literal reads back as the same literal", () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, "text", 3, [1, 2]]) {
      const el = literal(value);
      expect(el.props.parse!(el.props.draft!)).toEqual({ value: lit(value) });
    }
  });
});

describe("R-60: the atom element makes only safe HTML (the audit of 2026-10-24)", () => {
  type ElementProps = Record<string, unknown> | null;
  const make = (tag: unknown, props: unknown, ...children: readonly unknown[]): ReactElement<ElementProps> =>
    op("element")(tag, props, ...children) as ReactElement<ElementProps>;
  const html = (tag: unknown, props: unknown, ...children: readonly unknown[]): string =>
    renderToStaticMarkup(make(tag, props, ...children));

  it("R-60: a tag that is not on the list becomes a span, and the tag of the list stays", () => {
    for (const tag of ["script", "SCRIPT", "iframe", "object", "embed", "link", "meta", "base", "style", "form", "svg", "math", "my-widget", 3]) {
      expect(make(tag, null).type).toBe("span");
    }
    expect(make("div", null).type).toBe("div");
    expect(make("A", null).type).toBe("a");
    expect(make("img", null).type).toBe("img");
  });

  it("R-60: the atom removes event handlers, dangerouslySetInnerHTML, srcDoc and each prop that is not on the list", () => {
    const props = make("div", {
      dangerouslySetInnerHTML: { __html: "<img src=x onerror=alert(1)>" },
      srcDoc: "<script>alert(1)</script>",
      onClick: () => undefined,
      onMouseOver: "alert(1)",
      onerror: "alert(1)",
      ref: "r",
      id: "app",
      children: "replaced",
      className: "card",
      title: "a title",
      tabIndex: 0,
      hidden: false,
      "aria-label": "label",
      "data-kind": "note",
      "data-Bad": "x",
    }).props;
    expect(props).toEqual({ className: "card", title: "a title", tabIndex: 0, hidden: false, "aria-label": "label", "data-kind": "note" });
    const markup = html("div", { dangerouslySetInnerHTML: { __html: "<img src=x onerror=alert(1)>" } }, "text");
    expect(markup).toBe("<div>text</div>");
  });

  it("R-60: a URL prop keeps a relative URL and the schemes http, https and mailto, and loses each other scheme", () => {
    const href = (url: string): unknown => make("a", { href: url }).props?.["href"];
    for (const url of ["https://example.com/a", "http://example.com", "mailto:a@example.com", "/docs/", "page.html#top", "?q=1", ""]) {
      expect(href(url)).toBe(url);
    }
    for (const url of ["javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)", "java\nscript:alert(1)", "java\tscript:alert(1)", "\u0001javascript:alert(1)", "vbscript:x", "data:text/html,<script>alert(1)</script>"]) {
      expect(href(url)).toBeUndefined();
    }
    expect(make("img", { src: "javascript:alert(1)", alt: "a" }).props).toEqual({ alt: "a" });
    expect(make("img", { src: "https://example.com/a.png" }).props).toEqual({ src: "https://example.com/a.png" });
  });

  it("R-60: a prop value must be a text, a number or a boolean, and style must be a record of texts and numbers", () => {
    expect(make("div", { title: { toString: "x" }, className: ["a"], style: { color: "red", width: 10 } }).props).toEqual({ style: { color: "red", width: 10 } });
    expect(make("div", { style: { backgroundImage: { url: "x" } } }).props).toEqual({});
    expect(make("div", { style: "color: red" }).props).toEqual({});
  });

  it("R-60: props that are not a record give no props, and the children stay", () => {
    expect(make("div", null).props).toEqual({});
    expect(make("div", "text").props).toEqual({});
    expect(html("p", null, "a", ["b", "c"])).toBe("<p>abc</p>");
  });
});
