import type { CloudParams, HeightfieldParams, MotifKind, MotifParams } from '@shared/contracts/index.js'
import { MOTIF_KINDS } from '@shared/contracts/index.js'
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
  /** Radians; the upright kinds stay at 0, ground cover leans. */
  lean: number
  /**
   * How many parts a multi-part motif has, 2..5 — canopy lobes on a tree or a bush,
   * blades in a reed cluster, extra vertices on a rock.
   *
   * Drawn for every motif, including the ones that ignore it. A conditional PRNG call
   * is a determinism footgun: it makes the stream's shape depend on a parameter, so
   * adding or reordering a branch silently reshuffles every placement after it. One
   * unconditional draw costs nothing and keeps the stream a fixed shape.
   *
   * It lives here rather than in `bakeMotifs` because that is a renderer and has no
   * PRNG: `Math.random()` is banned repo-wide, and the same seed must always produce
   * the same world. Generation makes numbers, baking draws them.
   */
  lobes: number
}

/** A foreground strip: which shape this world drew, and where each one goes. */
export interface MotifField {
  motif: MotifKind
  placements: MotifPlacement[]
}

/**
 * Motifs per tile at `densityScale` 1, per kind.
 *
 * Not one number, because the shapes are not one size. Grass is a blade a few pixels
 * wide and 26 of them read as a verge; a tree is a canopy a fifth of the strip across
 * and 26 of those is a wall with no gaps for the chart to show through. The counts fall
 * roughly as the shapes get wider.
 */
const BASE_DENSITY: Record<MotifKind, number> = {
  grass: 26,
  leaves: 22,
  reeds: 18,
  rocks: 16,
  bushes: 14,
  trees: 12,
  conifer: 12,
}

/**
 * Motifs that would look broken if they leaned.
 *
 * A tree or a conifer at a tilt has fallen over, and a bush or a rock has no stem for a
 * lean to mean anything about. Only the bladed kinds gain from it.
 */
const UPRIGHT: ReadonlySet<MotifKind> = new Set<MotifKind>(['trees', 'conifer', 'bushes', 'rocks'])

/**
 * Foreground occlusion motifs — the layer that passes *in front* of the character, and
 * the strongest depth cue in the stack.
 *
 * **The motif is chosen here, from the seed, not named by the theme.** One kind per
 * world: a strip mixing trees with grass and rocks reads as clutter, and it would also
 * make every mood look the same in this layer, which is the opposite of why themes
 * exist. Reseeding — the "New world" button — is what changes it.
 *
 * The pick comes off its own derived stream rather than the placement stream, so adding
 * a motif to `MOTIF_KINDS` changes *which* shape a given seed draws without also
 * reshuffling where the shapes go.
 */
export function generateMotifs(params: MotifParams, seed: number): MotifField {
  const motif = createPrng(deriveSeed(seed, 'motifs:kind')).pick(MOTIF_KINDS)
  const prng = createPrng(deriveSeed(seed, `motifs:${motif}`))
  const scale = Number.isFinite(params.densityScale) ? Math.max(0, params.densityScale) : 1
  // Clamped at twice the motif's own default: this layer crosses the character, and a
  // mood that asked for ten times the trees would hide the poles being traded.
  const count = Math.max(0, Math.round(BASE_DENSITY[motif] * Math.min(scale, 2)))
  const upright = UPRIGHT.has(motif)

  const placements = Array.from({ length: count }, () => ({
    x: prng.next(),
    /**
     * A fraction of the strip height, and **never above 1**.
     *
     * The ceiling is a hard constraint, not a taste choice: a motif is drawn upward
     * from the strip's bottom edge, so anything over 1 is clipped by the texture. That
     * used to be 1.35 and it cut the top off a third of every layer — barely visible on
     * a grass blade, and obvious on a tree, which comes out with a flat-topped canopy.
     *
     * The floor is low so the range reads as a range. A layer whose motifs all sit
     * within 0.7–1.0 looks like one repeated object; from 0.3 it looks like a scatter
     * of near and far ones, which is the depth cue this layer exists for.
     */
    scale: prng.range(0.3, 1),
    lean: upright ? 0 : prng.range(-0.32, 0.32),
    // Two reads as a pair, five as a full crown; below two a canopy is a lollipop and
    // above five the parts stop being individually visible at this strip height.
    lobes: prng.int(2, 5),
  }))

  return { motif, placements }
}
