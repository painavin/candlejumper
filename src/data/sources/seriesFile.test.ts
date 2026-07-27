import { describe, expect, it } from 'vitest'
import { validateBars } from '../validate.js'
import { parseCsvBars, parseSeriesFile, symbolFromFilename } from './seriesFile.js'

/**
 * Reading a series out of a file.
 *
 * One import handles CSV and JSON, and the format is sniffed from the content rather
 * than the extension — so the cases below feed it deliberately mislabelled and
 * malformed files as well as well-formed ones.
 */

const CSV = [
  'Date,Open,High,Low,Close,Volume',
  '2026-07-22,20.5,21.0,20.1,20.9,30000000',
  '2026-07-23,20.9,21.4,20.8,21.2,28000000',
].join('\n')

const day = (year: number, month: number, date: number): number =>
  Date.UTC(year, month - 1, date) / 1000

describe('symbolFromFilename', () => {
  it('takes everything before the first dot, upper-cased', () => {
    expect(symbolFromFilename('aapl.csv')).toBe('AAPL')
    // Matches the bundled files' own naming, so one of those imports cleanly.
    expect(symbolFromFilename('MSFT.Daily.json')).toBe('MSFT')
  })

  it('ignores a directory prefix', () => {
    expect(symbolFromFilename('/home/me/downloads/NKE.csv')).toBe('NKE')
  })
})

describe('parseSeriesFile', () => {
  it('reads a CSV', () => {
    const parsed = parseSeriesFile({ name: 'INTC.csv', text: CSV })
    expect(parsed.symbol).toBe('INTC')
    expect(parsed.bars).toHaveLength(2)
    expect(validateBars(parsed.bars)).toEqual([])
  })

  it('reads a bare JSON array, which is what the bundled datasets are', () => {
    const bars = [{ o: 10, h: 11, l: 9, c: 10, v: 1, t: day(2026, 7, 22) }]
    const parsed = parseSeriesFile({ name: 'AAPL.Daily.json', text: JSON.stringify(bars) })
    expect(parsed.symbol).toBe('AAPL')
    expect(parsed.bars).toEqual(bars)
  })

  it('reads a wrapped JSON dataset, keeping its symbol and adjustment claim', () => {
    // The shape the library stores, so a dataset moved between machines doesn't arrive
    // anonymous and unadjusted.
    const text = JSON.stringify({
      symbol: 'nke',
      adjusted: true,
      bars: [{ o: 10, h: 11, l: 9, c: 10, v: 1, t: day(2026, 7, 22) }],
    })
    const parsed = parseSeriesFile({ name: 'whatever-i-called-it.json', text })
    expect(parsed.symbol).toBe('NKE')
    expect(parsed.adjusted).toBe(true)
  })

  it('sniffs the format from the content, not the extension', () => {
    // A `.txt` holding CSV works; so does JSON in a file called `.csv`.
    expect(parseSeriesFile({ name: 'INTC.txt', text: CSV }).bars).toHaveLength(2)
    const json = JSON.stringify([{ o: 1, h: 2, l: 1, c: 1, v: 1, t: 1_700_000_000 }])
    expect(parseSeriesFile({ name: 'INTC.csv', text: json }).bars).toHaveLength(1)
  })

  it('says what was wrong with unparseable JSON', () => {
    expect(() => parseSeriesFile({ name: 'x.json', text: '{ nope' })).toThrow(/isn't valid JSON/)
  })

  it('says so when JSON is valid but is not a series', () => {
    expect(() => parseSeriesFile({ name: 'x.json', text: '{"hello":"world"}' })).toThrow(
      /not a series/
    )
  })
})

describe('parseCsvBars', () => {
  it('maps columns by name, not by position', () => {
    const bars = parseCsvBars(CSV, 'INTC.csv').bars
    expect(bars[0]).toEqual({
      o: 20.5,
      h: 21,
      l: 20.1,
      c: 20.9,
      v: 30_000_000,
      // Midnight UTC on the stated date — a daily file carries no time of day, and
      // reading it as local time would shift the series by a day on some machines.
      t: day(2026, 7, 22),
    })
  })

  it('survives a reordered header, which position-based parsing would silently invert', () => {
    const swapped = ['Close,Low,High,Open,Date', '20.9,20.1,21.0,20.5,2026-07-22'].join('\n')
    expect(parseCsvBars(swapped, 'x').bars[0]).toMatchObject({ o: 20.5, h: 21, l: 20.1, c: 20.9 })
  })

  it('accepts any header casing, and quoted cells', () => {
    const shouty = ['"DATE","OPEN","HIGH","LOW","CLOSE"', '"2026-07-22","20.5","21","20.1","20.9"']
    expect(parseCsvBars(shouty.join('\n'), 'x').bars).toHaveLength(1)
  })

  it('accepts the single-letter header our own JSON uses', () => {
    expect(parseCsvBars(['t,o,h,l,c,v', '1700000000,10,11,9,10,5'].join('\n'), 'x').bars).toEqual([
      { o: 10, h: 11, l: 9, c: 10, v: 5, t: 1_700_000_000 },
    ])
  })

  it('accepts a file with no volume column at all', () => {
    const noVolume = ['Date,Open,High,Low,Close', '2026-07-22,20.5,21.0,20.1,20.9'].join('\n')
    expect(parseCsvBars(noVolume, 'x').bars[0]?.v).toBe(0)
  })

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseCsvBars(`${CSV.replace(/\n/g, '\r\n')}\r\n`, 'x').bars).toHaveLength(2)
  })

  it('sorts into strictly increasing time order rather than trusting the file', () => {
    const reversed = [
      'Date,Open,High,Low,Close',
      '2026-07-24,21.2,21.6,20.95,21.05',
      '2026-07-22,20.5,21.0,20.1,20.9',
    ].join('\n')
    const bars = parseCsvBars(reversed, 'x').bars
    expect(bars[0]!.t).toBeLessThan(bars[1]!.t)
  })

  it('drops a repeated date, which carries no new day', () => {
    const dupe = [
      'Date,Open,High,Low,Close',
      '2026-07-22,20.5,21.0,20.1,20.9',
      '2026-07-22,20.5,21.0,20.1,20.9',
    ].join('\n')
    expect(parseCsvBars(dupe, 'x').bars).toHaveLength(1)
  })

  it('skips rows with an unparseable date or price', () => {
    const messy = [
      'Date,Open,High,Low,Close',
      'n/d,n/d,n/d,n/d,n/d',
      '2026-07-22,20.5,21.0,20.1,20.9',
      '2026-07-23,,21.4,20.8,21.2',
    ].join('\n')
    expect(parseCsvBars(messy, 'x').bars).toHaveLength(1)
  })

  describe('dates', () => {
    it('reads an ISO date-time by its date part', () => {
      const withTime = ['Date,Open,High,Low,Close', '2026-07-22 09:30:00,10,11,9,10'].join('\n')
      expect(parseCsvBars(withTime, 'x').bars[0]?.t).toBe(day(2026, 7, 22))
    })

    it('reads slash-separated dates', () => {
      const slashes = ['Date,Open,High,Low,Close', '2026/07/22,10,11,9,10'].join('\n')
      expect(parseCsvBars(slashes, 'x').bars[0]?.t).toBe(day(2026, 7, 22))
    })

    it('reads epoch seconds as seconds', () => {
      const epoch = ['Date,Open,High,Low,Close', '1700000000,10,11,9,10'].join('\n')
      expect(parseCsvBars(epoch, 'x').bars[0]?.t).toBe(1_700_000_000)
    })

    it('reads epoch milliseconds as milliseconds', () => {
      // Told apart by magnitude: no daily price series is dated in the year 5138.
      const epochMs = ['Date,Open,High,Low,Close', '1700000000000,10,11,9,10'].join('\n')
      expect(parseCsvBars(epochMs, 'x').bars[0]?.t).toBe(1_700_000_000)
    })
  })

  describe('an adjusted-close column', () => {
    /**
     * A 4:1 split, in the shape Yahoo's own CSV export uses. This is the most likely
     * file anyone imports, and reading only `Close` would import unadjusted prices —
     * which either trips the split check or, worse, passes it while teaching a crash
     * that never happened.
     */
    const yahooExport = [
      'Date,Open,High,Low,Close,Adj Close,Volume',
      '2023-11-13,400,404,396,400,100,1000000',
      '2023-11-14,101,102,100,101,101,4800000',
    ].join('\n')

    it('applies the ratio to open, high and low as well as the close', () => {
      const { bars } = parseCsvBars(yahooExport, 'AAPL.csv')
      expect(bars[0]).toMatchObject({ o: 100, h: 101, l: 99, c: 100 })
    })

    it('leaves no single-bar crash for the validator to reject', () => {
      expect(validateBars(parseCsvBars(yahooExport, 'x').bars)).toEqual([])
    })

    it('scales volume by the same ratio, so the histogram has no step in it', () => {
      expect(parseCsvBars(yahooExport, 'x').bars[0]?.v).toBe(4_000_000)
    })

    it('reports the series as adjusted, since the file said so', () => {
      expect(parseCsvBars(yahooExport, 'x').adjusted).toBe(true)
    })

    it('reports a plain close-only file as unadjusted', () => {
      // Claiming otherwise is what would put an invented crash on the chart.
      expect(parseCsvBars(CSV, 'x').adjusted).toBe(false)
    })
  })
})

describe('failures', () => {
  const messageFrom = (body: string): string => {
    try {
      parseCsvBars(body, 'INTC')
      return ''
    } catch (error) {
      return (error as Error).message
    }
  }

  it('quotes a plain-text refusal, which is how Stooq reports one', () => {
    // That endpoint answers 200 with a line of prose for an exceeded limit or an
    // unknown symbol, so replacing it with our own guess would discard the reason.
    expect(messageFrom('Exceeded the daily hits limit')).toContain('Exceeded the daily hits limit')
  })

  it('summarises an HTML body rather than quoting markup at the player', () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${'x'.repeat(500)}</html>`
    const message = messageFrom(html)
    expect(message).toContain('web page, not data')
    expect(message).not.toContain('<meta')
    expect(message.length).toBeLessThan(220)
  })

  it('says so for an empty file', () => {
    expect(messageFrom('')).toContain('(empty)')
  })

  it('says so when the header is there but every row is unusable', () => {
    expect(messageFrom('Date,Open,High,Low,Close\nn/d,n/d,n/d,n/d,n/d')).toContain('no usable rows')
  })
})
