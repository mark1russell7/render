import { describe, it, expect } from "vitest";
import type { DragEvent, ReactElement } from "react";
import { lit, ref } from "@mark1russell7/render-dsl";
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
