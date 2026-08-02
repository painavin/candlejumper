import { describe, expect, it } from 'vitest'
import { jollyTheme, seriousTheme } from '@content/visualThemes/index.js'
import { MOTIF_KINDS } from '@shared/contracts/index.js'
import type { MotifKind } from '@shared/contracts/index.js'
import { deriveSeed } from '@shared/math/index.js'
import { generateClouds, generateHeightfield, generateMotifs } from './heightfield.js'
import { createValueNoise2D, fbm } from './noise.js'

/**
 * Procedural generation is **snapshot tested for determinism**.
 *
 * `theme + seed` must always produce an identical world — personal-best comparison
 * and a seeded daily ticker both depend on it. Snapshotting the numeric output
 * catches a regression in the noise pipeline as a failing test rather than as "the
 * mountains look a bit different now", which is otherwise very easy to miss.
 */

const round = (values: ArrayLike<number>, digits = 6): number[] =>
  Array.from(values, (value) => Number(value.toFixed(digits)))

describe('value noise', () => {
  it('is deterministic for a seed', () => {
    const a = createValueNoise2D(7)
    const b = createValueNoise2D(7)
    expect(a(1.5, 2.5)).toBe(b(1.5, 2.5))
  })

  it('differs between seeds', () => {
    expect(createValueNoise2D(1)(1.5, 2.5)).not.toBe(createValueNoise2D(2)(1.5, 2.5))
  })

  it('stays within 0..1', () => {
    const noise = createValueNoise2D(3)
    for (let i = 0; i < 500; i++) {
      const value = noise(i * 0.37, i * 0.19)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('is stateless, so sampling order cannot change the result', () => {
    // A stateful generator would make one layer's output depend on how many values
    // another layer had consumed.
    const noise = createValueNoise2D(11)
    const forwards = [noise(0.5, 0.5), noise(1.5, 0.5), noise(2.5, 0.5)]
    const backwards = [noise(2.5, 0.5), noise(1.5, 0.5), noise(0.5, 0.5)].reverse()
    expect(forwards).toEqual(backwards)
  })
})

describe('fbm', () => {
  it('produces sharper extremes as ridgeSharpness rises', () => {
    // The parameter that turns the mountain generator into a city skyline.
    const noise = createValueNoise2D(5)
    const rounded = fbm(noise, 0.3, 0.7, { octaves: 4, ridgeSharpness: 0 })
    const ridged = fbm(noise, 0.3, 0.7, { octaves: 4, ridgeSharpness: 1 })
    expect(ridged).not.toBeCloseTo(rounded, 3)
  })

  it('treats a zero octave count as one rather than dividing by zero', () => {
    expect(Number.isFinite(fbm(createValueNoise2D(1), 0.5, 0.5, { octaves: 0 }))).toBe(true)
  })
})

describe('generateHeightfield', () => {
  it('is seamless by construction', () => {
    // Sampled around a circle, so the last sample continues into the first. A
    // blended seam is a bug you only notice on the fifth loop.
    const heights = generateHeightfield(256, jollyTheme.terrain.mountainsFar, 42)
    const first = heights[0] as number
    const last = heights[heights.length - 1] as number
    const step = Math.abs(first - last)

    // The wrap step must be no larger than a typical interior step.
    let largestInterior = 0
    for (let i = 1; i < heights.length; i++) {
      largestInterior = Math.max(largestInterior, Math.abs((heights[i] as number) - (heights[i - 1] as number)))
    }
    expect(step).toBeLessThanOrEqual(largestInterior)
  })

  it('stays within its amplitude', () => {
    const params = { ...jollyTheme.terrain.mountainsFar, amplitude: 0.4 }
    const heights = generateHeightfield(128, params, 9)
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(0)
      expect(height).toBeLessThanOrEqual(0.4)
    }
  })

  it('gives each layer an independent stream via deriveSeed', () => {
    // Adding an octave to the mountains must not change the trees.
    const seed = 1234
    const far = generateHeightfield(64, jollyTheme.terrain.mountainsFar, deriveSeed(seed, 'mountains:far'))
    const near = generateHeightfield(64, jollyTheme.terrain.mountainsFar, deriveSeed(seed, 'mountains:near'))
    expect(round(far)).not.toEqual(round(near))
  })

  it('snapshots the jolly mountain silhouette', () => {
    const heights = generateHeightfield(16, jollyTheme.terrain.mountainsFar, deriveSeed(42, 'mountains:far'))
    expect(round(heights, 4)).toMatchSnapshot()
  })

  it('snapshots the serious skyline, which is the same generator', () => {
    const heights = generateHeightfield(16, seriousTheme.terrain.mountainsNear, deriveSeed(42, 'mountains:near'))
    expect(round(heights, 4)).toMatchSnapshot()
  })
})

describe('generateClouds', () => {
  it('is deterministic for theme + seed', () => {
    expect(generateClouds(jollyTheme.clouds, 77)).toEqual(generateClouds(jollyTheme.clouds, 77))
  })

  it('respects the density parameter', () => {
    expect(generateClouds({ ...jollyTheme.clouds, density: 3 }, 1)).toHaveLength(3)
    expect(generateClouds({ ...jollyTheme.clouds, density: 0 }, 1)).toHaveLength(0)
  })

  it('makes wispy clouds fainter and flatter than puffy ones', () => {
    // Style is a theme parameter, not a branch on theme id.
    const puffy = generateClouds({ style: 'puffy', density: 6, scale: 0.1 }, 5)
    const wispy = generateClouds({ style: 'wispy', density: 6, scale: 0.1 }, 5)
    const meanAlpha = (clouds: typeof puffy): number =>
      clouds.reduce((sum, cloud) => sum + cloud.alpha, 0) / clouds.length
    expect(meanAlpha(wispy)).toBeLessThan(meanAlpha(puffy))
  })

  it('keeps every cloud inside the tile', () => {
    for (const cloud of generateClouds(jollyTheme.clouds, 3)) {
      expect(cloud.x).toBeGreaterThanOrEqual(0)
      expect(cloud.x).toBeLessThanOrEqual(1)
      expect(cloud.y).toBeGreaterThanOrEqual(0)
      expect(cloud.y).toBeLessThanOrEqual(1)
    }
  })

  it('snapshots the jolly cloud field', () => {
    expect(generateClouds(jollyTheme.clouds, 42)).toMatchSnapshot()
  })
})

describe('generateMotifs', () => {
  /** A seed whose motif pick is the kind wanted, found by scanning. */
  const seedFor = (want: MotifKind): number => {
    for (let seed = 1; seed < 5000; seed++) {
      if (generateMotifs({ densityScale: 1 }, seed).motif === want) return seed
    }
    throw new Error(`no seed produced ${want} — the pick is not reaching every kind`)
  }

  it('picks one motif per world, and can reach every kind', () => {
    /**
     * The point of choosing here rather than in the theme. One kind per strip: a strip
     * mixing trees with grass and rocks reads as clutter, and it would make every mood
     * look alike in this layer.
     *
     * Scanning for reachability also guards the pick itself — an off-by-one in `pick`
     * that never returned the last element would otherwise be invisible.
     */
    const seen = new Set<MotifKind>()
    for (let seed = 1; seed <= 2000; seed++) seen.add(generateMotifs({ densityScale: 1 }, seed).motif)
    expect([...seen].sort()).toEqual([...MOTIF_KINDS].sort())
  })

  it('gives the same world the same motif every time', () => {
    // The determinism requirement: theme + seed must always produce an identical world.
    for (const seed of [7, 1234, 99999]) {
      const first = generateMotifs({ densityScale: 1 }, seed)
      const second = generateMotifs({ densityScale: 1 }, seed)
      expect(second.motif).toBe(first.motif)
      expect(second.placements).toEqual(first.placements)
    }
  })

  it('keeps the upright kinds upright, and lets the bladed ones lean', () => {
    // A tree or conifer at a tilt has fallen over, and a bush or rock has no stem for a
    // lean to mean anything about. Only the bladed kinds gain from it.
    for (const motif of ['trees', 'conifer', 'bushes', 'rocks'] as const) {
      const field = generateMotifs({ densityScale: 1 }, seedFor(motif))
      expect(field.placements.every((placement) => placement.lean === 0), motif).toBe(true)
    }
    for (const motif of ['grass', 'leaves', 'reeds'] as const) {
      const field = generateMotifs({ densityScale: 1 }, seedFor(motif))
      expect(field.placements.some((placement) => placement.lean !== 0), motif).toBe(true)
    }
  })

  it('never scales a motif past the strip height, whatever the kind', () => {
    /**
     * The ceiling that stops motifs being clipped. A motif is drawn upward from the
     * strip's bottom edge, so a scale above 1 is cut off by the texture — it used to be
     * 1.35, which sliced the top off roughly a third of every layer. That was invisible
     * on grass blades, whose tips simply come out blunt, and unmissable on trees, which
     * come out with flat-topped canopies.
     */
    for (const motif of MOTIF_KINDS) {
      const field = generateMotifs({ densityScale: 2 }, seedFor(motif))
      for (const placement of field.placements) {
        expect(placement.scale, motif).toBeGreaterThan(0)
        expect(placement.scale, motif).toBeLessThanOrEqual(1)
      }
    }
  })

  it('spreads sizes widely enough to read as a scatter, not one repeated object', () => {
    // The depth cue only works if near and far ones differ. A range clustered near the
    // top of the strip looks like a fence of identical objects.
    const field = generateMotifs({ densityScale: 2 }, seedFor('trees'))
    const scales = field.placements.map((placement) => placement.scale)
    expect(Math.min(...scales)).toBeLessThan(0.45)
    expect(Math.max(...scales)).toBeGreaterThan(0.88)
  })

  it('varies the part count across 2 to 5', () => {
    // What stops every tree being the same tree, every bush the same bush. Bounds matter
    // both ways: below two a canopy is a lollipop, above five the parts stop being
    // individually visible at this strip height.
    const counts = new Set<number>()
    for (let seed = 1; seed <= 200; seed++) {
      for (const placement of generateMotifs({ densityScale: 2 }, seed).placements) {
        counts.add(placement.lobes)
      }
    }
    for (const count of counts) {
      expect(Number.isInteger(count)).toBe(true)
      expect(count).toBeGreaterThanOrEqual(2)
      expect(count).toBeLessThanOrEqual(5)
    }
    expect(counts.size).toBe(4)
  })

  it("scales density from the motif's own default, not from a shared count", () => {
    /**
     * 26 is a pleasant scatter of grass and a solid wall of trees, so a plain per-theme
     * count cannot survive the motif being chosen by the seed. The multiplier is what
     * lets a mood be sparser than another without knowing which shape it will get.
     */
    const grassSeed = seedFor('grass')
    const sparse = generateMotifs({ densityScale: 0.5 }, grassSeed).placements.length
    const normal = generateMotifs({ densityScale: 1 }, grassSeed).placements.length
    expect(sparse).toBeLessThan(normal)
    // Trees come out far fewer than grass at the same scale, which is the whole reason
    // the base density is per kind.
    const trees = generateMotifs({ densityScale: 1 }, seedFor('trees')).placements.length
    expect(trees).toBeLessThan(normal)
  })

  it('clamps density so a mood cannot bury the poles being traded', () => {
    // This layer crosses the character; sparseness is a hard requirement, not a taste.
    const seed = seedFor('trees')
    const asked = generateMotifs({ densityScale: 50 }, seed).placements.length
    const capped = generateMotifs({ densityScale: 2 }, seed).placements.length
    expect(asked).toBe(capped)
  })

  it('survives a nonsense density rather than generating NaN placements', () => {
    const field = generateMotifs({ densityScale: Number.NaN }, 5)
    expect(field.placements.length).toBeGreaterThan(0)
    expect(generateMotifs({ densityScale: -3 }, 5).placements).toEqual([])
  })

  it('snapshots the jolly foreground field', () => {
    expect(generateMotifs(jollyTheme.foreground, 42)).toMatchSnapshot()
  })
})
