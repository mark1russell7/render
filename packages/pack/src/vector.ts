/** A mutable two-dimensional vector. */
export class Vector {
  #x: number;
  #y: number;

  constructor(x = 0, y = 0) {
    this.#x = x;
    this.#y = y;
  }

  /** The first component: a width or a left position. */
  get x(): number { return this.#x; }
  set x(v: number) { this.#x = v; }
  /** The second component: a height or a top position. */
  get y(): number { return this.#y; }
  set y(v: number) { this.#y = v; }

  /** This method sets both components. */
  set(x: number, y: number): void {
    this.#x = x;
    this.#y = y;
  }

  /** This method copies the components of another vector. */
  setTo(v: Vector): void {
    this.#x = v.x;
    this.#y = v.y;
  }

  /** This method gives a new vector: the sum of this vector and another. */
  add(other: Vector): Vector {
    return new Vector(this.#x + other.x, this.#y + other.y);
  }

  /** This method gives the product of the components: the area of a size. */
  area(): number {
    return this.#x * this.#y;
  }

  /** This method gives a new vector with the same components. */
  clone(): Vector {
    return new Vector(this.#x, this.#y);
  }

  /** This method gives a new vector with each component between the components of `min` and `max`. */
  clamp(min: Vector, max: Vector): Vector {
    return new Vector(
      Math.max(min.x, Math.min(max.x, this.#x)),
      Math.max(min.y, Math.min(max.y, this.#y)),
    );
  }

  /** This function gives a vector with the same value in both components. */
  static of(scalar: number): Vector {
    return new Vector(scalar, scalar);
  }

  /** This function gives the smallest value of each component, or a zero vector for an empty list. */
  static min(vectors: Vector[]): Vector {
    if (!vectors.length) return new Vector();
    return new Vector(
      Math.min(...vectors.map((v) => v.x)),
      Math.min(...vectors.map((v) => v.y)),
    );
  }

  /** This function gives the largest value of each component, or a zero vector for an empty list. */
  static max(vectors: Vector[]): Vector {
    if (!vectors.length) return new Vector();
    return new Vector(
      Math.max(...vectors.map((v) => v.x)),
      Math.max(...vectors.map((v) => v.y)),
    );
  }

  /** This getter gives a new infinite vector each time. A shared value is not safe, because a vector is mutable. */
  static get Infinity(): Vector {
    return new Vector(Infinity, Infinity);
  }
}
