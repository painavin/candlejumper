import { gzipSync } from 'node:zlib'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { createHttpJsonFetcher, datasetOf, jsonFromBytes, parseManifest } from './datasets.js'
import type { JsonFetcher } from './datasets.js'
import { createBundledSource } from './sources/bundled.js'
import { maxBarMoveFor, parseBars, sliceByTime, validateBars } from './validate.js'

const bar = (overrides: Partial<OhlcvBar> = {}): OhlcvBar => ({
  o: 100,
  h: 101,
  l: 99,
  c: 100.5,
  v: 1_000,
  t: 1_700_000_000,
  ...overrides,
})

describe('validateBars', () => {
  it('accepts a well-formed series', () => {
    expect(validateBars([bar(), bar({ t: 1_700_086_400 })])).toEqual([])
  })

  it('rejects a non-monotonic timestamp', () => {
    const problems = validateBars([bar({ t: 200 }), bar({ t: 100 })])
    expect(problems[0]?.message).toContain('not after')
  })

  it('rejects a high below its low', () => {
    expect(validateBars([bar({ h: 90, l: 95 })])[0]?.message).toContain('below low')
  })

  it.each(['o', 'h', 'l', 'c'] as const)('rejects a non-positive %s', (field) => {
    expect(validateBars([bar({ [field]: 0 })])[0]?.message).toContain('must be positive')
  })

  it('rejects a missing field rather than coercing it', () => {
    const broken = { o: 1, h: 1, l: 1, c: 1, v: 1 } as unknown as OhlcvBar
    expect(validateBars([broken])[0]?.message).toContain('t is not a finite number')
  })

  it('flags an unadjusted split as a suspicious single-bar move', () => {
    // A 4:1 split would read as a ~75% crash, and the game would teach a
    // pattern that never happened.
    const problems = validateBars([bar({ c: 400, t: 100 }), bar({ c: 100, t: 200 })])
    expect(problems[0]?.message).toContain('unadjusted split')
  })

  it('does not flag a plausible real crash', () => {
    expect(validateBars([bar({ c: 100, t: 100 }), bar({ c: 84, t: 200 })])).toEqual([])
  })
})

describe('parseBars', () => {
  it('rejects a non-array', () => {
    expect(() => parseBars({}, 'x')).toThrow(/expected an array/)
  })

  it('rejects an empty dataset', () => {
    expect(() => parseBars([], 'x')).toThrow(/empty/)
  })

  it('names the label and the count when it throws', () => {
    expect(() => parseBars([bar({ h: 1, l: 2 })], 'bundled:TEST')).toThrow(
      /bundled:TEST: 1 invalid bar/
    )
  })
})

describe('sliceByTime', () => {
  const bars = [bar({ t: 100 }), bar({ t: 200 }), bar({ t: 300 })]

  it('returns everything when no range is given', () => {
    expect(sliceByTime(bars)).toHaveLength(3)
  })

  it('is inclusive at both ends', () => {
    expect(sliceByTime(bars, { from: 100, to: 200 }).map((b) => b.t)).toEqual([100, 200])
  })
})

describe('the bundled source', () => {
  /**
   * Reads `public/datasets/` off the disk, standing in for `fetch`.
   *
   * A relative-URL `fetch` has nothing to resolve against under Node, and standing up a
   * server here would be testing the server. The strings are the same ones the browser
   * requests, query string included, so the path arithmetic is still under test — and the
   * bytes go through the **real** `jsonFromBytes`, so the gzip path is too.
   */
  const fromDisk: JsonFetcher = async (path) => {
    const [file] = path.split('?')
    const bytes = await readFile(join('public', file!))
    return jsonFromBytes(new Uint8Array(bytes), file!)
  }
  const source = () => createBundledSource({ fetchJson: fromDisk })

  it('builds its catalogue without reading a single dataset', async () => {
    /**
     * The property the whole design exists for. `listTickers` used to load every dataset
     * to count its bars, which downloaded 64 MB before the title screen appeared and
     * exhausted a 4 GB Node heap in this very file.
     *
     * Asserted by counting reads rather than by timing: a fast test that loads everything
     * would pass on a big enough machine and fail nobody's build until it reached a phone.
     */
    const read: string[] = []
    const counting: JsonFetcher = async (path) => {
      read.push(path)
      return fromDisk(path)
    }
    const tickers = await createBundledSource({ fetchJson: counting }).listTickers()

    expect(read).toEqual(['datasets/manifest.json'])
    expect(tickers.length).toBeGreaterThan(100)
  })

  it('offers every dataset on identical terms', async () => {
    // No dataset is special: there is no curated subset and no hand-written description.
    const tickers = await source().listTickers()
    const files = (await readdir(join('public', 'datasets'))).filter(
      (name) => name !== 'manifest.json'
    )
    expect(tickers).toHaveLength(files.length)
    expect(tickers.every((ticker) => ticker.barCount > 0)).toBe(true)
    expect(tickers.every((ticker) => ticker.firstBarTime < ticker.lastBarTime)).toBe(true)
  })

  it('names a series by ticker and interval, so two intervals can coexist', async () => {
    const tickers = await source().listTickers()
    const daily = tickers.find((ticker) => ticker.symbol === 'AAPL@1d')
    expect(daily?.displayName).toBe('AAPL · Daily')
    // The one non-daily file in the set, which the old glob silently ignored entirely.
    const halfHourly = tickers.find((ticker) => ticker.symbol === 'UVIX@30m')
    expect(halfHourly?.displayName).toBe('UVIX · 30 minutes')
  })

  it('loads bars that pass every structural check', async () => {
    // Monotonic timestamps, positive prices, high never below low. These are what a
    // load-time check can actually decide, and they catch corruption.
    const bars = await source().loadSeries('AAPL@1d')
    expect(validateBars(bars, { maxBarMove: Number.POSITIVE_INFINITY })).toEqual([])
  })

  it('does not apply the split heuristic, because real history defeats it', async () => {
    /**
     * The decision made visible. Apple fell 51.9% on 2000-09-29 — a real session, and one
     * of the most instructive bars in the whole dataset. An unadjusted 2:1 split is 50%.
     * The heuristic cannot separate them, so at the daily threshold this series would be
     * offered and then refuse to load.
     *
     * If this ever starts passing, either the dataset changed or the threshold moved, and
     * the reasoning in `bundled.ts` needs revisiting rather than the test deleting.
     */
    const bars = await source().loadSeries('AAPL@1d')
    const problems = validateBars(bars, { maxBarMove: maxBarMoveFor('1d') })
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0]?.message).toContain('unadjusted split')
  })

  it('loads chronologically, oldest first', async () => {
    const bars = await source().loadSeries('MSFT@1d')
    expect(bars[0]!.t).toBeLessThan(bars[bars.length - 1]!.t)
  })

  it('reports timestamps in seconds, not milliseconds', async () => {
    // The unit mismatch that produces dates in 1970 and costs an afternoon.
    const [first] = await source().loadSeries('AAPL@1d')
    expect(first!.t).toBeLessThan(4_000_000_000)
    expect(new Date(first!.t * 1000).getUTCFullYear()).toBeGreaterThan(1990)
  })

  it('agrees with the manifest about every series it lists', async () => {
    // The manifest is committed rather than generated at build time, so the failure mode is
    // a forgotten `npm run datasets`. Checked against real bars for a couple of series
    // rather than all 644, which would reintroduce the memory problem this replaced.
    const tickers = await source().listTickers()
    for (const symbol of ['AAPL@1d', 'UVIX@30m']) {
      const listed = tickers.find((ticker) => ticker.symbol === symbol)
      const bars = await source().loadSeries(symbol)
      expect(listed?.barCount).toBe(bars.length)
      expect(listed?.firstBarTime).toBe(bars[0]!.t)
      expect(listed?.lastBarTime).toBe(bars[bars.length - 1]!.t)
    }
  })

  it('counts what is available when asked for a series that is not', async () => {
    // The count, not the list: 644 symbols in an error message is not help. The symbol is
    // deliberately not a real ticker — the set is broad enough that TSLA is in it.
    await expect(source().loadSeries('NOT_A_TICKER@1d')).rejects.toThrow(
      /No bundled dataset.*\d+ available/
    )
  })

  it('refuses a real ticker at an interval it is not held at', async () => {
    // A symbol and an interval together name a series, so half a match is no match.
    await expect(source().loadSeries('AAPL@1wk')).rejects.toThrow(/No bundled dataset/)
  })

  it('fetches each dataset once, and only the one asked for', async () => {
    const read: string[] = []
    const counting: JsonFetcher = async (path) => {
      read.push(path)
      return fromDisk(path)
    }
    const instance = createBundledSource({ fetchJson: counting })
    await instance.loadSeries('AAPL@1d')
    await instance.loadSeries('AAPL@1d')

    expect(read.filter((path) => path.startsWith('datasets/AAPL'))).toHaveLength(1)
    expect(read.some((path) => path.includes('MSFT'))).toBe(false)
  })

  it('carries the last bar time as a cache key on the request', async () => {
    // public/ names are not content-hashed, and a refreshed dataset reuses its name with
    // different contents — while the fingerprint keys on the manifest's bar count. Without
    // this a stale cached dataset would be played under a bucket describing another series.
    const read: string[] = []
    const counting: JsonFetcher = async (path) => {
      read.push(path)
      return fromDisk(path)
    }
    await createBundledSource({ fetchJson: counting }).loadSeries('AAPL@1d')
    const request = read.find((path) => path.startsWith('datasets/AAPL'))
    expect(request).toMatch(/\?v=\d+$/)
  })

  it('lets a failed manifest be retried rather than caching the failure', async () => {
    // One flaky request at boot must not disable the source for the whole session.
    let attempt = 0
    const flaky: JsonFetcher = async (path) => {
      attempt++
      if (attempt === 1) throw new Error('network')
      return fromDisk(path)
    }
    const instance = createBundledSource({ fetchJson: flaky })
    await expect(instance.listTickers()).rejects.toThrow('network')
    expect((await instance.listTickers()).length).toBeGreaterThan(100)
  })
})

describe('reading compressed bytes', () => {
  /** A fetcher over canned bytes, so the real `createHttpJsonFetcher` can be exercised. */
  const served = (body: Uint8Array) => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(body as BodyInit, { status: 200 })) as typeof globalThis.fetch
    return {
      fetcher: createHttpJsonFetcher('/'),
      restore: () => {
        globalThis.fetch = original
      },
    }
  }

  const bars = [{ o: 1, h: 2, l: 0.5, c: 1.5, v: 10, t: 1_700_000_000 }]

  it('inflates a gzipped body', async () => {
    // The production path, end to end: gzip in, bars out. Datasets are stored compressed to
    // keep the deploy under a static-site size cap — 242 MB of JSON is 63 MB gzipped.
    const { fetcher, restore } = served(new Uint8Array(gzipSync(Buffer.from(JSON.stringify(bars)))))
    try {
      expect(await fetcher('datasets/X.Daily.json.gz')).toEqual(bars)
    } finally {
      restore()
    }
  })

  it('reads a plain body too, whatever the file is called', async () => {
    /**
     * The defence that matters. A CDN that recognises `.gz` and decodes it for us — setting
     * `Content-Encoding` so the browser inflates before this code sees the body — would hand
     * over plain JSON under a `.gz` name. Trusting the extension would then fail on every
     * dataset, with an error pointing nowhere near the cause. Gzip is self-describing, so
     * the bytes are asked instead.
     */
    const { fetcher, restore } = served(new TextEncoder().encode(JSON.stringify(bars)))
    try {
      expect(await fetcher('datasets/X.Daily.json.gz')).toEqual(bars)
    } finally {
      restore()
    }
  })

  it('names the file when the bytes are neither', async () => {
    const { fetcher, restore } = served(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x99, 0x99]))
    try {
      await expect(fetcher('datasets/X.Daily.json.gz')).rejects.toThrow(/decompress/)
    } finally {
      restore()
    }
  })
})

describe('reading a dataset file name', () => {
  const entry = (file: string) => ({ file, barCount: 1, firstBarTime: 1, lastBarTime: 2 })

  it('reads the ticker and the interval the file declares', () => {
    expect(datasetOf(entry('AAPL.Daily.json'))).toMatchObject({ ticker: 'AAPL', interval: '1d' })
    expect(datasetOf(entry('UVIX.Mins30.json'))).toMatchObject({ ticker: 'UVIX', interval: '30m' })
  })

  it('reads a compressed name the same as a plain one', () => {
    expect(datasetOf(entry('AAPL.Daily.json.gz'))).toMatchObject({ ticker: 'AAPL', interval: '1d' })
  })

  it('drops a name it cannot read rather than assuming daily', () => {
    // The interval sets the split tolerance, so a guess is how a monthly series gets
    // rejected for a move that is ordinary over a month — or plays at the wrong cadence.
    expect(datasetOf(entry('AAPL.Fortnightly.json'))).toBeUndefined()
    expect(datasetOf(entry('AAPL.json'))).toBeUndefined()
    expect(datasetOf(entry('.Daily.json'))).toBeUndefined()
  })
})

describe('parseManifest', () => {
  const good = { file: 'AAPL.Daily.json', barCount: 2, firstBarTime: 1, lastBarTime: 2 }

  it('throws when the manifest is not a list, since then there is no catalogue', () => {
    expect(() => parseManifest({}, 'manifest.json')).toThrow(/expected an array/)
  })

  it('drops a bad line rather than the whole catalogue', () => {
    // It arrives over the network and can be stale or truncated. One bad line costs one
    // dataset; failing the lot would present a working game as an empty one.
    const parsed = parseManifest(
      [
        good,
        null,
        'nope',
        { ...good, file: '' },
        { ...good, barCount: 0 },
        { ...good, barCount: 1.5 },
        { ...good, firstBarTime: 'yesterday' },
        { ...good, file: 'AAPL.Fortnightly.json' },
      ],
      'manifest.json'
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ ticker: 'AAPL', interval: '1d', barCount: 2 })
  })
})

describe('maxBarMoveFor', () => {
  it('holds the daily figure for a day and anything finer', () => {
    // The biggest one-day S&P drop is ~15.5% and a single stock can lose 40% on
    // earnings, so 0.5 catches a 2:1 split without flagging a real crash. Finer
    // intervals are not tightened: a minute bar around an announcement moves violently,
    // and a false rejection is worse than a missed check on already-adjusted data.
    for (const interval of ['1m', '5m', '30m', '1h', '1d'] as const) {
      expect(maxBarMoveFor(interval)).toBe(0.5)
    }
  })

  it('widens strictly as the bar gets longer', () => {
    const coarse = (['1d', '1wk', '1mo', '3mo'] as const).map(maxBarMoveFor)
    expect(coarse).toEqual([...coarse].sort((a, b) => a - b))
    expect(new Set(coarse).size).toBe(coarse.length)
  })

  it('tolerates the real quarterly move that started all this', () => {
    // INTC's quarterly series contains a genuine +151% bar — adjusted and unadjusted
    // closes agreeing exactly — which the daily threshold called an unadjusted split
    // eight times over. The check is frankly weak at a quarter, and rejecting real
    // series would be worse.
    expect(maxBarMoveFor('3mo')).toBeGreaterThan(1.51)
    expect(maxBarMoveFor('1d')).toBeLessThan(1.51)
  })

  it('still bites on a 4:1 split at a day', () => {
    // 75% is what an unadjusted 4:1 looks like.
    expect(maxBarMoveFor('1d')).toBeLessThan(0.75)
  })

  it('is what lets a monthly series through validation at all', () => {
    const monthly = [
      bar({ c: 10, t: 1_700_000_000 }),
      // +120%: ordinary over a month, an "unadjusted split" under the daily rule.
      bar({ c: 22, t: 1_702_629_800 }),
    ]
    expect(validateBars(monthly, { maxBarMove: maxBarMoveFor('1mo') })).toEqual([])
    expect(validateBars(monthly, { maxBarMove: maxBarMoveFor('1d') })).toHaveLength(1)
  })
})
