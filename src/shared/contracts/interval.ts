/**
 * How much time one bar covers.
 *
 * The whole game was daily until now, and "daily" was an assumption rather than a
 * value — spread across a URL that hard-coded `interval=1d`, a cache keyed by symbol
 * alone, and a split heuristic calibrated on one-day moves. This module is that
 * assumption made explicit so the rest can vary with it.
 *
 * ## The ids are Yahoo's
 *
 * Not invented: these are the strings the provider takes and returns, so a response can
 * be checked against what was asked for without a translation table in the middle. The
 * one alias worth knowing is that Yahoo accepts `60m` and `1h` for the same thing and
 * may answer with either — see `intervalMatches`.
 *
 * ## Nominal, not exact
 *
 * `intervalSeconds` is how long a bar *nominally* covers, and no interval is exact: a
 * daily bar spans three days over a weekend, a month is 30.44 days on average, and an
 * hourly bar is missing from a closed market. It's used for ordering the list, for
 * scaling tolerances, and for recognising an interval from the gaps in a file — all
 * places where being roughly right is the requirement.
 */

export type BarInterval =
  | '1m'
  | '2m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '1d'
  | '1wk'
  | '1mo'
  | '3mo'

/** Finest first, which is the order the picker offers them in. */
export const BAR_INTERVALS: readonly BarInterval[] = [
  '1m',
  '2m',
  '5m',
  '15m',
  '30m',
  '1h',
  '1d',
  '1wk',
  '1mo',
  '3mo',
]

/**
 * Daily, which is what every existing dataset is.
 *
 * Also what an interval-less file is assumed to be when its bars are too few or too
 * irregular to tell, and what a pre-interval cache entry migrates to.
 */
export const DEFAULT_INTERVAL: BarInterval = '1d'

const SECONDS: Readonly<Record<BarInterval, number>> = {
  '1m': 60,
  '2m': 120,
  '5m': 300,
  '15m': 900,
  '30m': 1_800,
  '1h': 3_600,
  '1d': 86_400,
  '1wk': 604_800,
  // 30.44 and 91.31 days: the average calendar month and quarter. Nothing here needs a
  // calendar, only a magnitude to compare gaps against.
  '1mo': 2_629_800,
  '3mo': 7_889_400,
}

const NAMES: Readonly<Record<BarInterval, string>> = {
  '1m': '1 minute',
  '2m': '2 minutes',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '30m': '30 minutes',
  '1h': 'Hourly',
  '1d': 'Daily',
  '1wk': 'Weekly',
  '1mo': 'Monthly',
  '3mo': 'Quarterly',
}

/** Nominal seconds one bar covers. See the note above about "nominal". */
export function intervalSeconds(interval: BarInterval): number {
  return SECONDS[interval]
}

/** For a picker or a ticker label. */
export function intervalName(interval: BarInterval): string {
  return NAMES[interval]
}

/** Anything persisted or arriving from a provider is untrusted. */
export function isBarInterval(value: unknown): value is BarInterval {
  return typeof value === 'string' && value in SECONDS
}

/** True below a day, where a bar is a slice of one session rather than a whole one. */
export function isIntraday(interval: BarInterval): boolean {
  return SECONDS[interval] < SECONDS['1d']
}

/**
 * Is `reported` the same interval as `wanted`, allowing for the provider's own aliases?
 *
 * `60m` and `1h` are one interval with two spellings, and Yahoo may answer with either
 * regardless of which was requested. Rejecting perfectly good hourly data over a
 * spelling would be the kind of failure that looks like a broken endpoint.
 */
export function intervalMatches(reported: string, wanted: BarInterval): boolean {
  const canonical = (value: string): string => (value === '60m' ? '1h' : value)
  return canonical(reported) === canonical(wanted)
}

/**
 * Which interval a series of bars looks like, from the gaps between them.
 *
 * Needed because a CSV or a bare JSON array says nothing about its own interval, and
 * getting it wrong matters: the interval sets the split tolerance, so a monthly file
 * read as daily is rejected for moves that are entirely normal at a month.
 *
 * The **median** gap, not the mean, because closed weekends and market holidays are
 * outliers by design — a daily series has plenty of 3-day gaps and the occasional
 * 4-day one. Matching is by closest ratio rather than closest difference, so being out
 * by an hour matters at `1m` and not at `3mo`.
 *
 * `undefined` when there aren't enough bars to have an opinion. Two bars are one gap,
 * which could be anything.
 */
export function inferInterval(
  times: readonly number[],
  fallback?: BarInterval
): BarInterval | undefined {
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length < 3) return fallback

  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]!

  let best: BarInterval = BAR_INTERVALS[0]!
  let bestError = Infinity
  for (const interval of BAR_INTERVALS) {
    // Log-space distance, so "twice as long" counts the same whichever end it's at.
    const error = Math.abs(Math.log(median / SECONDS[interval]))
    if (error < bestError) {
      bestError = error
      best = interval
    }
  }
  return best
}
