import { Vector } from "./vector.js";

export class Rect<T = unknown> {
  readonly #position = new Vector();
  readonly #size = new Vector();

  id?: T;
  wasPacked = false;
  fixedWidth = false;
  fixedSize = false;

  get position(): Vector { return this.#position; }
  get size(): Vector { return this.#size; }

  right(): number { return this.#position.x + this.#size.x; }
  bottom(): number { return this.#position.y + this.#size.y; }

  shrinkLeft(amount: number): this {
    this.#position.x += amount;
    this.#size.x -= amount;
    return this;
  }

  translateBy(offset: Vector): this {
    this.#position.set(this.#position.x + offset.x, this.#position.y + offset.y);
    return this;
  }

  area(): number { return this.#size.area(); }

  static packed<U>(rects: Rect<U>[]): Rect<U>[] {
    return rects.filter((r) => r.wasPacked);
  }

  static unpacked<U>(rects: Rect<U>[]): Rect<U>[] {
    return rects.filter((r) => !r.wasPacked);
  }

  static resetPacked<U>(rects: Rect<U>[]): void {
    for (const r of rects) r.wasPacked = false;
  }

  static maxRight<U>(rects: Rect<U>[]): number {
    return rects.reduce((acc, r) => Math.max(acc, r.right()), 0);
  }

  static maxBottom<U>(rects: Rect<U>[]): number {
    return rects.reduce((acc, r) => Math.max(acc, r.bottom()), 0);
  }
}
