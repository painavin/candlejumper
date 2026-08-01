import { describe, expect, it } from 'vitest'
import { dashSegments } from './dash.js'

/**
 * The dash walk, tested because its arithmetic is the part that can be wrong.
 *
 * The first version computed a gap's remaining length as `off - phase` instead of
 * `period - phase`. That goes negative as soon as a dash ends part-way along a
 * segment, so the walk stepped *backwards* and never terminated — a hung frame rather
 * than a wrong picture. The termination tests below are the point of this file.
 */

const PATTERN = { on: 9, off: 6 }

/** Total drawn length, which is what "the rhythm is right" ultimately means. */
const drawn = (segments: { from: { x: number; y: number }; to: { x: number; y: number } }[]) =>
  segments.reduce(
    (total, segment) =>
      total + Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y),
    0
  )

describe('dashSegments', () => {
  it('terminates on a line long enough to need several gaps', () => {
    // The regression test: with the wrong gap arithmetic this never returns.
    const segments = dashSegments(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      PATTERN
    )
    // 100px over a 15px period: 6 full dashes plus a partial one.
    expect(segments).toHaveLength(7)
    expect(segments[0]).toEqual({ from: { x: 0, y: 0 }, to: { x: 9, y: 0 } })
    expect(segments[1]).toEqual({ from: { x: 15, y: 0 }, to: { x: 24, y: 0 } })
  })

  it('draws about on/(on+off) of the total length', () => {
    const segments = dashSegments(
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
      ],
      PATTERN
    )
    // 9 of every 15 pixels, within one period's worth of the ideal.
    expect(drawn(segments)).toBeGreaterThan(300 * (9 / 15) - 15)
    expect(drawn(segments)).toBeLessThan(300 * (9 / 15) + 15)
  })

  it('carries the phase across points instead of restarting at each one', () => {
    // Restarting per point would put a dash at the start of every bar, which at narrow
    // bar widths makes the line look solid — the exact case dashing exists for.
    const oneLong = dashSegments(
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
      ],
      PATTERN
    )
    const manyShort = dashSegments(
      Array.from({ length: 13 }, (_unused, index) => ({ x: index * 5, y: 0 })),
      PATTERN
    )
    expect(drawn(manyShort)).toBeCloseTo(drawn(oneLong), 6)
  })

  it('follows a diagonal rather than only the horizontal', () => {
    const segments = dashSegments(
      [
        { x: 0, y: 0 },
        { x: 30, y: 40 },
      ],
      PATTERN
    )
    // Length 50, so the first dash ends 9/50 of the way along both axes.
    expect(segments[0]?.to.x).toBeCloseTo(30 * (9 / 50), 6)
    expect(segments[0]?.to.y).toBeCloseTo(40 * (9 / 50), 6)
  })

  it('ignores repeated points rather than letting them shift the rhythm', () => {
    const withRepeat = dashSegments(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 0 },
        { x: 40, y: 0 },
      ],
      PATTERN
    )
    const without = dashSegments(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 40, y: 0 },
      ],
      PATTERN
    )
    expect(withRepeat).toEqual(without)
  })

  it('draws nothing without a direction, or with a degenerate pattern', () => {
    expect(dashSegments([{ x: 0, y: 0 }], PATTERN)).toEqual([])
    expect(dashSegments([], PATTERN)).toEqual([])
    expect(
      dashSegments(
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
        { on: 0, off: 5 }
      )
    ).toEqual([])
  })

  it('draws one unbroken segment when the pattern has no gap', () => {
    const segments = dashSegments(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      { on: 9, off: 0 }
    )
    expect(drawn(segments)).toBeCloseTo(50, 6)
  })
})
