import type {
  CachedDataset,
  DatasetCache,
  DateRange,
  DownloadableSource,
  HttpTransport,
  OhlcvBar,
  SeriesProvider,
  TextFile,
  TickerMeta,
} from '@shared/contracts/index.js'
import { HttpRequestError } from '@shared/contracts/index.js'
import { parseBars, sliceByTime } from '../validate.js'
import { PRICE_PROVIDERS } from './providers/index.js'
import type { PriceProvider } from './providers/index.js'
import { normalizeSymbol } from './providers/yahoo.js'
import { parseSeriesFile, symbolFromFilename } from './seriesFile.js'

/**
 * The library: every series the player has obtained, however they obtained it.
 *
 * ## One library, keyed by symbol
 *
 * A symbol names a series. Downloading `AAPL` — from any provider — or importing a file
 * called `AAPL.csv` writes to the same entry, and the newest write wins. An earlier
 * version kept a cache per provider so that `AAPL` could exist several times over;
 * that turned one question ("what do I have?") into one per provider, with nothing on
 * screen explaining why the same ticker appeared twice.
 *
 * Replacement is safe because the run fingerprint includes the dataset's bar count and
 * last bar time (see config/fingerprint.ts). A replaced `AAPL` starts its own
 * personal-best bucket rather than inheriting records set on data that no longer
 * exists.
 *
 * ## The player chooses the provider
 *
 * `download` is told which provider to use; it never picks. An earlier version tried
 * each in turn and kept whichever answered first, which decided on the player's behalf
 * where their data came from and meant two downloads of one symbol could hold data
 * from different endpoints depending on which was up that day. Selection also makes a
 * throttled provider *actionable* — the 429 message says to choose the other one,
 * which is something a player can do.
 *
 * ## Download everything, keep everything
 *
 * A download fetches the provider's whole daily history and stores every bar of it.
 * There is no span to choose and nothing is discarded after the fact: every bar a
 * provider offers is a bar worth having. Narrowing what gets *played* is
 * `data.dateRange`, applied at playback, reversible without re-downloading, and
 * already part of the fingerprint.
 *
 * ## Download, then play — never both at once
 *
 * `loadSeries` reads **only** the cache. Starting a run cannot touch the network, so a
 * ticker obtained today replays bar-for-bar identically forever. That isn't caching as
 * an optimisation, it's the property personal-best comparison rests on: a source that
 * re-fetched on every run would hand the same configuration a different series each
 * day, silently, and every record it set would be incomparable.
 *
 * ## Trust
 *
 * Two boundaries, both crossed here. Anything arriving from a provider or a file is
 * validated by `parseBars` before it's stored, so it's held to exactly the standard
 * the bundled files are. And a *cached* entry is validated again on read, because
 * everything persisted is untrusted — a hand-edited or half-written entry is skipped
 * rather than allowed to take the ticker list down with it.
 */

export const LIBRARY_SOURCE_ID = 'downloaded'

/** What an imported file's `provider` field records. */
export const IMPORTED_PROVIDER_ID = 'imported'

export interface LibrarySourceOptions {
  transport: HttpTransport
  cache: DatasetCache
  /**
   * Per-provider base URL overrides, keyed by provider id.
   *
   * The dev server proxies each provider to a same-origin path, which is the one way
   * the browser build works without a CORS extension — see vite.config.ts. Injected
   * rather than read from `import.meta.env` here so this stays a decision the
   * composition root makes.
   */
  baseUrls?: Readonly<Record<string, string>>
  /** Epoch milliseconds. Injected so tests don't depend on a clock. */
  now?: () => number
  /** Defaults to the shipped list. */
  providers?: readonly PriceProvider[]
}

export function createLibrarySource({
  transport,
  cache,
  baseUrls = {},
  now = () => new Date().getTime(),
  providers = PRICE_PROVIDERS,
}: LibrarySourceOptions): DownloadableSource {
  /** Symbol → dataset. Loaded once, then kept in step with every write. */
  let entries: Map<string, CachedDataset> | undefined
  let loading: Promise<Map<string, CachedDataset>> | undefined

  async function loaded(): Promise<Map<string, CachedDataset>> {
    if (entries) return entries
    // Memoised rather than re-entered: `listTickers` and `loadSeries` can both be in
    // flight during a settings change, and two loads would race to populate the map.
    loading ??= cache.load().then((raw) => {
      entries = new Map()
      for (const [symbol, value] of Object.entries(raw)) {
        const dataset = readDataset(symbol, value)
        if (dataset) entries.set(symbol, dataset)
      }
      return entries
    })
    return loading
  }

  const nameOf = (providerId: string): string =>
    providerId === IMPORTED_PROVIDER_ID
      ? 'imported file'
      : (providers.find((candidate) => candidate.id === providerId)?.displayName ?? providerId)

  const metaOf = (dataset: CachedDataset): TickerMeta => {
    const bars = dataset.bars
    return {
      symbol: dataset.symbol,
      displayName: `${dataset.symbol} — ${nameOf(dataset.provider)}`,
      barCount: bars.length,
      firstBarTime: bars[0]?.t ?? 0,
      lastBarTime: bars[bars.length - 1]?.t ?? 0,
      // What was claimed when this entry was written, not what the currently selected
      // provider would claim. See `CachedDataset`.
      adjusted: dataset.adjusted,
    }
  }

  /** Write one entry, rolling back if it can't be persisted. */
  async function store(dataset: CachedDataset): Promise<TickerMeta> {
    const all = await loaded()
    const previous = all.get(dataset.symbol)
    all.set(dataset.symbol, dataset)
    try {
      await cache.save(Object.fromEntries(all))
    } catch (cause) {
      // Put the map back the way it was: a library that claims to hold something the
      // next reload won't have is worse than a failed download.
      if (previous) all.set(dataset.symbol, previous)
      else all.delete(dataset.symbol)
      throw cause
    }
    return metaOf(dataset)
  }

  return {
    id: LIBRARY_SOURCE_ID,
    displayName: 'Downloaded & imported',
    providers: providers.map(({ id, displayName }): SeriesProvider => ({ id, displayName })),

    async listTickers(): Promise<TickerMeta[]> {
      const all = await loaded()
      return [...all.values()]
        .map(metaOf)
        .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))
    },

    async loadSeries(symbol: string, range?: DateRange): Promise<OhlcvBar[]> {
      const dataset = (await loaded()).get(normalizeSymbol(symbol))
      if (!dataset) {
        throw new Error(
          `${symbol} isn't in your library. Open Settings → Series to download or import it.`
        )
      }
      return sliceByTime(dataset.bars, range)
    },

    async download({ symbol, providerId }): Promise<TickerMeta> {
      const wanted = normalizeSymbol(symbol)
      if (wanted === '') throw new Error('Enter a ticker symbol to download.')
      const provider = providers.find((candidate) => candidate.id === providerId)
      if (!provider) throw new Error(`No price provider called "${providerId}".`)

      const url = provider.url({ base: baseUrls[provider.id] ?? provider.baseUrl, symbol: wanted })
      let body: string
      try {
        body = await transport.get(url)
      } catch (cause) {
        throw describeTransportFailure(cause, provider)
      }

      return store({
        symbol: wanted,
        provider: provider.id,
        adjusted: provider.adjusted,
        downloadedAtMs: now(),
        // Every bar the provider returned, validated to the same standard as the
        // bundled files and otherwise untouched.
        bars: parseBars(provider.parse(body, wanted), `${provider.id}:${wanted}`),
      })
    },

    async importFile(file: TextFile): Promise<TickerMeta> {
      const parsed = parseSeriesFile(file)
      const symbol = normalizeSymbol(parsed.symbol ?? symbolFromFilename(file.name))
      if (symbol === '') throw new Error(`Couldn't work out a ticker symbol from "${file.name}".`)

      return store({
        symbol,
        provider: IMPORTED_PROVIDER_ID,
        // Only what the file itself claimed — see `ParsedSeries.adjusted`.
        adjusted: parsed.adjusted,
        downloadedAtMs: now(),
        bars: parseBars(parsed.bars, file.name),
      })
    },

    async forget(symbol: string): Promise<void> {
      const wanted = normalizeSymbol(symbol)
      const all = await loaded()
      if (!all.delete(wanted)) return
      await cache.save(Object.fromEntries(all))
    },
  }
}

/**
 * A persisted entry, or `undefined` if it isn't one.
 *
 * Deliberately silent about a bad entry rather than throwing: this runs while
 * populating a dropdown, and one corrupt row must not cost the player the tickers
 * either side of it.
 */
function readDataset(symbol: string, value: unknown): CachedDataset | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<CachedDataset>
  if (!Array.isArray(candidate.bars) || candidate.bars.length === 0) return undefined
  try {
    return {
      symbol: typeof candidate.symbol === 'string' ? candidate.symbol : symbol,
      provider: typeof candidate.provider === 'string' ? candidate.provider : 'unknown',
      // Absent means an entry written before this field existed, or a hand-edited one.
      // `false` is the safe direction: overclaiming adjustment is what would put an
      // invented crash on the chart.
      adjusted: candidate.adjusted === true,
      downloadedAtMs: Number.isFinite(candidate.downloadedAtMs)
        ? (candidate.downloadedAtMs as number)
        : 0,
      bars: parseBars(candidate.bars, `cached:${symbol}`),
    }
  } catch {
    return undefined
  }
}

/**
 * Turn a transport failure into something worth reading.
 *
 * Two cases carry real information. `unreachable` is *most likely* a CORS block —
 * Yahoo sends no `Access-Control-Allow-Origin` — but the platform genuinely cannot
 * distinguish that from being offline, so the message names the probable cause and the
 * fixes rather than guessing. And a 429 is worth naming as throttling: it is not a
 * quota you can raise, and the other provider is the way past it, which the player can
 * act on because they chose this one.
 */
function describeTransportFailure(cause: unknown, provider: PriceProvider): Error {
  if (!(cause instanceof HttpRequestError)) {
    return cause instanceof Error ? cause : new Error(String(cause))
  }
  if (cause.failure === 'unreachable') {
    return new Error(
      `${cause.message} Either run the dev server, which proxies ${provider.displayName} ` +
        `to a same-origin path, or enable a CORS extension for its host.`
    )
  }
  if (cause.failure === 'status' && cause.status === 429) {
    return new Error(
      `${provider.displayName} is rate-limiting this connection (HTTP 429). It throttles ` +
        `by IP rather than by key, and the window is undocumented — so either wait, or ` +
        `pick another provider and download it from there.`
    )
  }
  return new Error(cause.message)
}
