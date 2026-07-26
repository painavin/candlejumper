import { describe, expect, it } from 'vitest'
import { createPrng, deriveSeed, mintSeed } from './prng.js'

describe('createPrng', () => {
  it('is deterministic for a seed', () => {
    const a = createPrng(12345)
    const b = createPrng(12345)
    const drawA = Array.from({ length: 8 }, () => a.next())
    const drawB = Array.from({ length: 8 }, () => b.next())
    expect(drawA).toEqual(drawB)
  })

  it('produces different streams for different seeds', () => {
    expect(createPrng(1).next()).not.toBe(createPrng(2).next())
  })

  it('stays in [0, 1)', () => {
    const prng = createPrng(99)
    for (let i = 0; i < 5000; i++) {
      const value = prng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('int() covers its inclusive bounds and never exceeds them', () => {
    const prng = createPrng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(prng.int(1, 6))
    expect([...seen].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('snapshots its output, so a change to the algorithm fails a test', () => {
    // The determinism guard: theme + seed must always produce an identical
    // world, so the generator itself must not drift silently.
    const prng = createPrng(42)
    const draws = Array.from({ length: 4 }, () => Number(prng.next().toFixed(10)))
    expect(draws).toMatchInlineSnapshot(`
      [
        0.6011037519,
        0.448290559,
        0.8524657935,
        0.6697340414,
      ]
    `)
  })
})

describe('deriveSeed', () => {
  it('gives each label its own stream', () => {
    const mountains = createPrng(deriveSeed(1, 'mountains'))
    const clouds = createPrng(deriveSeed(1, 'clouds'))
    expect(mountains.next()).not.toBe(clouds.next())
  })

  it('is stable for the same seed and label', () => {
    expect(deriveSeed(1, 'mountains')).toBe(deriveSeed(1, 'mountains'))
  })

  it('insulates one layer from another layer consuming more values', () => {
    // Adding an octave to the mountains must not change the clouds.
    const cloudSeed = deriveSeed(1, 'clouds')
    const mountains = createPrng(deriveSeed(1, 'mountains'))
    for (let i = 0; i < 100; i++) mountains.next()
    expect(deriveSeed(1, 'clouds')).toBe(cloudSeed)
  })
})

describe('mintSeed', () => {
  it('returns a 32-bit unsigned integer', () => {
    const seed = mintSeed()
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThanOrEqual(0xffffffff)
  })

  it('is the only source of entropy, so it must actually vary', () => {
    const seeds = new Set(Array.from({ length: 32 }, () => mintSeed()))
    expect(seeds.size).toBeGreaterThan(1)
  })
})
