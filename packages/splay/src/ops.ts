import type { Ops } from "@render/dsl";

/**
 * Standard DSL ops for the splay system.
 * These are the functions available inside cell expressions.
 */
export const standardOps: Ops = {
  "+": (a: unknown, b: unknown) => (a as number) + (b as number),
  "-": (a: unknown, b: unknown) => (a as number) - (b as number),
  "*": (a: unknown, b: unknown) => (a as number) * (b as number),
  "/": (a: unknown, b: unknown) => (a as number) / (b as number),
  max: (a: unknown, b: unknown) => Math.max(a as number, b as number),
  min: (a: unknown, b: unknown) => Math.min(a as number, b as number),
  toString: (a: unknown) => String(a),

  // Text measurement — placeholder implementations.
  // Replace with real measurement for DOM/canvas rendering.
  textWidth: (text: unknown) => String(text).length,
  textHeight: (_text: unknown) => 1,
};
