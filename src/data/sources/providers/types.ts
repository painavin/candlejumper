import type { BarInterval, OhlcvBar } from '@shared/contracts/index.js'

/**
 * What a price provider is, from a downloading source's point of view.
 *
 * **One provider, one source.** Each provider is registered as its own
 * `PriceSeriesSource`, so choosing where data comes from is the same act as choosing
 * a ticker's source — the dropdown that already exists — rather than a hidden
 * preference inside a source that serves several. An earlier version tried each
 * provider in turn and used whichever answered; that made the app decide something
 * the player should, and it meant two downloads of the same symbol could quietly hold
 * different data depending on which endpoint was up that day.
 *
 * Everything here is **pure**. A provider builds a URL and parses text; it never
 * performs I/O, which is what lets each one be tested against a captured response.
 */

export interface ProviderRequest {
  /** Host, or a same-origin proxy path in dev. */
  base: string
  /** Already normalised by the source: trimmed and upper-cased. */
  symbol: string
  /** Guaranteed by the source to be one this provider lists in `intervals`. */
  interval: BarInterval
}

export interface PriceProvider {
  id: string
  displayName: string
  /** Where it lives, absent a proxy. */
  baseUrl: string
  /**
   * Whether the series it returns is adjusted for splits and dividends.
   *
   * Recorded per provider rather than assumed, and carried into `TickerMeta.adjusted`
   * so the claim travels with the data. See docs/data-sources.md#on-adjustment.
   */
  adjusted: boolean
  /**
   * Intervals this provider serves, finest first.
   *
   * Declared rather than assumed, because they genuinely differ: Yahoo's chart endpoint
   * spans minutes to quarters, while only Stooq's daily form has been observed to work.
   * The source refuses an interval a provider doesn't list, and the picker never offers
   * one — a request that comes back as an error body is a worse answer than an option
   * that was never there.
   */
  intervals: readonly BarInterval[]
  /**
   * The **whole** history for a symbol at one interval.
   *
   * No span parameter, by design: every bar a provider offers is a bar worth keeping,
   * and a source that asks for less has to decide how much less on the player's
   * behalf. Narrowing what gets *played* is `data.dateRange`, decided later.
   *
   * "Whole" is bounded by the interval, not by choice — a provider that only keeps a
   * week of minute bars can only be asked for a week of them.
   */
  url(request: ProviderRequest): string
  /**
   * `interval` is what was *asked for*, so the parser can refuse a response that is
   * something else. Defaulted rather than required so a recorded fixture reads naturally
   * in a test.
   */
  parse(text: string, symbol: string, interval?: BarInterval): OhlcvBar[]
  /**
   * Whether `text` is this provider's own response body, and which symbol it names.
   *
   * Returns `undefined` for anything that isn't this format. Otherwise the symbol and
   * interval the payload names — either may be absent, and the caller falls back to the
   * filename and to inferring the interval from the timestamps.
   *
   * This exists so a response the player fetched **by hand** can be imported. CORS
   * stops script from reading these endpoints, but it does not stop a person opening
   * the URL in a tab — so "download it yourself and import the file" is a real escape
   * hatch from a built bundle with no proxy and no extension, and it only works if the
   * importer can recognise what comes back. Reading the symbol from the payload rather
   * than the filename matters because browsers name saved files unhelpfully, and an
   * import landing under the wrong ticker is silent.
   *
   * Optional: a provider whose response is already an importable format needs none.
   * Stooq returns plain CSV, which `parseCsvBars` handles as-is.
   */
  recognise?(text: string): { symbol?: string; interval?: BarInterval } | undefined
}
