import type { DateRange, TickerMeta } from '@shared/contracts/index.js'
import type { Prng } from '@shared/math/index.js'

/**
 * What "Surprise me" picks: a packaged ticker, and where in it to start.
 *
 * Pure and separate from `shell.ts` because the arithmetic has two edges that are easy to
 * get wrong and impossible to notice by playing — a series shorter than the start window,
 * and a start landing so close to the end that there is no run left. The composition root
 * is the wrong place for anything with edges.
 */

/**
 * How far into a series a surprise run may begin, in seconds. Two years.
 *
 * The variety comes from **where you start**, and the run then goes to the end of the
 * series. Confining the start to the opening stretch is what keeps that promise meaningful:
 * start later and the run is shorter, until "play to the end" stops being a session and
 * becomes a handful of bars.
 *
 * Two calendar years rather than a bar count, because the datasets span intervals from 30
 * minutes to a day and "the first two years" means the same thing in all of them, where
 * "the first 500 bars" does not.
 */
export const START_WINDOW_SECONDS = 2 * 365.25 * 24 * 60 * 60

/**
 * Bars that must remain after the start point for the run to be worth starting.
 *
 * About a year of daily bars — two minutes at the default two bars a second. Also
 * comfortably above any plausible warm-up preload plus `MIN_PLAYABLE_BARS`, so a surprise
 * run can't be refused for being too short to play.
 *
 * It binds only on short series. Most of the packaged set spans decades, where the two-year
 * window is the tighter constraint by far.
 */
export const MIN_REMAINING_BARS = 250

/**
 * A random start point in the first `START_WINDOW_SECONDS` of `ticker`, running to its end.
 *
 * `undefined` means play the whole series, which is the honest answer for anything too
 * short to carve a start out of — and also a legitimate outcome for a long one, since
 * `firstBarTime` is inside the window.
 *
 * Bar positions are approximated from the time span, because the catalogue deliberately
 * knows a series' bar count and endpoints without having loaded a single bar of it. That's
 * accurate enough for a floor: the error is the difference between calendar time and
 * trading time, which is a constant factor within one series.
 */
export function surpriseStart(ticker: TickerMeta, prng: Prng): DateRange | undefined {
  const span = ticker.lastBarTime - ticker.firstBarTime
  if (!(span > 0) || ticker.barCount <= MIN_REMAINING_BARS) return undefined

  const secondsPerBar = span / Math.max(1, ticker.barCount - 1)
  const latest = Math.min(
    ticker.firstBarTime + START_WINDOW_SECONDS,
    ticker.lastBarTime - MIN_REMAINING_BARS * secondsPerBar
  )
  if (latest <= ticker.firstBarTime) return undefined

  return {
    from: Math.floor(prng.range(ticker.firstBarTime, latest)),
    // Inclusive at both ends in `sliceByTime`, so this keeps the final bar.
    to: ticker.lastBarTime,
  }
}
