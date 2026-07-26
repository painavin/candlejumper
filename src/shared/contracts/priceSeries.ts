import type { OhlcvBar } from './bar.js'

/** What a source can tell the settings dropdown about a symbol. */
export interface TickerMeta {
  symbol: string
  displayName: string
  barCount: number
  /** Epoch seconds. */
  firstBarTime: number
  lastBarTime: number
  /**
   * Split/dividend adjusted? Recorded explicitly rather than implied — an
   * unadjusted 4:1 split reads as a 75% single-bar crash and would teach a
   * pattern that never happened. See docs/data-sources.md#on-adjustment.
   */
  adjusted: boolean
}

/** Inclusive, in epoch seconds. */
export interface DateRange {
  from: number
  to: number
}

/**
 * The game loop never depends on a concrete source, only on this interface.
 * Both methods are async even for the bundled source, so a network-backed
 * source slots in later without changing any call site.
 */
export interface PriceSeriesSource {
  id: string
  displayName: string
  /** Tickers this source can offer; populates the settings dropdown. */
  listTickers(): Promise<TickerMeta[]>
  /** Ordered bars, oldest first. */
  loadSeries(symbol: string, range?: DateRange): Promise<OhlcvBar[]>
}
