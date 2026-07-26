import type { FbmParams } from '@shared/contracts/index.js'

/**
 * Value noise and fBm.
 *
 * Pure numbers in, pure numbers out — no PixiJS anywhere in `generation/`, which
 * is what makes the whole pipeline snapshot-testable. A regression in the noise
 * then shows up as a failing test rather than as "the mountains look a bit off
 * now", which is otherwise very easy to miss.
 */

/** Deterministic integer hash → [0, 1). Stateless, so sampling order can't drift. */
function hash2(x: number, y: number, seed: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2246822519
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smoothstep, so the lattice doesn't show as visible creases. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

export type Noise2D = (x: number, y: number) => number

export function createValueNoise2D(seed: number): Noise2D {
  return (x, y) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = smooth(x - x0)
    const fy = smooth(y - y0)

    const n00 = hash2(x0, y0, seed)
    const n10 = hash2(x0 + 1, y0, seed)
    const n01 = hash2(x0, y0 + 1, seed)
    const n11 = hash2(x0 + 1, y0 + 1, seed)

    const top = n00 + (n10 - n00) * fx
    const bottom = n01 + (n11 - n01) * fx
    return top + (bottom - top) * fy
  }
}

/** Fractional Brownian motion, normalized to roughly 0..1. */
export function fbm(noise: Noise2D, x: number, y: number, params: FbmParams): number {
  const { octaves, lacunarity = 2, gain = 0.5, ridgeSharpness = 0 } = params

  let amplitude = 1
  let frequency = 1
  let sum = 0
  let total = 0

  for (let i = 0; i < Math.max(1, octaves); i++) {
    let value = noise(x * frequency, y * frequency)
    if (ridgeSharpness > 0) {
      // Fold about the midpoint and invert: peaks become creases.
      const ridged = 1 - Math.abs(value * 2 - 1)
      value = value + (ridged - value) * ridgeSharpness
    }
    sum += value * amplitude
    total += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }

  return total === 0 ? 0 : sum / total
}
