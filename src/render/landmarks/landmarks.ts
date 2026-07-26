/**
 * Where the landmarks go, with no Pixi in sight.
 *
 * Split from `landmarkLayer.ts` for the same reason `axis.ts` is split from
 * `axisLayer.ts`: the interesting part is a date calculation, and a date calculation
 * should be testable without a renderer. "Does 31 December → 2 January register as a
 * year boundary" is exactly the kind of thing that's wrong once and then wrong
 * forever.
 */

export type Boundary = 'year' | 'quarter' | 'month'

/**
 * The strongest boundary crossed between two consecutive *played* bars.
 *
 * Bars carry epoch **seconds**; the ×1000 is load-bearing. Comparing two bars that
 * are both already on screen is what makes this leak-free — a landmark derived from
 * the full series could reveal something about bars the player hasn't reached.
 *
 * UTC throughout, deliberately: a local-time reading would put the same bar in
 * different months for two players in different zones, and the date on a daily bar
 * is a label, not a moment.
 */
export function boundaryBetween(previousT: number, currentT: number): Boundary | undefined {
  const previous = new Date(previousT * 1000)
  const current = new Date(currentT * 1000)
  if (previous.getUTCFullYear() !== current.getUTCFullYear()) return 'year'
  const previousQuarter = Math.floor(previous.getUTCMonth() / 3)
  const currentQuarter = Math.floor(current.getUTCMonth() / 3)
  if (previousQuarter !== currentQuarter) return 'quarter'
  if (previous.getUTCMonth() !== current.getUTCMonth()) return 'month'
  return undefined
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Weight per boundary kind: a year change deserves more than a month change. */
export const EMPHASIS: Record<Boundary, { alpha: number; label: (date: Date) => string }> = {
  year: { alpha: 0.5, label: (date) => String(date.getUTCFullYear()) },
  quarter: { alpha: 0.3, label: (date) => `Q${Math.floor(date.getUTCMonth() / 3) + 1}` },
  month: { alpha: 0.16, label: (date) => MONTHS[date.getUTCMonth()] ?? '' },
}
