import { describe, expect, it } from 'vitest'
import { validateBars } from '../../validate.js'
import fixture from './yahooChart.fixture.json' with { type: 'json' }
import { normalizeSymbol, parseYahooChart, yahooChartUrl } from './yahoo.js'

/**
 * The provider adapter is pure, so its awkward cases are tested against a **recorded**
 * response rather than a hand-written one. That matters: the fixture was captured
 * from the live endpoint and happens to contain the live partial bar, which is the
 * exact row that breaks a naive parser.
 */

const text = JSON.stringify(fixture)

describe('yahooChartUrl', () => {
  it('asks for the whole daily history, with adjusted closes', () => {
    // `range=max`, always: asking for less would mean deciding how much of a stock's
    // life the player may see, and no single answer is right for every symbol.
    const url = yahooChartUrl('https://query1.finance.yahoo.com', 'AAPL')
    expect(url).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=max&includeAdjustedClose=true'
    )
  })

  it('takes a proxied base, which is how the browser build reaches it at all', () => {
    expect(yahooChartUrl('/yahoo', 'MSFT')).toBe(
      '/yahoo/v8/finance/chart/MSFT?interval=1d&range=max&includeAdjustedClose=true'
    )
  })

  it('tolerates a trailing slash on the base rather than emitting a double one', () => {
    expect(yahooChartUrl('/yahoo/', 'MSFT')).toContain('/yahoo/v8/')
  })

  it('escapes a symbol instead of pasting it into the path', () => {
    expect(yahooChartUrl('/yahoo', 'BRK/B')).toContain('/chart/BRK%2FB?')
  })
})

describe('normalizeSymbol', () => {
  it('upper-cases and trims, and leaves the punctuation real symbols carry', () => {
    expect(normalizeSymbol('  aapl ')).toBe('AAPL')
    expect(normalizeSymbol('brk-b')).toBe('BRK-B')
    expect(normalizeSymbol('reliance.ns')).toBe('RELIANCE.NS')
  })
})

describe('parseYahooChart', () => {
  it('produces bars that pass the dataset validator', () => {
    // The real bar of this: a download is held to exactly the standard the bundled
    // files are, so a source added later can't lower it.
    expect(validateBars(parseYahooChart(text, 'AAPL'))).toEqual([])
  })

  it('drops the live partial bar instead of caching a half-formed day', () => {
    const raw = fixture as unknown as {
      chart: { result: [{ timestamp: number[]; indicators: { quote: [{ close: unknown[] }] } }] }
    }
    const result = raw.chart.result[0]
    const lastTime = result.timestamp[result.timestamp.length - 1]
    // Recorded mid-session: open, high and low are real, the close is null.
    expect(result.indicators.quote[0].close.at(-1)).toBeNull()

    const bars = parseYahooChart(text, 'AAPL')
    expect(bars).toHaveLength(result.timestamp.length - 1)
    expect(bars.at(-1)?.t).not.toBe(lastTime)
  })

  it('carries epoch seconds through unchanged', () => {
    const bars = parseYahooChart(text, 'AAPL')
    // Ten-digit, not thirteen: the whole app treats `t` as seconds.
    expect(String(bars[0]?.t)).toHaveLength(10)
  })

  it('keeps bars in strictly increasing time order', () => {
    const bars = parseYahooChart(text, 'AAPL')
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.t).toBeGreaterThan(bars[i - 1]!.t)
    }
  })

  it('rounds prices rather than storing float artifacts', () => {
    // Storage is what limits how many tickers can be cached, and the raw values are
    // 18 characters each.
    const bars = parseYahooChart(text, 'AAPL')
    expect(String(bars[0]?.o).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6)
  })
})

/** A minimal response in Yahoo's shape, for the cases the recording doesn't contain. */
function response(
  rows: { t: number; o: number; h: number; l: number; c: number; v?: number | null; adj?: number }[]
): string {
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
                volume: rows.map((row) => (row.v === undefined ? 1_000 : row.v)),
              },
            ],
            adjclose: [{ adjclose: rows.map((row) => row.adj ?? row.c) }],
          },
        },
      ],
      error: null,
    },
  })
}

describe('split adjustment', () => {
  /**
   * A 4:1 split: every bar before it reports its raw traded price, and an adjusted
   * close a quarter of it. This is the case that decides whether the whole feature
   * teaches real patterns or invented ones.
   */
  const split = response([
    { t: 1_700_000_000, o: 400, h: 404, l: 396, c: 400, v: 1_000_000, adj: 100 },
    { t: 1_700_086_400, o: 404, h: 408, l: 400, c: 404, v: 1_200_000, adj: 101 },
    { t: 1_700_172_800, o: 101, h: 102, l: 100, c: 101, v: 4_800_000 },
  ])

  it('scales open, high and low by the close ratio, not just the close', () => {
    const [first] = parseYahooChart(split, 'SPLIT')
    expect(first?.c).toBe(100)
    expect(first?.o).toBe(100)
    expect(first?.h).toBe(101)
    expect(first?.l).toBe(99)
  })

  it('leaves no single-bar crash for the validator to reject', () => {
    // Unadjusted, the 400 → 101 step is a 75% move and `validateBars` refuses it —
    // correctly, since a series containing it would teach a crash that never happened.
    expect(validateBars(parseYahooChart(split, 'SPLIT'))).toEqual([])
    expect(validateBars([
      { o: 400, h: 404, l: 396, c: 400, v: 1, t: 1_700_000_000 },
      { o: 101, h: 102, l: 100, c: 101, v: 1, t: 1_700_086_400 },
    ]).length).toBeGreaterThan(0)
  })

  it('divides volume by the same ratio, so the histogram has no step in it', () => {
    // Four times as many shares represent the same money after a 4:1 split. Left
    // raw, the volume pane shows a cliff on a day when nothing happened.
    const bars = parseYahooChart(split, 'SPLIT')
    expect(bars[0]?.v).toBe(4_000_000)
    expect(bars[2]?.v).toBe(4_800_000)
  })

  it('leaves prices alone when there is nothing to adjust', () => {
    const flat = response([{ t: 1_700_000_000, o: 10, h: 11, l: 9, c: 10.5, v: 5 }])
    expect(parseYahooChart(flat, 'FLAT')[0]).toEqual({
      o: 10,
      h: 11,
      l: 9,
      c: 10.5,
      v: 5,
      t: 1_700_000_000,
    })
  })
})

describe('unusable rows', () => {
  it('keeps a bar whose volume is missing, with zero volume', () => {
    // The prices are the point. Dropping a real trading day over an absent share
    // count loses more information than it protects.
    const bars = parseYahooChart(
      response([{ t: 1_700_000_000, o: 10, h: 11, l: 9, c: 10.5, v: null }]),
      'NOVOL'
    )
    expect(bars).toHaveLength(1)
    expect(bars[0]?.v).toBe(0)
  })

  it('drops a repeated timestamp rather than failing the whole download', () => {
    const bars = parseYahooChart(
      response([
        { t: 1_700_000_000, o: 10, h: 11, l: 9, c: 10 },
        { t: 1_700_000_000, o: 10, h: 11, l: 9, c: 10 },
        { t: 1_700_086_400, o: 10, h: 11, l: 9, c: 10 },
      ]),
      'DUPE'
    )
    expect(bars).toHaveLength(2)
  })

  it('drops a non-positive price, which is not a price', () => {
    const bars = parseYahooChart(
      response([
        { t: 1_700_000_000, o: 0, h: 0, l: 0, c: 0 },
        { t: 1_700_086_400, o: 10, h: 11, l: 9, c: 10 },
      ]),
      'ZERO'
    )
    expect(bars).toHaveLength(1)
  })
})

describe('failures', () => {
  it('reports an unknown symbol as a rejection, naming what the provider said', () => {
    // Yahoo answers 200 with an error body here, so this must not read as a parse bug.
    const body = JSON.stringify({
      chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } },
    })
    expect(() => parseYahooChart(body, 'NOPE')).toThrow(/NOPE.*symbol may be delisted/)
  })

  it('says so when the body is not JSON at all', () => {
    expect(() => parseYahooChart('<html>Edge: Too Many Requests</html>', 'AAPL')).toThrow(
      /isn't JSON/
    )
  })

  it('says so when the response carries no bars', () => {
    expect(() => parseYahooChart(response([]), 'EMPTY')).toThrow(/no daily bars/)
  })

  it('says so when every row was unusable', () => {
    const allNull = response([{ t: 1_700_000_000, o: 0, h: 0, l: 0, c: 0 }])
    expect(() => parseYahooChart(allNull, 'DEAD')).toThrow(/no usable bars/)
  })
})
