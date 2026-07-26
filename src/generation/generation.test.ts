import { describe, expect, it } from 'vitest'
import { jollyTheme, seriousTheme } from '@content/visualThemes/index.js'
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
  it('keeps railings upright and lets grass lean', () => {
    const railings = generateMotifs({ motif: 'railing', density: 8 }, 2)
    const grass = generateMotifs({ motif: 'grass', density: 8 }, 2)
    expect(railings.every((placement) => placement.lean === 0)).toBe(true)
    expect(grass.some((placement) => placement.lean !== 0)).toBe(true)
  })

  it('gives each motif kind its own stream', () => {
    const grass = generateMotifs({ motif: 'grass', density: 6 }, 4)
    const leaves = generateMotifs({ motif: 'leaves', density: 6 }, 4)
    expect(grass.map((p) => p.x)).not.toEqual(leaves.map((p) => p.x))
  })

  it('snapshots the jolly grass placement', () => {
    expect(generateMotifs(jollyTheme.foreground, 42)).toMatchSnapshot()
  })
})
