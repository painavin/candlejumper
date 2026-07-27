import type { OhlcvBar } from '@shared/contracts/index.js'

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
   * The **whole** daily history for a symbol.
   *
   * No span parameter, by design: every bar a provider offers is a bar worth keeping,
   * and a source that asks for less has to decide how much less on the player's
   * behalf. Narrowing what gets *played* is `data.dateRange`, decided later.
   */
  url(request: ProviderRequest): string
  parse(text: string, symbol: string): OhlcvBar[]
}
