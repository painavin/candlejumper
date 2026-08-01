import { describe, expect, it } from 'vitest'
import {
  BAR_INTERVALS,
  DEFAULT_INTERVAL,
  inferInterval,
  intervalMatches,
  intervalName,
  intervalSeconds,
  isBarInterval,
  isIntraday,
} from './interval.js'

/**
 * How much time one bar covers.
 *
 * The interval used to be an assumption spread across a hard-coded URL, a cache keyed by
 * symbol alone, and a split heuristic calibrated on one-day moves. These tests pin the
 * two jobs that assumption now has to do properly: recognising an interval from a file
 * that doesn't declare one, and matching what a provider reports against what was asked
 * for.
 */

const day = 86_400

describe('the table itself', () => {
  it('is ordered finest first, which is the order the picker offers', () => {
    const seconds = BAR_INTERVALS.map(intervalSeconds)
    expect(seconds).toEqual([...seconds].sort((a, b) => a - b))
  })

  it('names and measures every interval, with no gaps', () => {
    for (const interval of BAR_INTERVALS) {
      expect(intervalSeconds(interval)).toBeGreaterThan(0)
      expect(intervalName(interval)).not.toBe('')
    }
  })

  it('defaults to daily, which is what every existing dataset is', () => {
    expect(DEFAULT_INTERVAL).toBe('1d')
  })

  it('splits intraday at the day boundary', () => {
    expect(isIntraday('30m')).toBe(true)
    expect(isIntraday('1h')).toBe(true)
    expect(isIntraday('1d')).toBe(false)
    expect(isIntraday('1wk')).toBe(false)
  })
})

describe('isBarInterval', () => {
  it('accepts every id it knows and nothing else', () => {
    for (const interval of BAR_INTERVALS) expect(isBarInterval(interval)).toBe(true)
    // `60m` deliberately isn't one of ours even though Yahoo answers with it — the
    // aliasing lives in `intervalMatches`, so there's exactly one spelling to store.
    for (const other of ['60m', '1y', 'daily', '', null, undefined, 5, {}]) {
      expect(isBarInterval(other)).toBe(false)
    }
  })
})

describe('intervalMatches', () => {
  it('treats 60m and 1h as the same interval, both ways round', () => {
    expect(intervalMatches('60m', '1h')).toBe(true)
    expect(intervalMatches('1h', '1h')).toBe(true)
  })

  it('rejects a genuine mismatch', () => {
    // The case this exists for: a URL missing `interval=` returns 3mo bars for a
    // range=max request, which parses perfectly and is not what was asked for.
    expect(intervalMatches('3mo', '1d')).toBe(false)
    expect(intervalMatches('1d', '1wk')).toBe(false)
  })
})

describe('inferInterval', () => {
  /** Bars every `step` seconds, starting at an arbitrary epoch. */
  const evenly = (step: number, count: number): number[] =>
    Array.from({ length: count }, (_, i) => 1_700_000_000 + i * step)

  it.each([
    ['1m', 60],
    ['5m', 300],
    ['1h', 3_600],
    ['1d', day],
    ['1wk', 7 * day],
  ] as const)('recognises %s from evenly spaced bars', (expected, step) => {
    expect(inferInterval(evenly(step, 20))).toBe(expected)
  })

  it('recognises daily bars despite weekends', () => {
    // A real daily series is mostly 1-day gaps with a 3-day gap every five bars, which
    // is why the median is used rather than the mean.
    const times: number[] = [1_700_000_000]
    for (let week = 0; week < 6; week++) {
      for (const step of [day, day, day, day, 3 * day]) {
        times.push(times[times.length - 1]! + step)
      }
    }
    expect(inferInterval(times)).toBe('1d')
  })

  it('recognises monthly and quarterly bars, whose lengths vary', () => {
    // Calendar months are 28–31 days and quarters 90–92, so neither matches its nominal
    // length exactly. Closest-ratio still lands on the right one.
    const monthly = [0, 31, 59, 90, 120, 151, 181].map((d) => 1_700_000_000 + d * day)
    expect(inferInterval(monthly)).toBe('1mo')

    const quarterly = [0, 90, 181, 273, 365, 455].map((d) => 1_700_000_000 + d * day)
    expect(inferInterval(quarterly)).toBe('3mo')
  })

  it('has no opinion about too few bars', () => {
    // Two bars are one gap, which could be anything. Guessing from it would be worse
    // than saying nothing, because the interval sets the split tolerance.
    expect(inferInterval([])).toBeUndefined()
    expect(inferInterval([1_700_000_000])).toBeUndefined()
    expect(inferInterval([1_700_000_000, 1_700_086_400])).toBeUndefined()
  })

  it('returns the fallback instead of nothing, when given one', () => {
    expect(inferInterval([1_700_000_000], '1d')).toBe('1d')
  })

  it('ignores non-advancing timestamps rather than reading them as zero-length bars', () => {
    const times = [0, day, day, 2 * day, 3 * day, 4 * day].map((s) => 1_700_000_000 + s)
    expect(inferInterval(times)).toBe('1d')
  })
})
