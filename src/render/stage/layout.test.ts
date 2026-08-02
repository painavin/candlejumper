import { describe, expect, it } from 'vitest'
import { computeLayout, foregroundTop, unitToY } from './layout.js'

describe('computeLayout', () => {
  it('derives bar width from the playfield, not the viewport', () => {
    // Measuring against the full viewport would silently shrink visible history
    // by 25% and make visibleBarCount a lie, because the strip right of the
    // character never holds poles.
    const layout = computeLayout(1200, 800, 60)
    expect(layout.playfieldWidth).toBe(900)
    expect(layout.barWidth).toBe(15)
    expect(layout.barWidth).not.toBe(1200 / 60)
  })

  it('leaves the strip right of the character out of the playfield', () => {
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

describe('foregroundTop', () => {
  const STRIP = 104

  it('sits the strip on the ground line, not the bottom of the viewport', () => {
    /**
     * The bug this exists for. With a sub-pane open, `groundY` is roughly 40% of the
     * chart area above `height`, so anchoring to the viewport drops the whole
     * occlusion layer below the instrument panes — dark shapes along the bottom of the
     * screen, occluding nothing, nowhere near the character.
     */
    const layout = computeLayout(1200, 800, 60, 1)
    expect(foregroundTop(layout, STRIP)).toBe(layout.groundY - STRIP)
    expect(foregroundTop(layout, STRIP)).toBeLessThan(layout.height - STRIP)
  })

  it('never matches the viewport bottom, not even with no pane open', () => {
    /**
     * Worth pinning, because it is stronger than the bug looked. `GROUND_MARGIN`
     * already holds the ground line clear of the viewport edge, so anchoring the strip
     * to `height` was wrong in *every* configuration — subtly by that margin with no
     * pane, and by the whole 40% pane budget with one. Nothing about "no panes open"
     * made the old code correct; it just made it less visibly wrong.
     */
    const bare = computeLayout(1200, 800, 60, 0)
    expect(bare.groundY).toBeLessThan(bare.height)
    expect(foregroundTop(bare, STRIP)).toBeLessThan(bare.height - STRIP)

    const withPane = computeLayout(1200, 800, 60, 1)
    // And the gap widens sharply once a pane takes its share.
    expect(bare.groundY - withPane.groundY).toBeGreaterThan(100)
  })

  it('puts the strip bottom exactly where a unit-0 bar rests', () => {
    // The motifs are baked with their bases on the texture's bottom edge, so this is
    // what makes them stand on the same line the poles do.
    const layout = computeLayout(1400, 900, 60, 2)
    expect(foregroundTop(layout, STRIP) + STRIP).toBe(unitToY(0, layout))
  })
})
