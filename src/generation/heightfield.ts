import type { CloudParams, HeightfieldParams, MotifParams } from '@shared/contracts/index.js'
import { createPrng, deriveSeed } from '@shared/math/index.js'
import { createValueNoise2D, fbm } from './noise.js'

/**
 * One heightfield algorithm serving mountains, hills, and treelines — the same
 * code at different parameters, which is the payoff of themes-as-parameters. A
 * "city skyline" is this generator at high frequency, low amplitude, maximum ridge
 * sharpness, not separate art.
 *
 * **Seamless by construction.** The field is sampled around a *circle* rather than
 * along a line, so the left and right edges match because they're the same point
 * on the circle. That is much more reliable than generating a strip and trying to
 * blend the seam — a blended seam is a bug you notice on the fifth loop.
 */

/**
 * @param samples horizontal resolution of the tile
 * @returns heights in 0..1, where `result[0]` continues smoothly from
 *          `result[samples - 1]`
 */
export function generateHeightfield(
  samples: number,
  params: HeightfieldParams,
  seed: number
): Float64Array {
  const noise = createValueNoise2D(seed)
  const heights = new Float64Array(samples)

  for (let i = 0; i < samples; i++) {
    // Sampling on a circle of radius `frequency` makes the tile loop by
    // construction: i = 0 and i = samples are the same angle.
    const angle = (i / samples) * Math.PI * 2
    const x = Math.cos(angle) * params.frequency
    const y = Math.sin(angle) * params.frequency
    heights[i] = fbm(noise, x, y, params) * params.amplitude
  }

  return heights
}

export interface CloudPuff {
  /** Offsets from the cloud's own origin, in radii. */
  dx: number
  dy: number
  radius: number
}

export interface Cloud {
  /** 0..1 across the tile. */
  x: number
  /** 0..1 down the layer. */
  y: number
  scale: number
  alpha: number
  puffs: CloudPuff[]
}

/**
 * Clouds are unions of a few overlapping circles, placed by the seeded PRNG.
 *
 * `wispy` uses more, flatter, fainter puffs; `puffy` fewer, rounder, denser ones.
 * Style is a theme parameter rather than a branch on theme id.
 */
export function generateClouds(params: CloudParams, seed: number): Cloud[] {
  const prng = createPrng(deriveSeed(seed, 'clouds'))
  const count = Math.max(0, Math.round(params.density))
  const wispy = params.style === 'wispy'

  return Array.from({ length: count }, () => {
    const puffCount = wispy ? prng.int(4, 7) : prng.int(3, 5)
    const puffs: CloudPuff[] = Array.from({ length: puffCount }, (_, index) => ({
      dx: (index - (puffCount - 1) / 2) * (wispy ? 0.9 : 0.62),
      dy: prng.range(-0.18, 0.18) * (wispy ? 0.4 : 1),
      radius: prng.range(0.55, 1) * (wispy ? 0.55 : 1),
    }))

    return {
      x: prng.next(),
      y: prng.range(0.05, 0.72),
      scale: params.scale * prng.range(0.7, 1.3),
      alpha: wispy ? prng.range(0.16, 0.34) : prng.range(0.45, 0.78),
      puffs,
    }
  })
}

export interface MotifPlacement {
  /** 0..1 across the tile. */
  x: number
  scale: number
  /** Radians; railings stay upright, grass leans. */
  lean: number
}

/**
 * Foreground occlusion motifs — the layer that passes *in front* of the
 * character, and the strongest depth cue in the stack.
 *
 * Must stay sparse enough not to obscure poles the player is trading, so density
 * is a theme parameter with a hard reason to stay low rather than a taste knob.
 */
export function generateMotifs(params: MotifParams, seed: number): MotifPlacement[] {
  const prng = createPrng(deriveSeed(seed, `motifs:${params.motif}`))
  const count = Math.max(0, Math.round(params.density))
  const upright = params.motif === 'railing'

  return Array.from({ length: count }, () => ({
    x: prng.next(),
    scale: prng.range(0.7, 1.35),
    lean: upright ? 0 : prng.range(-0.32, 0.32),
  }))
}
