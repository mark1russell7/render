/**
 * Structural traits with prime fingerprints: a granular polymorphism.
 *
 * Each atomic feature of a class gets a unique prime: a cell (`value`), or a typed cell (`kid:Point`).
 * The fingerprint of a class is the product of the primes of its features. The product does not depend on
 * the order of the features, thus two classes with the same features have the same fingerprint.
 *
 * A trait gives methods to each class that has the features of its list. Then the fingerprint of the trait
 * divides the fingerprint of the class. Among the traits that apply, only the most specific ones count
 * (a trait whose fingerprint divides the fingerprint of another applicable trait is dominated). When two of
 * them give the same method, the method is ambiguous: no trait gives it, and the ambiguity is visible.
 */

/** A trait: methods for each class that has the cells of its list. */
export type Trait = {
  readonly name: string;
  /** The features that a class must have: a cell name (`label`), or a typed cell (`kid:Point`). */
  readonly requires: readonly string[];
  readonly methods: Readonly<Record<string, unknown>>;
};

/** The traits that apply to a class, and the names of the methods that two of them give. */
export type TraitResolution = {
  readonly applied: readonly Trait[];
  readonly ambiguous: readonly string[];
};

/** The table of primes: one unique prime for each atomic feature. */
export type PrimeTable = {
  readonly primes: Map<string, bigint>;
  readonly found: bigint[];
};

/** This function makes an empty table of primes. */
export const primeTable = (): PrimeTable => ({ primes: new Map(), found: [] });

/** This function gives the next prime after the last prime of the table (trial division by the found primes). */
const nextPrime = (t: PrimeTable): bigint => {
  let candidate = t.found.length === 0 ? 2n : t.found[t.found.length - 1]! + 1n;
  for (;;) {
    let prime = true;
    for (const p of t.found) {
      if (p * p > candidate) break;
      if (candidate % p === 0n) {
        prime = false;
        break;
      }
    }
    if (prime) {
      t.found.push(candidate);
      return candidate;
    }
    candidate++;
  }
};

/** This function gives the prime of an atomic feature. A new feature gets the next free prime. */
export const primeIn = (t: PrimeTable, atom: string): bigint => {
  let p = t.primes.get(atom);
  if (p === undefined) {
    p = nextPrime(t);
    t.primes.set(atom, p);
  }
  return p;
};

/** This function gives the product of the primes of a set of features (the fingerprint). */
export const fingerprintOf = (t: PrimeTable, atoms: Iterable<string>): bigint => {
  let product = 1n;
  for (const atom of new Set(atoms)) product *= primeIn(t, atom);
  return product;
};

/** This function gives the features of an item of the list of a trait: `kid:Point` is the cell `kid` with the type `Point`. */
export const requirementAtoms = (requirement: string): string[] => {
  const colon = requirement.indexOf(":");
  return colon < 0 ? [`cell:${requirement}`] : [`cell:${requirement.slice(0, colon)}`, `cell:${requirement}`];
};

/**
 * This function selects the traits for a fingerprint. It keeps each trait whose fingerprint divides the class
 * fingerprint, removes the dominated ones, and finds the methods that two remaining traits give.
 */
export const selectTraits = (
  t: PrimeTable,
  traits: Iterable<Trait>,
  classFingerprint: bigint,
): TraitResolution => {
  const applicable: { trait: Trait; d: bigint }[] = [];
  for (const trait of traits) {
    const d = fingerprintOf(t, trait.requires.flatMap(requirementAtoms));
    if (classFingerprint % d === 0n) applicable.push({ trait, d });
  }
  const maximal = applicable.filter((a) => !applicable.some((b) => b.d !== a.d && b.d % a.d === 0n));
  const owners = new Map<string, number>();
  for (const { trait } of maximal) for (const name of Object.keys(trait.methods)) owners.set(name, (owners.get(name) ?? 0) + 1);
  const ambiguous = [...owners].filter(([, count]) => count > 1).map(([name]) => name).toSorted();
  return { applied: maximal.map((m) => m.trait), ambiguous };
};
