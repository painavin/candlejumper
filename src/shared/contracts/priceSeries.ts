import type { OhlcvBar } from './bar.js'
import type { BarInterval } from './interval.js'

/** What a source can tell the settings dropdown about a symbol. */
export interface TickerMeta {
  /**
   * The source's own identifier for this series, and what `config.data.ticker` stores.
   *
   * Usually the bare ticker. The library encodes the interval into it — `INTC@1wk` —
   * because one ticker can be held at several intervals at once and they are different
   * series. Treat it as opaque: only the source that published it may take it apart.
   */
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

/** A place a series can be downloaded from, as the UI needs to know it. */
export interface SeriesProvider {
  id: string
  displayName: string
  /**
   * Intervals this provider can serve, finest first.
   *
   * Per provider rather than global because they genuinely differ, and offering one
   * that returns an error body would be a worse experience than not offering it.
   */
  intervals: readonly BarInterval[]
}

/** A file the player supplied, already read. */
export interface TextFile {
  name: string
  text: string
}

/**
 * A source whose catalogue the player fills themselves — by downloading, or by
 * importing a file.
 *
 * Deliberately *not* part of `PriceSeriesSource`: the bundled and synthetic sources
 * have a fixed catalogue, and giving them a `download` they'd have to refuse is
 * worse than letting the UI ask whether the capability is there. Feature-detected
 * through `isDownloadable`.
 *
 * The split also states the important property. `loadSeries` reads only what's
 * already cached, so **starting a run never touches the network** — a downloaded
 * ticker replays identically forever, which is what personal-best comparison
 * depends on. Downloading is a separate, explicit act.
 *
 * `download` names its provider explicitly rather than picking one: where data comes
 * from is the player's decision, and `providers` is what the settings screen offers
 * them. There is no fallback between providers — see docs/data-sources.md.
 *
 * `download` and `importFile` land in the **same** library, keyed by symbol alone. One
 * ticker is one dataset whatever produced it, and the newest write wins.
 */
export interface DownloadableSource extends PriceSeriesSource {
  /** Where this source can fetch from. Populates the provider picker. */
  readonly providers: readonly SeriesProvider[]
  download(request: {
    symbol: string
    providerId: string
    interval: BarInterval
  }): Promise<TickerMeta>
  /** Adopt a player-supplied CSV or JSON file. */
  importFile(file: TextFile): Promise<TickerMeta>
  /** Drop a ticker from the library. */
  forget(symbol: string): Promise<void>
}

export function isDownloadable(source: PriceSeriesSource): source is DownloadableSource {
  return typeof (source as Partial<DownloadableSource>).download === 'function'
}

/**
 * One series in the library, as it is cached.
 *
 * `provider` and `adjusted` are stored rather than looked up, because the library is
 * shared: an entry outlives whichever provider or file produced it, and the claim
 * about adjustment has to travel with the data instead of being inferred from
 * whatever source happens to be selected now.
 */
export interface CachedDataset {
  symbol: string
  /** How much time one bar covers. Absent in entries written before intervals. */
  interval?: BarInterval
  /** Provider id, or `imported` for a file. */
  provider: string
  /** Whether these prices are split/dividend adjusted, as claimed at write time. */
  adjusted: boolean
  /** Epoch milliseconds — when it was obtained, not what it covers. */
  downloadedAtMs: number
  bars: OhlcvBar[]
}

/**
 * Where the library lives between sessions.
 *
 * **One cache, not one per provider.** A symbol names a series, and re-downloading it
 * — from anywhere — replaces it. Keying by provider as well would let `AAPL` exist
 * several times over with nothing on screen explaining why, and the run fingerprint
 * already distinguishes the datasets by bar count and last bar time, so a replacement
 * correctly starts its own personal-best bucket rather than inheriting one.
 *
 * A port rather than a direct dependency on `platform/persistence`, because
 * `data/` may only import `@shared` — the same dependency inversion the stop and
 * indicator plugin ports use. `app/` supplies the implementation.
 *
 * Values are `unknown` on the way out on purpose: everything persisted is
 * untrusted on read, and validating a cached dataset is the source's job.
 */
export interface DatasetCache {
  load(): Promise<Record<string, unknown>>
  /**
   * Replace the whole cache.
   *
   * Must **reject** if the write didn't stick. Storage quotas are the expected
   * failure here, and a download that silently fails to persist would look like it
   * worked until the next reload.
   */
  save(entries: Record<string, unknown>): Promise<void>
}
