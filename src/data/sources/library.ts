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
import type { BarInterval } from '@shared/contracts/index.js'
import {
  DEFAULT_INTERVAL,
  HttpRequestError,
  intervalName,
  isBarInterval,
} from '@shared/contracts/index.js'
import { maxBarMoveFor, parseBars, sliceByTime } from '../validate.js'
import { PRICE_PROVIDERS } from './providers/index.js'
import type { PriceProvider } from './providers/index.js'
import { normalizeSymbol } from './providers/yahoo.js'
import { parseSeriesFile, symbolFromFilename } from './seriesFile.js'
import type { NativeFormat } from './seriesFile.js'

/**
 * The library: every series the player has obtained, however they obtained it.
 *
 * ## One library, keyed by symbol *and interval*
 *
 * A symbol and an interval together name a series — `INTC@1d` and `INTC@1wk` coexist,
 * because they are different bars of different length and a different game to play.
 * Downloading `AAPL` daily — from any provider — or importing a file called `AAPL.csv`
 * writes to the same `AAPL@1d` entry, and the newest write wins.
 *
 * Still **not** keyed by provider: that turned one question ("what do I have?") into one
 * per provider, with nothing on screen explaining why the same ticker appeared twice.
 * Interval is different, because the player asked for both and can see why they differ.
 *
 * Replacement is safe because the run fingerprint includes the ticker id — which now
 * carries the interval — plus the dataset's bar count and last bar time (see
 * config/fingerprint.ts). A replaced `AAPL@1d` starts its own personal-best bucket
 * rather than inheriting records set on data that no longer exists, and a weekly AAPL
 * never pools with a daily one.
 *
 * Entries written before intervals existed are keyed by a bare symbol. They're read as
 * daily — which is what they are, since daily was all there was — and rewritten under
 * the composite key on the next save.
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
 * A download fetches the provider's whole history *at the chosen interval* and stores
 * every bar of it. How much that is depends on the interval and not on us: Yahoo keeps
 * a decade of days and about a week of minutes.
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

/**
 * The separator between a ticker and its interval in a library id — `INTC@1wk`.
 *
 * `@` because no symbol contains one: Yahoo's carry `-` and `.` (`BRK-B`,
 * `RELIANCE.NS`), Stooq's carry `.` (`intc.us`), and both survive uppercasing. A
 * separator a symbol could contain would make the id ambiguous to split.
 */
const INTERVAL_SEPARATOR = '@'

/**
 * `INTC` + `1wk` → `INTC@1wk`, the cache key and the id `config.data.ticker` stores.
 *
 * One ticker can be held at several intervals at once and they are genuinely different
 * series — different bars, different volatility, different game. Keying by symbol alone
 * meant downloading INTC weekly silently destroyed INTC daily.
 *
 * Daily is **not** special-cased into a bare `INTC`. It's tempting, since it would leave
 * existing ids untouched, but then one series has two spellings depending on its
 * interval and every comparison has to normalise. One shape, always.
 */
export function datasetKey(symbol: string, interval: BarInterval): string {
  return `${symbol}${INTERVAL_SEPARATOR}${interval}`
}

/**
 * `INTC@1wk` → `{ symbol: 'INTC', interval: '1wk' }`.
 *
 * A key with no separator, or one naming an interval this build doesn't know, is read as
 * daily — that's exactly what a cache entry written before intervals existed looks like,
 * and reading it as daily is correct because daily is all there was.
 */
export function parseDatasetKey(key: string): { symbol: string; interval: BarInterval } {
  const at = key.lastIndexOf(INTERVAL_SEPARATOR)
  if (at === -1) return { symbol: key, interval: DEFAULT_INTERVAL }
  const interval = key.slice(at + 1)
  if (!isBarInterval(interval)) return { symbol: key, interval: DEFAULT_INTERVAL }
  return { symbol: key.slice(0, at), interval }
}

/**
 * A download that failed with somewhere the player can go instead.
 *
 * `manualUrl` is the provider's **real** URL, never the dev proxy path: the point is to
 * be opened in a browser tab, where the response arrives fine because CORS restricts
 * what script may read rather than what a person may navigate to. Set only when
 * fetching it by hand would actually help.
 */
export class DownloadFailure extends Error {
  constructor(
    message: string,
    readonly manualUrl?: string
  ) {
    super(message)
    this.name = 'DownloadFailure'
  }
}

/**
 * A cache entry once it has been read and normalised.
 *
 * `CachedDataset.interval` is optional because entries written before intervals existed
 * don't carry one. In memory it is always known — resolved from the entry or its key — so
 * nothing downstream has to keep asking.
 */
type StoredSeries = CachedDataset & { interval: BarInterval }

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
  let entries: Map<string, StoredSeries> | undefined
  let loading: Promise<Map<string, StoredSeries>> | undefined

  async function loaded(): Promise<Map<string, StoredSeries>> {
    if (entries) return entries
    // Memoised rather than re-entered: `listTickers` and `loadSeries` can both be in
    // flight during a settings change, and two loads would race to populate the map.
    loading ??= cache.load().then((raw) => {
      entries = new Map()
      for (const [key, value] of Object.entries(raw)) {
        /**
         * The key is the migration. A pre-interval entry is keyed `INTC`, which
         * `parseDatasetKey` reads as daily, and it is re-filed under `INTC@1d` here — so
         * nothing is lost and nothing needs a version field. The rewrite reaches storage
         * on the next save; until then the old key simply sits there unread.
         */
        const dataset = readDataset(key, value)
        if (dataset) entries.set(datasetKey(dataset.symbol, dataset.interval), dataset)
      }
      return entries
    })
    return loading
  }

  /**
   * Providers that can recognise their own response body, for hand-fetched imports.
   *
   * Adapted rather than passed through: `seriesFile.ts` takes a structural shape so it
   * doesn't depend on `providers/`, which already depends on it.
   */
  const nativeFormats: NativeFormat[] = providers
    .filter((provider) => provider.recognise !== undefined)
    .map(({ id, adjusted, parse, recognise }) => ({
      id,
      adjusted,
      parse,
      recognise: recognise!,
    }))

  const nameOf = (providerId: string): string =>
    providerId === IMPORTED_PROVIDER_ID
      ? 'imported file'
      : (providers.find((candidate) => candidate.id === providerId)?.displayName ?? providerId)

  const metaOf = (dataset: StoredSeries): TickerMeta => {
    const bars = dataset.bars
    return {
      // The composite id, not the bare ticker: this is what identifies the series and
      // what `config.data.ticker` will hold.
      symbol: datasetKey(dataset.symbol, dataset.interval),
      displayName: `${dataset.symbol} · ${intervalName(dataset.interval)} — ${nameOf(dataset.provider)}`,
      barCount: bars.length,
      firstBarTime: bars[0]?.t ?? 0,
      lastBarTime: bars[bars.length - 1]?.t ?? 0,
      // What was claimed when this entry was written, not what the currently selected
      // provider would claim. See `CachedDataset`.
      adjusted: dataset.adjusted,
    }
  }

  /** Write one entry, rolling back if it can't be persisted. */
  async function store(dataset: StoredSeries): Promise<TickerMeta> {
    const all = await loaded()
    const key = datasetKey(dataset.symbol, dataset.interval)
    const previous = all.get(key)
    all.set(key, dataset)
    try {
      await cache.save(Object.fromEntries(all))
    } catch (cause) {
      // Put the map back the way it was: a library that claims to hold something the
      // next reload won't have is worse than a failed download.
      if (previous) all.set(key, previous)
      else all.delete(key)
      throw cause
    }
    return metaOf(dataset)
  }

  return {
    id: LIBRARY_SOURCE_ID,
    displayName: 'Downloaded & imported',
    providers: providers.map(
      ({ id, displayName, intervals }): SeriesProvider => ({ id, displayName, intervals })
    ),

    async listTickers(): Promise<TickerMeta[]> {
      const all = await loaded()
      return [...all.values()]
        .map(metaOf)
        .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))
    },

    async loadSeries(ticker: string, range?: DateRange): Promise<OhlcvBar[]> {
      /**
       * The id is `SYMBOL@interval`, so only the symbol half is upper-cased — `1wk` and
       * `1mo` are lower-case ids and `INTC@1WK` names nothing.
       */
      const { symbol, interval } = parseDatasetKey(ticker.trim())
      const dataset = (await loaded()).get(datasetKey(normalizeSymbol(symbol), interval))
      if (!dataset) {
        throw new Error(
          `${ticker} isn't in your library. Open Settings → Series to download or import it.`
        )
      }
      return sliceByTime(dataset.bars, range)
    },

    async download({ symbol, providerId, interval }): Promise<TickerMeta> {
      const wanted = normalizeSymbol(symbol)
      if (wanted === '') throw new Error('Enter a ticker symbol to download.')
      const provider = providers.find((candidate) => candidate.id === providerId)
      if (!provider) throw new Error(`No price provider called "${providerId}".`)
      if (!provider.intervals.includes(interval)) {
        // Refused rather than substituted. Quietly fetching daily when weekly was asked
        // for would file the answer to a different question under the player's request.
        throw new Error(
          `${provider.displayName} doesn't serve ${intervalName(interval).toLowerCase()} ` +
            `bars — it offers ${provider.intervals.map(intervalName).join(', ')}.`
        )
      }

      const request = { symbol: wanted, interval }
      const url = provider.url({ base: baseUrls[provider.id] ?? provider.baseUrl, ...request })
      let body: string
      try {
        body = await transport.get(url)
      } catch (cause) {
        // The failure gets the unproxied URL: a dev-server path is useless to open in a
        // tab, and this one is meant to be clicked.
        throw describeTransportFailure(
          cause,
          provider,
          provider.url({ base: provider.baseUrl, ...request })
        )
      }

      return store({
        symbol: wanted,
        interval,
        provider: provider.id,
        adjusted: provider.adjusted,
        downloadedAtMs: now(),
        // Every bar the provider returned, validated to the same standard as the
        // bundled files and otherwise untouched.
        bars: parseBars(provider.parse(body, wanted, interval), `${provider.id}:${wanted}`, {
          maxBarMove: maxBarMoveFor(interval),
        }),
      })
    },

    async importFile(file: TextFile): Promise<TickerMeta> {
      const parsed = parseSeriesFile(file, { nativeFormats })
      const symbol = normalizeSymbol(parsed.symbol ?? symbolFromFilename(file.name))
      if (symbol === '') throw new Error(`Couldn't work out a ticker symbol from "${file.name}".`)

      /**
       * Daily when the file gave nothing to go on.
       *
       * `parseSeriesFile` reads the interval from a recognised provider response and
       * otherwise infers it from the gaps between bars; only a file with too few or too
       * irregular bars leaves it unknown, and daily is both the common case and what
       * every dataset was before intervals existed.
       */
      const interval = parsed.interval ?? DEFAULT_INTERVAL

      return store({
        symbol,
        interval,
        // A recognised provider response records *that* provider, not `imported`: the
        // file genuinely came from Yahoo, and the library entry may as well say so.
        provider: parsed.provider ?? IMPORTED_PROVIDER_ID,
        // Only what the file itself claimed — see `ParsedSeries.adjusted`. A recognised
        // provider response carries that provider's adjustment claim, which is the whole
        // reason recognition beats treating it as an anonymous blob: filing adjusted
        // prices as unadjusted mislabels the one flag that travels with the series.
        adjusted: parsed.adjusted,
        downloadedAtMs: now(),
        // At this interval's tolerance: a monthly file is full of moves a daily
        // threshold reads as unadjusted splits.
        bars: parseBars(parsed.bars, file.name, { maxBarMove: maxBarMoveFor(interval) }),
      })
    },

    async forget(ticker: string): Promise<void> {
      const { symbol, interval } = parseDatasetKey(ticker.trim())
      const all = await loaded()
      if (!all.delete(datasetKey(normalizeSymbol(symbol), interval))) return
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
function readDataset(key: string, value: unknown): StoredSeries | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<CachedDataset>
  if (!Array.isArray(candidate.bars) || candidate.bars.length === 0) return undefined

  const fromKey = parseDatasetKey(key)
  /**
   * The entry's own `interval` wins over the key's, and both fall back to daily.
   *
   * They agree for anything this build wrote. They differ for an entry written before
   * intervals existed — no field, bare-symbol key — which is daily either way, and for a
   * hand-edited file, where trusting the record over the filing is the same rule the rest
   * of this function follows.
   */
  const interval = isBarInterval(candidate.interval) ? candidate.interval : fromKey.interval

  try {
    return {
      symbol: typeof candidate.symbol === 'string' ? candidate.symbol : fromKey.symbol,
      interval,
      provider: typeof candidate.provider === 'string' ? candidate.provider : 'unknown',
      // Absent means an entry written before this field existed, or a hand-edited one.
      // `false` is the safe direction: overclaiming adjustment is what would put an
      // invented crash on the chart.
      adjusted: candidate.adjusted === true,
      downloadedAtMs: Number.isFinite(candidate.downloadedAtMs)
        ? (candidate.downloadedAtMs as number)
        : 0,
      // Validated at this interval's tolerance, not daily's: a stored monthly series is
      // full of moves a daily threshold would call splits.
      bars: parseBars(candidate.bars, `cached:${key}`, { maxBarMove: maxBarMoveFor(interval) }),
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
 *
 * Every failure that isn't a 404 also carries somewhere to go — see `helpful` below.
 */
function describeTransportFailure(
  cause: unknown,
  provider: PriceProvider,
  manualUrl: string
): Error {
  if (!(cause instanceof HttpRequestError)) {
    return cause instanceof Error ? cause : new Error(String(cause))
  }

  /**
   * Offer the manual link unless the endpoint refused *the symbol* rather than *this
   * request*.
   *
   * A 404 says there is nothing at that URL, so opening it by hand finds nothing
   * either. Everything else — a CORS block, a throttle, a bad gateway — is about this
   * request, and a request a person makes from a tab is a different request: different
   * headers, different cookies, and in the case of a rate limit possibly a different
   * time window. Offering it and being refused costs two seconds; withholding it costs
   * the only route that needs nothing installed.
   */
  const helpful = cause.status === 404 ? undefined : manualUrl

  if (cause.failure === 'unreachable') {
    return new DownloadFailure(
      `${cause.message} Either run the dev server, which proxies ${provider.displayName} ` +
        `to a same-origin path, enable a CORS extension for its host, or open the link ` +
        `below and import what it returns — CORS withholds a response from script, not ` +
        `from a tab you opened yourself.`,
      helpful
    )
  }
  if (cause.failure === 'status' && cause.status === 429) {
    return new DownloadFailure(
      `${provider.displayName} is rate-limiting this connection (HTTP 429). It throttles ` +
        `by IP rather than by key, and the window is undocumented — so wait, pick another ` +
        `provider, or try the link below: it may refuse a tab from the same address too, ` +
        `but the window may equally have passed.`,
      helpful
    )
  }
  return new DownloadFailure(cause.message, helpful)
}
