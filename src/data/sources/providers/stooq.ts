import type { OhlcvBar } from '@shared/contracts/index.js'
import { parseCsvBars } from '../seriesFile.js'
import type { PriceProvider, ProviderRequest } from './types.js'

/**
 * Stooq's daily CSV.
 *
 * A Polish market-data portal, keyless like Yahoo and simpler to consume: the series
 * comes back already adjusted, so there is no ratio to apply. Its value here is being
 * an *alternative* — Yahoo throttles by IP without notice, and when it does, this is a
 * different provider the player can select rather than a wait with nothing to do.
 *
 * The parsing is `parseCsvBars`, the same function the file-import path uses. This
 * endpoint returns an ordinary table of bars, and a second CSV parser existing only
 * because one arrived over HTTP would be two things to keep in step. That parser reads
 * the header rather than assuming a column order, which matters more here than usual:
 * this adapter was written without a captured response to hand.
 */

/**
 * `AAPL` → `aapl.us`.
 *
 * Stooq namespaces by exchange in the symbol itself and lower-cases everything. A
 * symbol that already carries a suffix is passed through, so `RELIANCE.NS` isn't
 * turned into something that means nothing to either provider — it just won't
 * resolve, which is the honest outcome for a market this provider doesn't cover.
 */
export function stooqSymbol(symbol: string): string {
  const lower = symbol.trim().toLowerCase()
  return lower.includes('.') ? lower : `${lower}.us`
}

/**
 * The full daily history, in the **one request form that has been observed to work**.
 *
 * Deliberately carries no date parameters. An earlier version appended `&d1=YYYYMMDD`
 * to limit the span, on the assumption the endpoint honoured it; what came back was an
 * HTML page rather than CSV. Nothing needs them now — every provider returns its whole
 * history and every bar of it is kept.
 */
export function stooqCsvUrl({ base, symbol }: ProviderRequest): string {
  const root = base.replace(/\/+$/, '')
  return `${root}/q/d/l/?s=${encodeURIComponent(stooqSymbol(symbol))}&i=d`
}

export function parseStooqCsv(text: string, symbol: string): OhlcvBar[] {
  return parseCsvBars(text, `Stooq's response for ${symbol}`).bars
}

export const stooqProvider: PriceProvider = {
  id: 'stooq',
  displayName: 'Stooq',
  baseUrl: 'https://stooq.com',
  // Stooq's daily series is adjusted. Claimed here, and *enforced* downstream: an
  // unadjusted split is a >50% single-bar move and `validateBars` rejects the
  // download outright, so a series that installs has no split artifacts in it.
  adjusted: true,
  /**
   * Daily only, and deliberately.
   *
   * Stooq documents `i=w`, `i=m` and `i=q`, and none of them have been *observed* to
   * answer here. That distinction has already cost a debugging round on this endpoint:
   * an unverified `&d1=` parameter returned an HTML page with a 200, which the CSV
   * parser could only report as "not a series of daily bars". Offering an interval that
   * silently returns a web page is worse than not offering it, so these arrive when
   * someone has run the request and seen the answer.
   */
  intervals: ['1d'],
  url: stooqCsvUrl,
  parse: parseStooqCsv,
}
