import { describe, expect, it } from 'vitest'
import { LAYOUT } from '@config/index.js'
import { gaitOf } from './gait.js'

/**
 * The character's gait: when it hops, and where it is while it does.
 *
 * Rendering is verified by playing rather than by tests, but *timing* is arithmetic, and
 * the defect this replaced was a timing bug — the character hopped onto a bar that was
 * still forming, then hung motionless at a fixed point while that bar slid out from under
 * it. Both halves are pinned here.
 *
 * The property doing the most work is **continuity**. Every seam is a place the character
 * could visibly teleport: the start of the hop, the end of it, and the bar boundary, where
 * the bar it rode becomes "the previous bar".
 */

const GROWTH = LAYOUT.barGrowthFraction
const HOP = LAYOUT.hopDurationFraction

/** Two perches a clear distance apart, so a blend is unambiguous. */
const at = (barPhase: number) => gaitOf({ barPhase, previousUnit: 0.2, newestUnit: 0.8 })

describe('while the newest bar is still forming', () => {
  it('stands on the bar that has closed, one bar width back', () => {
    // The whole point: it never commits to a bar that is still being drawn.
    expect(at(0).barsBehind).toBeCloseTo(1, 9)
    expect(at(0).unit).toBeCloseTo(0.2, 9)
    expect(at(0).hop).toBe(0)
  })

  it('rides that bar leftward rather than standing still', () => {
    // A fixed point against a moving world is a slide, which is what this replaced.
    // One bar width of phase is one bar width of travel — the same arithmetic that
    // positions the pole.
    const early = at(GROWTH * 0.2)
    const late = at(GROWTH * 0.9)
    expect(late.barsBehind - early.barsBehind).toBeCloseTo(GROWTH * 0.7, 9)
  })

  it('has not left the ground', () => {
    expect(at(GROWTH * 0.99).liftInBarWidths).toBe(0)
  })
})

describe('the hop', () => {
  it('starts the instant the bar closes', () => {
    expect(at(GROWTH).hop).toBe(0)
    expect(at(GROWTH + HOP * 0.01).hop).toBeGreaterThan(0)
  })

  it('lands on the bar that just closed, having covered exactly one bar width', () => {
    const takeoff = at(GROWTH)
    const landing = at(GROWTH + HOP)
    expect(landing.hop).toBe(1)
    expect(landing.unit).toBeCloseTo(0.8, 9)
    // The gap closed is one bar width *net of the travel* both perches did meanwhile.
    expect(takeoff.barsBehind - landing.barsBehind).toBeCloseTo(1 - HOP, 9)
    expect(landing.barsBehind).toBeCloseTo(GROWTH + HOP, 9)
  })

  it('peaks in the middle and is flat at both ends', () => {
    // Fixed height with a variable landing: an arc scaled to the height difference would
    // need the next bar's price before jumping.
    expect(at(GROWTH).liftInBarWidths).toBe(0)
    expect(at(GROWTH + HOP).liftInBarWidths).toBeCloseTo(0, 9)
    expect(at(GROWTH + HOP / 2).liftInBarWidths).toBeCloseTo(LAYOUT.hopHeightInBarWidths, 9)
  })

  it('is over well before the next bar closes', () => {
    // Otherwise a hop would still be in the air when the next one began.
    expect(GROWTH + HOP).toBeLessThan(1)
    expect(at(1).hop).toBe(1)
  })
})

describe('after landing', () => {
  it('rides the bar it landed on for the rest of the bar', () => {
    const landed = at(GROWTH + HOP)
    const later = at(1)
    expect(later.hop).toBe(1)
    expect(later.unit).toBeCloseTo(0.8, 9)
    expect(later.barsBehind - landed.barsBehind).toBeCloseTo(1 - GROWTH - HOP, 9)
  })
})

describe('continuity', () => {
  const sample = (barPhase: number) => at(barPhase).barsBehind

  it('does not jump when the hop begins or ends', () => {
    const epsilon = 1e-6
    expect(sample(GROWTH - epsilon)).toBeCloseTo(sample(GROWTH + epsilon), 5)
    expect(sample(GROWTH + HOP - epsilon)).toBeCloseTo(sample(GROWTH + HOP + epsilon), 5)
  })

  it('carries across the bar boundary', () => {
    /**
     * The seam that is easiest to get wrong. At the end of a bar the character is riding
     * the newest bar at `barsBehind = 1`; a moment later that bar is the *previous* bar of
     * the next phase and the character must still be exactly one bar width back.
     */
    const endOfBar = gaitOf({ barPhase: 1, previousUnit: 0.2, newestUnit: 0.8 })
    // Next bar: what was newest is now previous, and a fresh bar begins forming.
    const startOfNext = gaitOf({ barPhase: 0, previousUnit: 0.8, newestUnit: 0.5 })
    expect(endOfBar.barsBehind).toBeCloseTo(startOfNext.barsBehind, 9)
    expect(endOfBar.unit).toBeCloseTo(startOfNext.unit, 9)
  })

  it('stays in a bounded band, never crossing the now-line', () => {
    /**
     * The motion is a sawtooth, not a drift: `barsBehind` grows while riding — leftward
     * with the world — and shrinks during the hop, which is the leap to the right. So the
     * thing worth pinning is the band, and both ends of it matter.
     *
     * It must never reach 0: right of the now-line is unplayed sky, and a character over
     * it would be standing on a bar that does not exist yet. And it must stay shallow,
     * or the character walks off toward the left edge instead of hopping in place.
     */
    let furthest = 0
    let nearest = Infinity
    for (let phase = 0; phase <= 1; phase += 0.005) {
      const { barsBehind } = at(phase)
      furthest = Math.max(furthest, barsBehind)
      nearest = Math.min(nearest, barsBehind)
    }
    // Deepest at the moment of take-off, having ridden a full bar plus the growth window.
    expect(furthest).toBeCloseTo(1 + GROWTH, 2)
    // Closest on landing, and still comfortably behind the line.
    expect(nearest).toBeCloseTo(GROWTH + HOP, 2)
    expect(nearest).toBeGreaterThan(0)
  })
})

describe('edge cases', () => {
  it('starts where it would have landed when there is no previous bar', () => {
    // The first bar of a run has nothing to leave, so there is no hop to animate.
    const first = gaitOf({ barPhase: 0, previousUnit: undefined, newestUnit: 0.6 })
    expect(first.unit).toBe(0.6)
    expect(gaitOf({ barPhase: 0.9, previousUnit: undefined, newestUnit: 0.6 }).unit).toBe(0.6)
  })

  it('clamps a phase outside 0..1 rather than extrapolating off screen', () => {
    expect(at(-5).barsBehind).toBeCloseTo(at(0).barsBehind, 9)
    expect(at(9).barsBehind).toBeCloseTo(at(1).barsBehind, 9)
  })
})
