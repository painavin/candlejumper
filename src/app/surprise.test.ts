import { describe, expect, it } from 'vitest'
import type { TickerMeta } from '@shared/contracts/index.js'
import { createPrng } from '@shared/math/index.js'
import { MIN_REMAINING_BARS, START_WINDOW_SECONDS, surpriseStart } from './surprise.js'

/**
 * Where a "Surprise me" run starts.
 *
 * The two cases worth pinning are the ones playing can't reveal: a series too short for a
 * random start, and a start that leaves no run behind it. Both produce something that looks
 * like a working game and isn't — a run of eleven bars, or a range covering no bars at all.
 */

const DAY = 24 * 60 * 60

/** A daily series of `bars` days ending at a fixed point, so spans are exact. */
const daily = (bars: number, overrides: Partial<TickerMeta> = {}): TickerMeta => ({
  symbol: 'TEST@1d',
  displayName: 'TEST · Daily',
  barCount: bars,
  firstBarTime: 1_000_000_000,
  lastBarTime: 1_000_000_000 + (bars - 1) * DAY,
  adjusted: true,
  ...overrides,
})

const prng = () => createPrng(12_345)

describe('surpriseStart', () => {
  it('runs to the last bar, never to a window inside the series', () => {
    // The change this exists for: it used to carve out ~250 bars and discard the rest, so
    // every surprise run was the same length.
    const ticker = daily(6_000)
    const range = surpriseStart(ticker, prng())
    expect(range?.to).toBe(ticker.lastBarTime)
  })

  it('starts inside the first two years', () => {
    const ticker = daily(6_000)
    // Sampled across seeds rather than trusting one draw, since the bound is the point.
    for (let seed = 1; seed < 60; seed++) {
      const range = surpriseStart(ticker, createPrng(seed))
      expect(range?.from).toBeGreaterThanOrEqual(ticker.firstBarTime)
      expect(range?.from).toBeLessThanOrEqual(ticker.firstBarTime + START_WINDOW_SECONDS)
    }
  })

  it('varies where it starts, which is the whole feature', () => {
    const ticker = daily(6_000)
    const starts = new Set(
      Array.from({ length: 40 }, (_, seed) => surpriseStart(ticker, createPrng(seed + 1))?.from)
    )
    expect(starts.size).toBeGreaterThan(30)
  })

  it('plays the whole of a series too short to carve a start out of', () => {
    // Under the floor there is nothing to choose: any start would leave less run than the
    // minimum, so the honest answer is the series itself.
    expect(surpriseStart(daily(MIN_REMAINING_BARS), prng())).toBeUndefined()
    expect(surpriseStart(daily(MIN_REMAINING_BARS - 100), prng())).toBeUndefined()
  })

  it('always leaves enough bars to be worth playing', () => {
    /**
     * The edge that matters on a short series. Two years is most of a 600-bar daily
     * history, so the two-year bound alone would happily start eleven bars from the end.
     */
    const ticker = daily(600)
    const secondsPerBar = (ticker.lastBarTime - ticker.firstBarTime) / (ticker.barCount - 1)
    for (let seed = 1; seed < 60; seed++) {
      const range = surpriseStart(ticker, createPrng(seed))
      const remaining = (ticker.lastBarTime - (range?.from ?? ticker.firstBarTime)) / secondsPerBar
      expect(remaining).toBeGreaterThanOrEqual(MIN_REMAINING_BARS)
    }
  })

  it('is the two-year bound that binds on a long series, not the floor', () => {
    // A 27-year daily history: the floor would allow starting 25 years in, and does not.
    const ticker = daily(6_800)
    const range = surpriseStart(ticker, createPrng(7))
    expect(range?.from).toBeLessThan(ticker.firstBarTime + START_WINDOW_SECONDS + DAY)
  })

  it('produces a range that covers bars, in the right order', () => {
    // A reversed or empty range is dropped by `parseStoredConfig` and would silently
    // become "play everything", hiding the bug rather than showing it.
    for (let seed = 1; seed < 30; seed++) {
      const range = surpriseStart(daily(3_000), createPrng(seed))
      expect(range!.from).toBeLessThan(range!.to)
      expect(Number.isInteger(range!.from)).toBe(true)
    }
  })

  it('handles an intraday series, where a bar is not a day', () => {
    // 30-minute bars: two calendar years is a great many bars, so the window is generous
    // and the floor still holds. The point is that neither is expressed in days.
    const bars = 20_000
    const ticker = daily(bars, {
      symbol: 'UVIX@30m',
      lastBarTime: 1_000_000_000 + bars * 1_800,
    })
    const range = surpriseStart(ticker, prng())
    expect(range?.to).toBe(ticker.lastBarTime)
    expect(range?.from).toBeLessThanOrEqual(ticker.firstBarTime + START_WINDOW_SECONDS)
  })

  it('refuses a series whose endpoints say it has no span', () => {
    // A one-bar or malformed entry would divide by zero into a NaN range.
    expect(surpriseStart(daily(6_000, { lastBarTime: 1_000_000_000 }), prng())).toBeUndefined()
    expect(
      surpriseStart(daily(6_000, { lastBarTime: 900_000_000 }), prng())
    ).toBeUndefined()
  })
})
