import type { BarInterval, OhlcvBar } from '@shared/contracts/index.js'

/**
 * Dataset validation.
 *
 * The properties checked here are the ones docs/data-sources.md verified about
 * the bundled files, restated as code so a *future* source can't quietly
 * violate them. The split test matters most: an unadjusted 4:1 split appears as
 * a ~75% single-bar crash, and the game would teach a pattern that never
 * happened.
 */

export interface DatasetProblem {
  barIndex: number
  message: string
}

export interface ValidateOptions {
  /**
   * Largest plausible single-bar move, as a fraction. Defaults to the daily figure;
   * `maxBarMoveFor` derives the right one from an interval.
   */
  maxBarMove?: number
}

/**
 * How big a single-bar move stops being plausible, for a given interval.
 *
 * The check exists to catch an **unadjusted split**, which shows up as a ~50% drop for
 * 2:1 or ~75% for 4:1 at any interval. The tolerance has to sit below that and above
 * whatever the market really does in one bar — and what the market really does in one
 * bar depends entirely on how long the bar is:
 *
 *   - **A day or finer**: the biggest one-day S&P drop is ~15.5%, and a single stock can
 *     lose 40% on an earnings miss. 0.5 catches splits and clears real crashes. Finer
 *     intervals are *not* tightened: a minute bar around an announcement can move
 *     violently, and a false rejection is worse than a missed check on data that Yahoo
 *     has already adjusted.
 *   - **Weekly and coarser**: the window is wide enough for real moves to reach split
 *     territory. Measured on the actual data: INTC's quarterly series contains a
 *     genuine +151% bar, with adjusted and unadjusted closes agreeing exactly. So the
 *     tolerance widens, and at a quarter the check is **frankly weak** — it can no
 *     longer separate a split from a real move, and pretending otherwise would reject
 *     real series. That's an acceptable trade only because both providers adjust their
 *     own data, which makes this a safety net rather than the defence.
 */
export function maxBarMoveFor(interval: BarInterval): number {
  switch (interval) {
    case '1wk':
      return 0.8
    case '1mo':
      return 1.5
    case '3mo':
      return 2.5
    default:
      return 0.5
  }
}

/** Parse and validate unknown JSON into bars. Throws on anything unusable. */
export function parseBars(raw: unknown, label: string, options: ValidateOptions = {}): OhlcvBar[] {
  if (!Array.isArray(raw)) throw new Error(`${label}: expected an array of bars`)
  if (raw.length === 0) throw new Error(`${label}: dataset is empty`)

  const bars = raw as OhlcvBar[]
  const problems = validateBars(bars, options)
  if (problems.length > 0) {
    const shown = problems
      .slice(0, 5)
      .map((p) => `  bar ${p.barIndex}: ${p.message}`)
      .join('\n')
    const more = problems.length > 5 ? `\n  …and ${problems.length - 5} more` : ''
    throw new Error(`${label}: ${problems.length} invalid bar(s)\n${shown}${more}`)
  }
  return bars
}

export function validateBars(
  bars: readonly OhlcvBar[],
  { maxBarMove = 0.5 }: ValidateOptions = {}
): DatasetProblem[] {
  const problems: DatasetProblem[] = []
  let previous: OhlcvBar | undefined

  bars.forEach((bar, index) => {
    const bad = (message: string) => problems.push({ barIndex: index, message })

    for (const field of ['o', 'h', 'l', 'c', 'v', 't'] as const) {
      const value = bar?.[field]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        bad(`${field} is not a finite number (${String(value)})`)
        return
      }
    }
    for (const field of ['o', 'h', 'l', 'c'] as const) {
      if (bar[field] <= 0) bad(`${field} must be positive, got ${bar[field]}`)
    }
    if (bar.v < 0) bad(`volume must not be negative, got ${bar.v}`)
    if (bar.h < bar.l) bad(`high (${bar.h}) is below low (${bar.l})`)

    if (previous) {
      if (bar.t <= previous.t) {
        bad(`timestamp ${bar.t} is not after the previous bar's ${previous.t}`)
      }
      const move = Math.abs(bar.c - previous.c) / previous.c
      if (move > maxBarMove) {
        bad(
          `close moved ${(move * 100).toFixed(1)}% in one bar — likely an unadjusted split, not a real move`
        )
      }
    }
    previous = bar
  })

  return problems
}

/** Filter to an inclusive epoch-seconds range. Bars are already chronological. */
export function sliceByTime(
  bars: readonly OhlcvBar[],
  range?: { from: number; to: number }
): OhlcvBar[] {
  if (!range) return [...bars]
  return bars.filter((bar) => bar.t >= range.from && bar.t <= range.to)
}
