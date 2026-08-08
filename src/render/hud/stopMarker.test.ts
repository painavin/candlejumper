import { describe, expect, it } from 'vitest'
import { jollyTheme, neonTheme } from '@content/visualThemes/index.js'
import type { StopLine } from '@engine/output/index.js'
import { AXIS_WIDTH, computeLayout } from '../stage/layout.js'
import {
  MAX_MARKERS,
  isRatchet,
  leaderStartX,
  markerRadius,
  markerX,
  stopColour,
  visibleStops,
} from './stopMarker.js'

/**
 * Stop marker arithmetic.
 *
 * `stopLines.ts` draws these and needs a renderer, so it has no tests — which is
 * exactly how the foreground strip shipped anchored to the wrong edge. Everything with
 * a right answer lives here instead.
 */

const stop = (stopId: string, level: number, advisory: boolean): StopLine => ({
  stopId,
  level,
  unit: 0.5,
  advisory,
  breached: false,
})

describe('visibleStops', () => {
  it('shows an enforcing stop before an advisory one, whatever the order given', () => {
    /**
     * The rule that matters. An enforcing stop will actually close the position, so if
     * only one marker fits it must never be the one dropped — not seeing the level that
     * will eject you is worse than not seeing one you were merely asked to respect.
     */
    const lines = [stop('trailing-percent', 3.4, true), stop('fixed-percent', 3.2, false)]
    expect(visibleStops(lines).map((line) => line.stopId)).toEqual([
      'fixed-percent',
      'trailing-percent',
    ])
  })

  it('caps at two, dropping advisory levels first', () => {
    const lines = [
      stop('advisory-a', 3.4, true),
      stop('enforcing', 3.2, false),
      stop('advisory-b', 3.1, true),
    ]
    const shown = visibleStops(lines)
    expect(shown).toHaveLength(MAX_MARKERS)
    expect(shown.map((line) => line.stopId)).toEqual(['enforcing', 'advisory-a'])
  })

  it('keeps configured order within a group', () => {
    // Stable rather than sorted by level: the engine hands them over in the order the
    // player configured them, and inventing a second ordering would be a rule nobody
    // asked for.
    const lines = [stop('first', 3.9, false), stop('second', 3.1, false)]
    expect(visibleStops(lines).map((line) => line.stopId)).toEqual(['first', 'second'])
  })

  it('shows nothing when the engine reports nothing', () => {
    // Which is what happens while flat — there is no position for a level to protect.
    expect(visibleStops([])).toEqual([])
  })
})

describe('markerX', () => {
  it('sits right of the character, in the strip with no bars in it', () => {
    // The one region of the chart a marker can occupy without covering a candle, and
    // the region the full-width line used to cross for no reason.
    const layout = computeLayout(1200, 800, 60, 1)
    expect(markerX(layout, AXIS_WIDTH)).toBeGreaterThan(layout.characterX)
  })

  it('clears the player by more than both radii, so they never overlap', () => {
    /**
     * The collision that would matter most: a stop level coincides with the player's
     * height exactly when price approaches the stop, which is when the marker most
     * needs to be readable.
     */
    const layout = computeLayout(1200, 800, 60, 1)
    const radius = markerRadius(layout)
    const player = Math.max(7, Math.min(layout.barWidth * 1.1, layout.chartHeight * 0.04))
    expect(markerX(layout, AXIS_WIDTH) - layout.characterX).toBeGreaterThan(radius + player * 0.5)
  })

  it('stays clear of the price axis on a narrow viewport', () => {
    // A phone in portrait leaves only a few dozen pixels of strip, and a marker drawn
    // under the axis plate is a marker nobody can see.
    const layout = computeLayout(360, 780, 28, 1)
    expect(markerX(layout, AXIS_WIDTH)).toBeLessThanOrEqual(layout.width - AXIS_WIDTH)
  })

  it('never crosses back to the left of the character, however narrow', () => {
    // The clamp must not overshoot into the candles it exists to avoid.
    for (const width of [280, 320, 360, 480, 720]) {
      const layout = computeLayout(width, 720, 28, 1)
      expect(markerX(layout, AXIS_WIDTH), `${width}px`).toBeGreaterThanOrEqual(layout.characterX)
    }
  })
})

describe('markerRadius', () => {
  it('is smaller than the player, which is the subject', () => {
    const layout = computeLayout(1200, 800, 60, 1)
    const player = Math.max(7, Math.min(layout.barWidth * 1.1, layout.chartHeight * 0.04))
    expect(markerRadius(layout)).toBeLessThan(player)
    expect(markerRadius(layout)).toBeGreaterThan(0)
  })
})

describe('leaderStartX', () => {
  it('reaches left of the marker but nowhere near the whole chart', () => {
    // The part of a full-width line worth keeping — comparing the newest candles
    // against the level — without striping the history to do it.
    const layout = computeLayout(1200, 800, 60, 1)
    const start = leaderStartX(layout, AXIS_WIDTH)
    expect(start).toBeLessThan(markerX(layout, AXIS_WIDTH))
    expect(start).toBeGreaterThan(layout.width * 0.5)
  })

  it('clamps at the left edge rather than going negative', () => {
    const layout = computeLayout(300, 700, 6, 0)
    expect(leaderStartX(layout, AXIS_WIDTH)).toBeGreaterThanOrEqual(0)
  })
})

describe('isRatchet', () => {
  it('is a rise for a long and a fall for a short', () => {
    /**
     * Favour is signed. Getting this backwards would celebrate the level drifting
     * *against* the player, which teaches the opposite of the lesson — a trailing stop's
     * whole point is that it only ever moves one way.
     */
    expect(isRatchet(3.2, 3.3, 'long')).toBe(true)
    expect(isRatchet(3.2, 3.1, 'long')).toBe(false)
    expect(isRatchet(3.2, 3.1, 'short')).toBe(true)
    expect(isRatchet(3.2, 3.3, 'short')).toBe(false)
  })

  it('does not fire on an unchanged level', () => {
    // Most bars leave a fixed stop exactly where it was; a hop on every frame would be
    // a twitch rather than a gesture.
    expect(isRatchet(3.2, 3.2, 'long')).toBe(false)
    expect(isRatchet(3.2, 3.2, 'short')).toBe(false)
  })

  it('never fires while flat', () => {
    expect(isRatchet(3.2, 3.9, 'flat')).toBe(false)
  })

  it('does not fire on the first frame it sees a level', () => {
    // No previous value means no movement to report. Firing here would make every stop
    // hop the instant a position opens.
    expect(isRatchet(undefined, 3.4, 'long')).toBe(false)
  })

  it('ignores a non-finite previous or current level', () => {
    expect(isRatchet(Number.NaN, 3.4, 'long')).toBe(false)
    expect(isRatchet(3.4, Number.NaN, 'long')).toBe(false)
  })
})

describe('stopColour', () => {
  const breached = (line: StopLine): StopLine => ({ ...line, breached: true })

  it('is the theme dim colour until the level is breached, then the accent', () => {
    const line = stop('trailing-percent', 3.4, true)
    expect(stopColour(line, jollyTheme)).toBe(jollyTheme.accent.dim)
    expect(stopColour(breached(line), jollyTheme)).toBe(jollyTheme.accent.accent)
  })

  it('gives an enforcing and an advisory level the same colour', () => {
    /**
     * Deliberate. That distinction is carried by fill versus outline and solid versus
     * ghost, which survives being 20px on a phone in a way two shades of one hue does
     * not — and it means the hedgehog and its axis tag always agree.
     */
    const level = 3.4
    expect(stopColour(stop('a', level, true), neonTheme)).toBe(
      stopColour(stop('b', level, false), neonTheme)
    )
  })

  it('follows the theme, so a marker is never a colour its mood does not use', () => {
    const line = stop('trailing-percent', 3.4, false)
    expect(stopColour(line, jollyTheme)).not.toBe(stopColour(line, neonTheme))
  })
})
