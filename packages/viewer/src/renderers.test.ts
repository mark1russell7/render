import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { viewerOps } from "./renderers.tsx";

type Props = {
  readonly className?: string;
  readonly draggable?: boolean;
  readonly parse?: (draft: string) => { readonly value: unknown } | null;
};

const op = (name: string): ((...args: readonly unknown[]) => unknown) => {
  const f = viewerOps[name];
  if (!f) throw new Error(`no op ${name}`);
  return f;
};

const element = (v: unknown): ReactElement<Props> => v as ReactElement<Props>;
const noop = (): void => undefined;

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
    const parse = element(op("exprRefView")({ tag: "ref", path: ["self", "a"] }, noop)).props.parse!;
    expect(parse("self..a")).toBeNull();
    expect(parse("self.b")).toEqual({ value: { tag: "ref", path: ["self", "b"] } });
  });

  it("a literal edit reads JSON, and keeps other text as a string", () => {
    const parse = element(op("exprLitView")({ tag: "lit", value: 1 }, noop)).props.parse!;
    expect(parse("[1, 2]")).toEqual({ value: { tag: "lit", value: [1, 2] } });
    expect(parse("hello")).toEqual({ value: { tag: "lit", value: "hello" } });
  });

  it("without setCell, each atom is read-only", () => {
    expect(element(op("textView")("x", undefined)).type).toBe("span");
    expect(element(op("numView")(1, undefined)).type).toBe("span");
    expect(element(op("exprLitView")({ tag: "lit", value: 1 }, undefined)).type).toBe("span");
  });
});
