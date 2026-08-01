import { describe, expect, it } from 'vitest'
import type { DatasetCache, HttpTransport, OhlcvBar } from '@shared/contracts/index.js'
import { HttpRequestError, isDownloadable } from '@shared/contracts/index.js'
import { createLibrarySource, DownloadFailure } from './library.js'
import { createSourceRegistry } from './registry.js'
import { stooqProvider, yahooChartUrl, yahooProvider } from './providers/index.js'

/**
 * The library. Four properties carry the weight:
 *
 *   - one cache keyed by symbol, whatever produced the entry, newest write winning;
 *   - the *player* names the provider — nothing falls back;
 *   - every bar the provider returned is kept, with no span and no trimming;
 *   - playing reads the cache and never the network, which is what makes a series
 *     replay identically and personal bests comparable.
 */

const bar = (t: number, c: number): Record<string, number> => ({
  o: c,
  h: c + 1,
  l: c - 1,
  c,
  v: 1_000,
  t,
})

/** A response in Yahoo's shape, so the real provider's parsing path is exercised. */
function yahooBody(rows: readonly Record<string, number>[]): string {
  return JSON.stringify({
    chart: {
      result: [
        {
          timestamp: rows.map((row) => row.t),
          indicators: {
            quote: [
              {
                open: rows.map((row) => row.o),
                high: rows.map((row) => row.h),
                low: rows.map((row) => row.l),
                close: rows.map((row) => row.c),
                volume: rows.map((row) => row.v),
              },
            ],
            adjclose: [{ adjclose: rows.map((row) => row.c) }],
          },
        },
      ],
      error: null,
    },
  })
}

const SERIES = [bar(1_700_000_000, 100), bar(1_700_086_400, 101), bar(1_700_172_800, 102)]

/**
 * Two bars eight years apart, which is the point: nothing narrows them to a window.
 * The prices sit close together because a big jump between consecutive bars is what an
 * unadjusted split looks like, and `validateBars` rejects it.
 */
const STOOQ_CSV = [
  'Date,Open,High,Low,Close,Volume',
  '2015-01-02,10,11,9,10,1000',
  '2023-11-15,12,13,11,12,1100',
].join('\n')

interface Fake extends HttpTransport {
  readonly calls: string[]
}

/** Routes by URL, so one transport can serve both providers. */
function fakeTransport(bodies: Record<string, string | Error>): Fake {
  const calls: string[] = []
  return {
    calls,
    async get(url) {
      calls.push(url)
      const key = url.includes('stooq') ? 'stooq' : 'yahoo'
      const body = bodies[key]
      if (body === undefined) throw new HttpRequestError('status', 'HTTP 404', 404)
      if (body instanceof Error) throw body
      return body
    },
  }
}

function memoryCache(initial: Record<string, unknown> = {}): DatasetCache {
  let stored = JSON.parse(JSON.stringify(initial)) as Record<string, unknown>
  return {
    async load() {
      return JSON.parse(JSON.stringify(stored))
    },
    async save(entries) {
      stored = JSON.parse(JSON.stringify(entries))
    },
  }
}

const BOTH = { yahoo: yahooBody(SERIES), stooq: STOOQ_CSV }

const libraryOver = (transport: HttpTransport, cache: DatasetCache) =>
  createLibrarySource({
    transport,
    cache,
    baseUrls: { yahoo: '/yahoo', stooq: '/stooq' },
    now: () => 1_700_000_000_000,
  })

describe('the provider is chosen, never guessed', () => {
  it('fetches from the named provider and nowhere else', async () => {
    const transport = fakeTransport(BOTH)
    const library = libraryOver(transport, memoryCache())

    const meta = await library.download({ symbol: 'INTC', providerId: 'stooq', interval: '1d' })
    expect(meta.displayName).toBe('INTC · Daily — Stooq')
    expect(transport.calls).toEqual(['/stooq/q/d/l/?s=intc.us&i=d'])
  })

  it('fails rather than trying another provider when the named one is throttled', async () => {
    // The old behaviour was to fall through to the next provider, which decided on the
    // player's behalf where their data came from. Selection makes the 429 actionable
    // instead: the message says to pick the other one.
    const transport = fakeTransport({
      yahoo: new HttpRequestError('status', 'HTTP 429', 429),
      stooq: STOOQ_CSV,
    })
    const library = libraryOver(transport, memoryCache())

    await expect(library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1d' })).rejects.toThrow(
      /rate-limiting/
    )
    expect(transport.calls).toHaveLength(1)
    expect(await library.listTickers()).toEqual([])
  })

  it('offers the providers it can fetch from, for the picker', () => {
    const { providers } = libraryOver(fakeTransport({}), memoryCache())
    expect(providers.map(({ id, displayName }) => ({ id, displayName }))).toEqual([
      { id: 'yahoo', displayName: 'Yahoo Finance' },
      { id: 'stooq', displayName: 'Stooq' },
    ])
    // Per provider, because they differ: Stooq's non-daily forms are unverified.
    expect(providers.find((entry) => entry.id === 'stooq')?.intervals).toEqual(['1d'])
    expect(providers.find((entry) => entry.id === 'yahoo')?.intervals).toContain('5m')
  })

  it('refuses a provider it does not have', async () => {
    const library = libraryOver(fakeTransport(BOTH), memoryCache())
    await expect(library.download({ symbol: 'INTC', providerId: 'nope', interval: '1d' })).rejects.toThrow(
      /No price provider called "nope"/
    )
  })
})

describe('one library, keyed by symbol', () => {
  it('replaces the entry when the same symbol arrives from another provider', async () => {
    // A symbol names a series. Two entries for one ticker would turn "what do I have?"
    // into one question per provider, with nothing on screen explaining the duplicate.
    const library = libraryOver(fakeTransport(BOTH), memoryCache())
    await library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1d' })
    expect(await library.loadSeries('INTC')).toHaveLength(3)

    const meta = await library.download({ symbol: 'INTC', providerId: 'stooq', interval: '1d' })
    expect((await library.listTickers()).map((entry) => entry.symbol)).toEqual(['INTC@1d'])
    expect(meta.displayName).toBe('INTC · Daily — Stooq')
    expect(await library.loadSeries('INTC')).toHaveLength(2)
  })

  it('records which provider produced the entry that is actually stored', async () => {
    const cache = memoryCache()
    const library = libraryOver(fakeTransport(BOTH), cache)
    await library.download({ symbol: 'INTC', providerId: 'stooq', interval: '1d' })
    expect((await cache.load())['INTC@1d']).toMatchObject({ provider: 'stooq', adjusted: true })
  })

  it('normalises the symbol, so "aapl" and "AAPL" are one entry', async () => {
    const library = libraryOver(fakeTransport(BOTH), memoryCache())
    await library.download({ symbol: ' aapl ', providerId: 'yahoo', interval: '1d' })
    expect((await library.listTickers()).map((entry) => entry.symbol)).toEqual(['AAPL@1d'])
    expect(await library.loadSeries('aapl')).toHaveLength(3)
  })
})

describe('download', () => {
  it('keeps every bar the provider returned', async () => {
    // No span, and no trimming afterwards. The Stooq fixture spans 2015 to 2023.
    const library = libraryOver(fakeTransport(BOTH), memoryCache())
    const meta = await library.download({ symbol: 'INTC', providerId: 'stooq', interval: '1d' })
    expect(meta.barCount).toBe(2)
    expect(meta.firstBarTime).toBe(Date.UTC(2015, 0, 2) / 1000)
    expect(meta.lastBarTime).toBe(Date.UTC(2023, 10, 15) / 1000)
  })

  it('asks Yahoo for its whole history', async () => {
    const transport = fakeTransport(BOTH)
    await libraryOver(transport, memoryCache()).download({ symbol: 'MSFT', providerId: 'yahoo', interval: '1d' })
    expect(transport.calls[0]).toBe(
      '/yahoo/v8/finance/chart/MSFT?interval=1d&range=max&includeAdjustedClose=true'
    )
  })

  it('refuses an empty symbol without making a request', async () => {
    const transport = fakeTransport(BOTH)
    await expect(
      libraryOver(transport, memoryCache()).download({ symbol: '   ', providerId: 'yahoo', interval: '1d' })
    ).rejects.toThrow(/Enter a ticker symbol/)
    expect(transport.calls).toEqual([])
  })

  it('rejects a response that would not pass dataset validation', async () => {
    // Held to the standard the bundled files are: this one has a 90% single-bar drop,
    // which is what an unadjusted split looks like.
    const broken = yahooBody([bar(1_700_000_000, 400), bar(1_700_086_400, 40)])
    const library = libraryOver(fakeTransport({ yahoo: broken }), memoryCache())
    await expect(library.download({ symbol: 'BAD', providerId: 'yahoo', interval: '1d' })).rejects.toThrow(
      /unadjusted split/
    )
  })
})

describe('importFile', () => {
  it('adopts a CSV, taking the symbol from the filename', async () => {
    const library = libraryOver(fakeTransport({}), memoryCache())
    const meta = await library.importFile({ name: 'nke.csv', text: STOOQ_CSV })

    expect(meta.symbol).toBe('NKE@1d')
    expect(meta.barCount).toBe(2)
    expect(meta.displayName).toBe('NKE · Daily — imported file')
    expect(await library.loadSeries('NKE')).toHaveLength(2)
  })

  it('adopts a JSON file through the same button', async () => {
    const bars = [bar(1_700_000_000, 10), bar(1_700_086_400, 11)]
    const library = libraryOver(fakeTransport({}), memoryCache())
    const meta = await library.importFile({ name: 'TSLA.Daily.json', text: JSON.stringify(bars) })
    expect(meta.symbol).toBe('TSLA@1d')
    expect(meta.barCount).toBe(2)
  })

  it('lands in the same library, replacing a downloaded entry', async () => {
    const library = libraryOver(fakeTransport(BOTH), memoryCache())
    await library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1d' })
    await library.importFile({ name: 'INTC.csv', text: STOOQ_CSV })

    expect((await library.listTickers()).map((entry) => entry.symbol)).toEqual(['INTC@1d'])
    expect(await library.loadSeries('INTC')).toHaveLength(2)
  })

  it('reports an imported series as unadjusted unless the file said otherwise', async () => {
    const library = libraryOver(fakeTransport({}), memoryCache())
    const plain = await library.importFile({ name: 'A.csv', text: STOOQ_CSV })
    expect(plain.adjusted).toBe(false)

    const withAdjClose = [
      'Date,Open,High,Low,Close,Adj Close',
      '2023-11-13,400,404,396,400,100',
      '2023-11-14,101,102,100,101,101',
    ].join('\n')
    const adjusted = await library.importFile({ name: 'B.csv', text: withAdjClose })
    expect(adjusted.adjusted).toBe(true)
  })

  it('holds an imported file to the same validation as a download', async () => {
    const unadjustedSplit = [
      'Date,Open,High,Low,Close',
      '2023-11-13,400,404,396,400',
      '2023-11-14,101,102,100,101',
    ].join('\n')
    const library = libraryOver(fakeTransport({}), memoryCache())
    await expect(library.importFile({ name: 'X.csv', text: unadjustedSplit })).rejects.toThrow(
      /unadjusted split/
    )
  })

  it('says so when a file yields no symbol', async () => {
    const library = libraryOver(fakeTransport({}), memoryCache())
    await expect(library.importFile({ name: '.csv', text: STOOQ_CSV })).rejects.toThrow(
      /work out a ticker symbol/
    )
  })
})

describe('playing', () => {
  it('reads the cache and never the network', async () => {
    // The property personal-best comparison depends on. A source that re-fetched at
    // run start would give the same configuration a different series each day.
    const transport = fakeTransport(BOTH)
    const library = libraryOver(transport, memoryCache())
    await library.download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })
    const afterDownload = transport.calls.length

    await library.loadSeries('AAPL')
    await library.loadSeries('AAPL')
    expect(transport.calls).toHaveLength(afterDownload)
  })

  it('honours a date range, in epoch seconds', async () => {
    // Narrowing what gets *played* lives here rather than at download time, so it can
    // change without re-fetching anything.
    const library = libraryOver(fakeTransport(BOTH), memoryCache())
    await library.download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })
    const bars = await library.loadSeries('AAPL', { from: 1_700_086_400, to: 1_700_172_800 })
    expect(bars.map((entry: OhlcvBar) => entry.t)).toEqual([1_700_086_400, 1_700_172_800])
  })

  it('names both ways out when the ticker is not in the library', async () => {
    const library = libraryOver(fakeTransport(BOTH), memoryCache())
    await expect(library.loadSeries('TSLA')).rejects.toThrow(/download or import it/i)
  })
})

describe('persistence', () => {
  it('survives a reload, which is the whole point of caching it', async () => {
    const cache = memoryCache()
    await libraryOver(fakeTransport(BOTH), cache).download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })

    // A second library over the same cache: a fresh app start.
    const reloaded = libraryOver(fakeTransport({}), cache)
    expect((await reloaded.listTickers()).map((entry) => entry.symbol)).toEqual(['AAPL@1d'])
    expect(await reloaded.loadSeries('AAPL')).toHaveLength(3)
  })

  it('fails the download when the cache cannot be written', async () => {
    // localStorage quotas are the expected failure, and a download that silently didn't
    // persist would look like it worked until the next reload.
    const cache: DatasetCache = {
      async load() {
        return {}
      },
      async save() {
        throw new Error('Storage is full')
      },
    }
    const library = libraryOver(fakeTransport(BOTH), cache)
    await expect(library.download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })).rejects.toThrow(
      /Storage is full/
    )
    expect(await library.listTickers()).toEqual([])
  })

  it('keeps the previous entry when a replacement fails to persist', async () => {
    let failing = false
    let stored: Record<string, unknown> = {}
    const cache: DatasetCache = {
      async load() {
        return stored
      },
      async save(entries) {
        if (failing) throw new Error('Storage is full')
        stored = entries
      },
    }
    const library = libraryOver(fakeTransport(BOTH), cache)
    await library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1d' })

    failing = true
    await expect(library.download({ symbol: 'INTC', providerId: 'stooq', interval: '1d' })).rejects.toThrow()
    // Still the three-bar Yahoo version, not the two-bar Stooq one that never stored.
    expect(await library.loadSeries('INTC')).toHaveLength(3)
  })

  it('skips a corrupt cached entry without losing its neighbours', async () => {
    // Everything persisted is untrusted on read. One bad entry must not cost the
    // player the tickers either side of it.
    const cache = memoryCache({
      AAPL: { symbol: 'AAPL', provider: 'yahoo', adjusted: true, downloadedAtMs: 1, bars: SERIES },
      JUNK: { symbol: 'JUNK', bars: [{ o: 'not a number' }] },
      EMPTY: { symbol: 'EMPTY', bars: [] },
      NOTHING: 7,
    })
    const library = libraryOver(fakeTransport({}), cache)
    expect((await library.listTickers()).map((entry) => entry.symbol)).toEqual(['AAPL@1d'])
  })

  it('does not claim an entry was adjusted when it does not say so', async () => {
    // A hand-edited entry, or one written before the field existed. Overclaiming is what
    // would put an invented crash on the chart.
    const cache = memoryCache({
      OLD: { symbol: 'OLD', provider: 'retired', downloadedAtMs: 1, bars: SERIES },
    })
    const [listed] = await libraryOver(fakeTransport({}), cache).listTickers()
    expect(listed?.adjusted).toBe(false)
    expect(listed?.displayName).toContain('retired')
  })
})

describe('forget', () => {
  it('removes the ticker, durably', async () => {
    const cache = memoryCache()
    const library = libraryOver(fakeTransport(BOTH), cache)
    await library.download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })
    await library.forget('aapl')

    expect(await library.listTickers()).toEqual([])
    expect(await libraryOver(fakeTransport({}), cache).listTickers()).toEqual([])
  })

  it('does nothing for a ticker that was never there', async () => {
    const library = libraryOver(fakeTransport(BOTH), memoryCache())
    await expect(library.forget('TSLA')).resolves.toBeUndefined()
  })
})

describe('failure messages', () => {
  it('names the CORS fix when the browser refuses to say what happened', async () => {
    // Without this the message is a bare "Failed to fetch", which reads identically
    // to being offline — and every future networking problem then looks the same.
    const library = libraryOver(
      fakeTransport({ yahoo: new HttpRequestError('unreachable', 'It refuses to say why.') }),
      memoryCache()
    )
    await expect(library.download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })).rejects.toThrow(
      /CORS extension|proxies Yahoo/
    )
  })

  it('suggests another provider when this one is throttling', async () => {
    const library = libraryOver(
      fakeTransport({ yahoo: new HttpRequestError('status', 'HTTP 429', 429) }),
      memoryCache()
    )
    const message = await library
      .download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })
      .then(() => '')
      .catch((error: Error) => error.message)
    expect(message).toContain('Yahoo Finance is rate-limiting')
    expect(message).toContain('pick another provider')
  })
})

describe('createSourceRegistry', () => {
  it('registers the library beside the fixed sources', () => {
    const registry = createSourceRegistry({
      downloads: { transport: fakeTransport({}), cache: memoryCache() },
    })
    expect([...registry.keys()]).toEqual(['bundled', 'synthetic', 'downloaded'])
  })

  it('omits the library entirely when there is nowhere to cache', () => {
    // A headless caller still gets the fixed sources rather than a registry that
    // refuses to be built.
    expect([...createSourceRegistry().keys()]).toEqual(['bundled', 'synthetic'])
  })

  it('marks exactly the library as downloadable', () => {
    const registry = createSourceRegistry({
      downloads: { transport: fakeTransport({}), cache: memoryCache() },
    })
    const downloadable = [...registry.values()].filter(isDownloadable).map((source) => source.id)
    expect(downloadable).toEqual(['downloaded'])
  })

  it('passes the shipped providers through to the library', () => {
    const registry = createSourceRegistry({
      downloads: { transport: fakeTransport({}), cache: memoryCache() },
    })
    const library = [...registry.values()].filter(isDownloadable)[0]
    expect(library?.providers.map((provider) => provider.id)).toEqual([
      yahooProvider.id,
      stooqProvider.id,
    ])
  })
})

/**
 * Importing a response the player fetched themselves.
 *
 * The escape hatch from a built bundle with no dev proxy and no CORS extension: the
 * browser will happily load these URLs in a tab, because CORS governs what script may
 * read rather than where a person may navigate. It only works if the importer
 * recognises what comes back.
 */
describe('importing a hand-fetched provider response', () => {
  /** `yahooBody` carries no `meta`, so this adds the one field recognition reads. */
  const named = (symbol: string, rows: readonly Record<string, number>[]): string => {
    const payload = JSON.parse(yahooBody(rows)) as {
      chart: { result: [Record<string, unknown>] }
    }
    payload.chart.result[0].meta = { symbol }
    return JSON.stringify(payload)
  }

  it('adopts Yahoo’s raw JSON, which is not one of our own formats', async () => {
    const library = libraryOver(fakeTransport({}), memoryCache())
    const meta = await library.importFile({ name: 'chart.json', text: named('MSFT', SERIES) })
    expect(meta.barCount).toBe(SERIES.length)
    expect(await library.loadSeries('MSFT')).toHaveLength(SERIES.length)
  })

  it('files it under the symbol in the payload, not the saved filename', async () => {
    // Browsers name a saved API response after the URL or after nothing useful, and an
    // import landing under the wrong ticker is silent.
    const library = libraryOver(fakeTransport({}), memoryCache())
    const meta = await library.importFile({ name: 'chart.json', text: named('MSFT', SERIES) })
    expect(meta.symbol).toBe('MSFT@1d')
  })

  it('credits Yahoo rather than calling it an imported file', async () => {
    const library = libraryOver(fakeTransport({}), memoryCache())
    const meta = await library.importFile({ name: 'chart.json', text: named('MSFT', SERIES) })
    expect(meta.displayName).toBe('MSFT · Daily — Yahoo Finance')
  })

  it('keeps Yahoo’s adjustment claim, which an anonymous blob would lose', async () => {
    // The whole reason recognition beats treating it as unknown JSON: `adjusted` is the
    // one flag that travels with a series, and reporting adjusted prices as unadjusted
    // is wrong in the direction nothing downstream can detect.
    const library = libraryOver(fakeTransport({}), memoryCache())
    const meta = await library.importFile({ name: 'chart.json', text: named('MSFT', SERIES) })
    expect(meta.adjusted).toBe(true)
  })

  it('still reports an unknown-symbol body in Yahoo’s own words', async () => {
    const failure = JSON.stringify({
      chart: { result: null, error: { code: 'Not Found', description: 'No data found' } },
    })
    const library = libraryOver(fakeTransport({}), memoryCache())
    await expect(library.importFile({ name: 'NOPE.json', text: failure })).rejects.toThrow(
      /No data found/
    )
  })

  it('leaves a plain CSV as an imported file', async () => {
    // Recognition must not reclassify what already worked.
    const library = libraryOver(fakeTransport({}), memoryCache())
    const meta = await library.importFile({ name: 'nke.csv', text: STOOQ_CSV })
    expect(meta.displayName).toBe('NKE · Daily — imported file')
  })
})

describe('the manual-download link on a failure', () => {
  it('is offered when the browser refuses to say why, and points at the real host', async () => {
    // Not `/yahoo`: a dev-server path is meaningless in a new tab, and this URL exists
    // to be clicked.
    const library = libraryOver(
      fakeTransport({ yahoo: new HttpRequestError('unreachable', 'It refuses to say why.') }),
      memoryCache()
    )
    const error = await library
      .download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })
      .then(() => undefined)
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(DownloadFailure)
    expect((error as DownloadFailure).manualUrl).toBe(
      yahooChartUrl(yahooProvider.baseUrl, 'AAPL', '1d')
    )
    expect((error as DownloadFailure).manualUrl).not.toContain('/yahoo/v8')
  })

  it('is offered on a rate limit too, since a tab is a different request', async () => {
    // Withheld here at first, on the reasoning that throttling is by IP so a tab would
    // be refused identically. Too confident: the window is time-based and may have
    // passed by the time it's clicked, and a tab carries different headers and cookies.
    // Being refused costs two seconds; withholding costs the one route needing nothing
    // installed.
    const library = libraryOver(
      fakeTransport({ yahoo: new HttpRequestError('status', 'HTTP 429', 429) }),
      memoryCache()
    )
    const error = await library
      .download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })
      .then(() => undefined)
      .catch((cause: unknown) => cause)

    expect((error as DownloadFailure).manualUrl).toBe(yahooChartUrl(yahooProvider.baseUrl, 'AAPL', '1d'))
  })

  it('is withheld on a 404, which refuses the symbol rather than the request', async () => {
    // Nothing is at that URL, so opening it by hand finds nothing either.
    const library = libraryOver(
      fakeTransport({ yahoo: new HttpRequestError('status', 'HTTP 404', 404) }),
      memoryCache()
    )
    const error = await library
      .download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })
      .then(() => undefined)
      .catch((cause: unknown) => cause)

    expect((error as DownloadFailure).manualUrl).toBeUndefined()
  })

  it('explains that a tab is not subject to what blocked the app', async () => {
    const library = libraryOver(
      fakeTransport({ yahoo: new HttpRequestError('unreachable', 'It refuses to say why.') }),
      memoryCache()
    )
    const message = await library
      .download({ symbol: 'AAPL', providerId: 'yahoo', interval: '1d' })
      .then(() => '')
      .catch((error: Error) => error.message)
    expect(message).toMatch(/import what it returns/)
  })
})

/**
 * One ticker at several intervals.
 *
 * The reason the cache key changed. `INTC@1d` and `INTC@1wk` are different bars of
 * different length and a different game to play, so keying by symbol alone meant
 * downloading one silently destroyed the other.
 */
describe('a symbol and an interval together name a series', () => {
  /** Rows spaced to match `interval`, so the response is plausible for what was asked. */
  const seriesAt = (stepSeconds: number, count: number, granularity: string): string => {
    const rows = Array.from({ length: count }, (_, i) =>
      bar(1_700_000_000 + i * stepSeconds, 100 + i)
    )
    const payload = JSON.parse(yahooBody(rows)) as {
      chart: { result: [Record<string, unknown>] }
    }
    payload.chart.result[0].meta = { symbol: 'INTC', dataGranularity: granularity }
    return JSON.stringify(payload)
  }

  it('holds both intervals of one ticker at once', async () => {
    const daily = seriesAt(86_400, 3, '1d')
    const weekly = seriesAt(604_800, 4, '1wk')
    const transport: HttpTransport = {
      async get(url) {
        return url.includes('interval=1wk') ? weekly : daily
      },
    }
    const library = libraryOver(transport, memoryCache())

    await library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1d' })
    await library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1wk' })

    expect((await library.listTickers()).map((entry) => entry.symbol)).toEqual([
      'INTC@1d',
      'INTC@1wk',
    ])
    expect(await library.loadSeries('INTC@1d')).toHaveLength(3)
    expect(await library.loadSeries('INTC@1wk')).toHaveLength(4)
  })

  it('names the interval in the label, so two entries for one ticker make sense', async () => {
    // Two rows reading "INTC — Yahoo Finance" would be the duplicate-with-no-explanation
    // problem that keying by provider had.
    const transport: HttpTransport = { get: async () => seriesAt(604_800, 4, '1wk') }
    const meta = await libraryOver(transport, memoryCache()).download({
      symbol: 'INTC',
      providerId: 'yahoo',
      interval: '1wk',
    })
    expect(meta.displayName).toBe('INTC · Weekly — Yahoo Finance')
  })

  it('replaces only the matching interval when re-downloaded', async () => {
    const daily = seriesAt(86_400, 3, '1d')
    const weekly = seriesAt(604_800, 4, '1wk')
    const transport: HttpTransport = {
      async get(url) {
        return url.includes('interval=1wk') ? weekly : daily
      },
    }
    const library = libraryOver(transport, memoryCache())
    await library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1wk' })
    await library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1d' })
    await library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1d' })

    expect((await library.listTickers())).toHaveLength(2)
    expect(await library.loadSeries('INTC@1wk')).toHaveLength(4)
  })

  it('drops one interval and keeps the other', async () => {
    const daily = seriesAt(86_400, 3, '1d')
    const weekly = seriesAt(604_800, 4, '1wk')
    const transport: HttpTransport = {
      async get(url) {
        return url.includes('interval=1wk') ? weekly : daily
      },
    }
    const library = libraryOver(transport, memoryCache())
    await library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1d' })
    await library.download({ symbol: 'INTC', providerId: 'yahoo', interval: '1wk' })

    await library.forget('INTC@1wk')
    expect((await library.listTickers()).map((entry) => entry.symbol)).toEqual(['INTC@1d'])
  })

  it('asks the provider for the interval it was given', async () => {
    const transport = fakeTransport({ yahoo: seriesAt(3_600, 5, '1h') })
    await libraryOver(transport, memoryCache()).download({
      symbol: 'MSFT',
      providerId: 'yahoo',
      interval: '1h',
    })
    // Hourly is capped at two years of history by Yahoo, so the range narrows with it.
    expect(transport.calls[0]).toBe(
      '/yahoo/v8/finance/chart/MSFT?interval=1h&range=2y&includeAdjustedClose=true'
    )
  })

  it('refuses an interval the provider does not serve, rather than substituting one', async () => {
    // Quietly fetching daily when 5-minute was asked for would file the answer to a
    // different question under the player's request.
    const library = libraryOver(fakeTransport(BOTH), memoryCache())
    await expect(
      library.download({ symbol: 'INTC', providerId: 'stooq', interval: '5m' })
    ).rejects.toThrow(/Stooq doesn't serve 5 minutes bars/)
  })
})

describe('a library written before intervals existed', () => {
  /** What the old format looked like: keyed by bare symbol, with no interval field. */
  const legacy = () => ({
    INTC: {
      symbol: 'INTC',
      provider: 'stooq',
      adjusted: true,
      downloadedAtMs: 1_699_000_000_000,
      bars: [bar(1_700_000_000, 100), bar(1_700_086_400, 101)],
    },
  })

  it('is read as daily, because daily is all there was', async () => {
    const library = libraryOver(fakeTransport({}), memoryCache(legacy()))
    expect((await library.listTickers()).map((entry) => entry.symbol)).toEqual(['INTC@1d'])
    expect(await library.loadSeries('INTC@1d')).toHaveLength(2)
  })

  it('keeps its provider and adjustment claim across the move', async () => {
    const library = libraryOver(fakeTransport({}), memoryCache(legacy()))
    const [meta] = await library.listTickers()
    expect(meta?.displayName).toBe('INTC · Daily — Stooq')
    expect(meta?.adjusted).toBe(true)
  })

  it('is re-filed under the composite key on the next write', async () => {
    // The key *is* the migration — no version field, and nothing to run once.
    const cache = memoryCache(legacy())
    const library = libraryOver(fakeTransport(BOTH), cache)
    await library.download({ symbol: 'AAPL', providerId: 'stooq', interval: '1d' })

    const stored = await cache.load()
    expect(Object.keys(stored).sort()).toEqual(['AAPL@1d', 'INTC@1d'])
    expect(stored.INTC).toBeUndefined()
  })

  it('still answers to a bare symbol, so a stored config keeps working', async () => {
    // `config.data.ticker` holds ids written before this change. A bare id reads as
    // daily, which is what it was.
    const library = libraryOver(fakeTransport({}), memoryCache(legacy()))
    expect(await library.loadSeries('INTC')).toHaveLength(2)
  })
})
