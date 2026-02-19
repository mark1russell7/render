export class Vector {
  #x: number;
  #y: number;

  constructor(x = 0, y = 0) {
    this.#x = x;
    this.#y = y;
  }

  get x(): number { return this.#x; }
  set x(v: number) { this.#x = v; }
  get y(): number { return this.#y; }
  set y(v: number) { this.#y = v; }

  set(x: number, y: number): void {
    this.#x = x;
    this.#y = y;
  }

  setTo(v: Vector): void {
    this.#x = v.x;
    this.#y = v.y;
  }

  add(other: Vector): Vector {
    return new Vector(this.#x + other.x, this.#y + other.y);
  }

  area(): number {
    return this.#x * this.#y;
  }

  clone(): Vector {
    return new Vector(this.#x, this.#y);
  }

  clamp(min: Vector, max: Vector): Vector {
    return new Vector(
      Math.max(min.x, Math.min(max.x, this.#x)),
      Math.max(min.y, Math.min(max.y, this.#y)),
    );
  }

  static of(scalar: number): Vector {
    return new Vector(scalar, scalar);
  }

  static min(vectors: Vector[]): Vector {
    if (!vectors.length) return new Vector();
    return new Vector(
      Math.min(...vectors.map((v) => v.x)),
      Math.min(...vectors.map((v) => v.y)),
    );
  }

  static max(vectors: Vector[]): Vector {
    if (!vectors.length) return new Vector();
    return new Vector(
      Math.max(...vectors.map((v) => v.x)),
      Math.max(...vectors.map((v) => v.y)),
    );
  }

  static readonly Infinity: Vector = new Vector(Infinity, Infinity);
}
