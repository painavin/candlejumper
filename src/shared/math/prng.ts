/**
 * The one randomness source in the repo.
 *
 * `Math.random()` is banned everywhere by lint rule, because `theme + seed`
 * must always produce a byte-identical world — that's what makes procedural
 * generation snapshot-testable and personal bests comparable. See
 * docs/procedural-assets.md#determinism--seeded-prng-never-mathrandom.
 */

/** A seeded pseudo-random source. Deterministic for a given seed. */
export interface Prng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform in [min, max). */
  range(min: number, max: number): number
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number
  /** True with the given probability. */
  chance(probability: number): boolean
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T
}

/**
 * mulberry32 — chosen over xorshift128 for being a single 32-bit state word,
 * which makes a generator trivially cheap to fork per layer. Statistical
 * quality is far beyond what decorative terrain needs.
 */
export function createPrng(seed: number): Prng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const range = (min: number, max: number): number => min + next() * (max - min)

  return {
    next,
    range,
    int: (min, max) => Math.floor(range(min, max + 1)),
    chance: (probability) => next() < probability,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick() needs a non-empty array')
      return items[Math.floor(next() * items.length)] as T
    },
  }
}

/**
 * Derive a stable sub-seed from a seed and a label, so each generated layer
 * gets its own stream without one layer's consumption shifting another's
 * output. Without this, adding an octave to the mountains would change the
 * clouds.
 */
export function deriveSeed(seed: number, label: string): number {
  let h = seed >>> 0
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Mint a fresh world seed. The single source of real entropy in the repo —
 * everything downstream of this value is deterministic. Uses Web Crypto, which
 * is available in browsers, Node, and both native shells.
 */
export function mintSeed(): number {
  const buffer = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buffer)
  return (buffer[0] ?? 1) >>> 0
}
