import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@config/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { createNormalizer } from './normalizer.js'
import { applyPriceTransform, invertPriceTransform } from './priceTransform.js'

const bar = (close: number, t = 0): OhlcvBar => ({
  o: close,
  h: close,
  l: close,
  c: close,
  v: 1,
  t,
})

/** One big step, so easing has fully settled and assertions are about bounds. */
const SETTLE = 100

describe('applyPriceTransform', () => {
  it('is the identity for none', () => {
    expect(applyPriceTransform(217.5, 'none')).toBe(217.5)
  })

  it('round-trips through log10', () => {
    expect(invertPriceTransform(applyPriceTransform(217.5, 'log10'), 'log10')).toBeCloseTo(217.5, 9)
  })

  it('is per-bar, so it cannot leak anything about other bars', () => {
    // The reason log10 is legal with any mode: it has no dependence on the
    // series, so it inherits whatever legality the mode has.
    expect(applyPriceTransform(100, 'log10')).toBe(2)
  })
})

describe('visible-window-min-max (the default)', () => {
  it('never reads a bar beyond the window it was handed', () => {
    // The regression guard for the future-price leak: bounds must come only from
    // played bars. If a future bar could reach the normalizer, the axis would
    // reveal the run's eventual high and low.
    const config = defaultConfig()
    const normalizer = createNormalizer(config)
    normalizer.reset(bar(100))

    const played = [bar(100), bar(110), bar(105)]
    const bounds = normalizer.update(played, SETTLE)

    // A later bar at 500 exists in the series but was not passed in; the bounds
    // must be unaffected by its existence.
    expect(bounds.max).toBeLessThan(200)
    expect(bounds.min).toBeGreaterThan(50)
  })

  it('rescales as the window slides', () => {
    const normalizer = createNormalizer(defaultConfig())
    normalizer.reset(bar(100))
    const early = normalizer.update([bar(100), bar(101)], SETTLE)
    const later = normalizer.update([bar(300), bar(310)], SETTLE)
    expect(later.min).toBeGreaterThan(early.max)
  })

  it('pads the window so the tallest pole is not flush with the top', () => {
    const normalizer = createNormalizer(defaultConfig())
    normalizer.reset(bar(100))
    normalizer.update([bar(100), bar(200)], SETTLE)
    expect(normalizer.unit(200)).toBeLessThan(1)
    expect(normalizer.unit(100)).toBeGreaterThan(0)
  })

  it('keeps a flat window legible instead of dividing by zero', () => {
    // Ten identical closes should read as a flat line mid-chart, not as noise at
    // full amplitude.
    const normalizer = createNormalizer(defaultConfig())
    normalizer.reset(bar(100))
    normalizer.update(Array.from({ length: 10 }, () => bar(100)), SETTLE)
    expect(normalizer.unit(100)).toBeCloseTo(0.5, 2)
  })

  it('orders units the same way prices are ordered', () => {
    const normalizer = createNormalizer(defaultConfig())
    normalizer.reset(bar(100))
    normalizer.update([bar(100), bar(150), bar(200)], SETTLE)
    expect(normalizer.unit(100)).toBeLessThan(normalizer.unit(150))
    expect(normalizer.unit(150)).toBeLessThan(normalizer.unit(200))
  })

  it('clamps a price outside the eased bounds rather than drawing off-chart', () => {
    const normalizer = createNormalizer(defaultConfig())
    normalizer.reset(bar(100))
    normalizer.update([bar(100), bar(110)], SETTLE)
    expect(normalizer.unit(10_000)).toBe(1)
    expect(normalizer.unit(1)).toBe(0)
  })
})

describe('bounds easing', () => {
  it('snaps on the first update instead of flying in from a placeholder', () => {
    const normalizer = createNormalizer(defaultConfig())
    normalizer.reset(bar(100))
    const bounds = normalizer.update([bar(100), bar(110)], 1 / 60)
    expect(bounds.min).toBeGreaterThan(90)
    expect(bounds.max).toBeLessThan(120)
  })

  it('eases afterwards rather than snapping to a new extreme', () => {
    const normalizer = createNormalizer(defaultConfig())
    normalizer.reset(bar(100))
    normalizer.update([bar(100), bar(110)], 1 / 60)
    const afterOneFrame = normalizer.update([bar(100), bar(300)], 1 / 60)
    expect(afterOneFrame.max).toBeLessThan(200) // nowhere near 300 yet
  })

  it('converges at the same rate regardless of frame rate', () => {
    // Frame-rate-dependent easing would settle at different speeds on a 60Hz
    // laptop and a 120Hz phone, which is the same class of bug as
    // frame-based motion.
    const settleAt = (fps: number): number => {
      const normalizer = createNormalizer(defaultConfig())
      normalizer.reset(bar(100))
      normalizer.update([bar(100), bar(110)], 1 / fps)
      for (let i = 0; i < fps; i++) normalizer.update([bar(100), bar(300)], 1 / fps)
      return normalizer.bounds.max
    }
    expect(settleAt(120)).toBeCloseTo(settleAt(60), 1)
  })
})

describe('fixed-price-per-pixel', () => {
  const fixedConfig = () => {
    const config = defaultConfig()
    config.normalizationMode = 'fixed-price-per-pixel'
    return config
  }

  it('never changes its span, so nothing rescales', () => {
    const normalizer = createNormalizer(fixedConfig())
    normalizer.reset(bar(100))
    const first = normalizer.update([bar(100), bar(110)], SETTLE)
    const firstSpan = first.max - first.min

    const later = normalizer.update([bar(300), bar(400)], SETTLE)
    expect(later.max - later.min).toBeCloseTo(firstSpan, 6)
  })

  it('pans to follow a trending series rather than losing it off-screen', () => {
    const normalizer = createNormalizer(fixedConfig())
    normalizer.reset(bar(100))
    normalizer.update([bar(100), bar(110)], SETTLE)
    normalizer.update([bar(300), bar(305)], SETTLE)
    expect(normalizer.unit(302)).toBeGreaterThan(0)
    expect(normalizer.unit(302)).toBeLessThan(1)
  })
})

describe('starting-price-relative', () => {
  const relativeConfig = () => {
    const config = defaultConfig()
    config.normalizationMode = 'starting-price-relative'
    return config
  }

  it('expresses the first close as the reference value', () => {
    const normalizer = createNormalizer(relativeConfig())
    normalizer.reset(bar(200))
    expect(normalizer.valueOf(200)).toBeCloseTo(100, 6)
    expect(normalizer.valueOf(300)).toBeCloseTo(150, 6)
  })

  it('takes its reference from the first bar, which is always in the past', () => {
    // Why this mode is causal where closing-price-relative is not: the reference
    // is the *first* close, so it can never encode anything unplayed.
    const normalizer = createNormalizer(relativeConfig())
    normalizer.reset(bar(50))
    expect(normalizer.valueOf(100)).toBeCloseTo(200, 6)
  })

  it('composes with log10 additively, since a ratio of logs is meaningless', () => {
    const config = relativeConfig()
    config.priceTransform = 'log10'
    const normalizer = createNormalizer(config)
    normalizer.reset(bar(100))
    // A 10x move is one decade, so it should read as +100 on a 100 reference.
    expect(normalizer.valueOf(1000)).toBeCloseTo(200, 6)
    expect(normalizer.valueOf(100)).toBeCloseTo(100, 6)
  })
})

describe('reset', () => {
  it('re-anchors the reference on a ticker change', () => {
    const config = defaultConfig()
    config.normalizationMode = 'starting-price-relative'
    const normalizer = createNormalizer(config)
    normalizer.reset(bar(100))
    expect(normalizer.valueOf(200)).toBeCloseTo(200, 6)
    normalizer.reset(bar(200))
    expect(normalizer.valueOf(200)).toBeCloseTo(100, 6)
  })
})
