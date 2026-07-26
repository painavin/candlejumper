import { describe, expect, it } from 'vitest'
import { computeLayout, unitToY } from './layout.js'

describe('computeLayout', () => {
  it('derives bar width from the playfield, not the viewport', () => {
    // Measuring against the full viewport would silently shrink visible history
    // by 25% and make visibleBarCount a lie, because the fog strip never holds
    // poles.
    const layout = computeLayout(1200, 800, 60)
    expect(layout.playfieldWidth).toBe(900)
    expect(layout.barWidth).toBe(15)
    expect(layout.barWidth).not.toBe(1200 / 60)
  })

  it('leaves the fog strip right of the character', () => {
    const layout = computeLayout(1200, 800, 60)
    expect(layout.characterX).toBe(900)
    expect(layout.fogWidth).toBe(300)
  })

  it('draws poles narrower than their slot so they stay distinct', () => {
    const layout = computeLayout(1200, 800, 60)
    expect(layout.poleWidth).toBeLessThan(layout.barWidth)
    expect(layout.poleWidth).toBeCloseTo(layout.barWidth * 0.85, 6)
  })

  it('reserves a HUD band tall enough for the plates in either orientation', () => {
    const portrait = computeLayout(400, 900, 28)
    const landscape = computeLayout(900, 400, 60)
    expect(portrait.isPortrait).toBe(true)
    expect(landscape.isPortrait).toBe(false)

    // Portrait is *taller*, which looks backwards and isn't. The HUD plates size
    // themselves to their text, and at phone width the streak plate can't fit beside
    // the primary readout, so it wraps to a second row and the band has to cover it.
    // Portrait economises on type size instead — see SIZES in topHud.ts.
    expect(portrait.topHudHeight).toBeGreaterThan(landscape.topHudHeight)

    // What actually matters either way: the band never eats the chart.
    for (const layout of [portrait, landscape]) {
      expect(layout.topHudHeight).toBeLessThan(layout.height / 3)
      expect(layout.chartTop).toBeGreaterThan(layout.topHudHeight)
      expect(layout.chartHeight).toBeGreaterThan(0)
    }
  })

  it('gives portrait a readable bar width at the reduced count', () => {
    // 60 poles at phone width are ~4px and unreadable, which is why
    // visibleBarCount is orientation-aware.
    const at60 = computeLayout(400, 900, 60)
    const at28 = computeLayout(400, 900, 28)
    expect(at60.barWidth).toBeLessThan(6)
    expect(at28.barWidth).toBeGreaterThan(10)
  })

  it('never produces a non-positive chart height, even on a tiny viewport', () => {
    expect(computeLayout(320, 80, 28).chartHeight).toBeGreaterThan(0)
  })
})

describe('unitToY', () => {
  it('puts unit 0 on the ground and unit 1 at the chart top', () => {
    const layout = computeLayout(1200, 800, 60)
    expect(unitToY(0, layout)).toBe(layout.groundY)
    expect(unitToY(1, layout)).toBeCloseTo(layout.chartTop, 6)
  })

  it('increases upward, since screen y grows downward', () => {
    const layout = computeLayout(1200, 800, 60)
    expect(unitToY(0.8, layout)).toBeLessThan(unitToY(0.2, layout))
  })
})
