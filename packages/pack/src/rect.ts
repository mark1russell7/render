import { Vector } from "./vector.ts";

/** A rectangle of the packer. `id` identifies the item that it measures. The packer sets `position` and `wasPacked`. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the parameter types the id of the caller
export class Rect<T = unknown> {
  readonly #position = new Vector();
  readonly #size = new Vector();

  /** The identity of the item that the rectangle measures. */
  id?: T;
  /** The packer sets this field to `true` when it places the rectangle. */
  wasPacked = false;
  /** For an outer rectangle: the packer keeps its width. */
  fixedWidth = false;
  /** For an outer rectangle: the packer keeps its width and its height, and it skips a rectangle that does not fit. */
  fixedSize = false;

  /** The top left corner. */
  get position(): Vector { return this.#position; }
  /** The width and the height. */
  get size(): Vector { return this.#size; }

  /** This method gives the right edge. */
  right(): number { return this.#position.x + this.#size.x; }
  /** This method gives the bottom edge. */
  bottom(): number { return this.#position.y + this.#size.y; }

  /** This method moves the left edge to the right by an amount, and the right edge stays. */
  shrinkLeft(amount: number): this {
    this.#position.x += amount;
    this.#size.x -= amount;
    return this;
  }

  /** This method moves the rectangle by an offset. */
  translateBy(offset: Vector): this {
    this.#position.set(this.#position.x + offset.x, this.#position.y + offset.y);
    return this;
  }

  /** This method gives the area of the size. */
  area(): number { return this.#size.area(); }

  /** This function gives the rectangles that the packer placed. */
  static packed<U>(rects: Rect<U>[]): Rect<U>[] {
    return rects.filter((r) => r.wasPacked);
  }

  /** This function gives the rectangles that the packer did not place. */
  static unpacked<U>(rects: Rect<U>[]): Rect<U>[] {
    return rects.filter((r) => !r.wasPacked);
  }

  /** This function marks each rectangle as not placed. */
  static resetPacked<U>(rects: Rect<U>[]): void {
    for (const r of rects) r.wasPacked = false;
  }

  /** This function gives the largest right edge, or 0 for an empty list. */
  static maxRight<U>(rects: Rect<U>[]): number {
    return rects.reduce((acc, r) => Math.max(acc, r.right()), 0);
  }

  /** This function gives the largest bottom edge, or 0 for an empty list. */
  static maxBottom<U>(rects: Rect<U>[]): number {
    return rects.reduce((acc, r) => Math.max(acc, r.bottom()), 0);
  }
}
