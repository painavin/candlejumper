import { describe, expect, it } from 'vitest'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { createBundledSource } from './sources/bundled.js'
import { parseBars, sliceByTime, validateBars } from './validate.js'

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
  it('offers the three documented tickers with their real bar counts', async () => {
    const tickers = await createBundledSource().listTickers()
    expect(tickers.map((t) => t.symbol)).toEqual(['AAPL', 'MSFT', 'NKE'])
    expect(Object.fromEntries(tickers.map((t) => [t.symbol, t.barCount]))).toEqual({
      AAPL: 478,
      MSFT: 480,
      NKE: 480,
    })
  })

  it('loads bars that pass validation', async () => {
    const bars = await createBundledSource().loadSeries('AAPL')
    expect(validateBars(bars)).toEqual([])
  })

  it('loads chronologically, oldest first', async () => {
    const bars = await createBundledSource().loadSeries('MSFT')
    expect(bars[0]!.t).toBeLessThan(bars[bars.length - 1]!.t)
  })

  it('reports timestamps in seconds, not milliseconds', async () => {
    // The unit mismatch that produces dates in 1970 and costs an afternoon.
    const [first] = await createBundledSource().loadSeries('AAPL')
    expect(first!.t).toBeLessThan(4_000_000_000)
    expect(new Date(first!.t * 1000).getUTCFullYear()).toBeGreaterThan(2020)
  })

  it('names the available symbols when asked for one that does not exist', async () => {
    await expect(createBundledSource().loadSeries('TSLA')).rejects.toThrow(/AAPL, MSFT, NKE/)
  })
})
