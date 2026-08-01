import { describe, expect, it } from 'vitest'
import { validateBars } from '../../validate.js'
import { parseStooqCsv, stooqCsvUrl, stooqProvider, stooqSymbol } from './stooq.js'

/**
 * Stooq's adapter, which is thin on purpose: the parsing is `parseCsvBars`, tested in
 * `seriesFile.test.ts`. What's Stooq's own is the symbol namespacing and the request
 * form — and the latter matters more than it looks, because an earlier version added a
 * date parameter it had never verified and got an HTML page back.
 *
 * These fixtures are **hand-written**, unlike the Yahoo ones, because the environment
 * this was written in can't reach the host. That's the reason the shared parser reads
 * the CSV header rather than assuming a column order.
 */

const request = (over: Partial<Parameters<typeof stooqCsvUrl>[0]> = {}) =>
  stooqCsvUrl({ base: 'https://stooq.com', symbol: 'INTC', interval: '1d', ...over })

describe('stooqSymbol', () => {
  it('lower-cases and adds the US suffix the provider namespaces by', () => {
    expect(stooqSymbol('INTC')).toBe('intc.us')
    expect(stooqSymbol(' aapl ')).toBe('aapl.us')
  })

  it('leaves an already-suffixed symbol alone rather than inventing a second one', () => {
    expect(stooqSymbol('RELIANCE.NS')).toBe('reliance.ns')
  })
})

describe('stooqCsvUrl', () => {
  it('asks for daily bars', () => {
    expect(request()).toBe('https://stooq.com/q/d/l/?s=intc.us&i=d')
  })

  it('carries no date parameters at all', () => {
    // An earlier version appended `&d1=`, assuming the endpoint honoured it, and got an
    // HTML page back. Nothing needs them: the whole history is what's wanted.
    expect(request()).not.toContain('d1')
    expect(request()).not.toContain('d2')
  })

  it('takes a proxied base, which is how the browser build reaches it at all', () => {
    expect(request({ base: '/stooq' })).toBe('/stooq/q/d/l/?s=intc.us&i=d')
  })
})

describe('parseStooqCsv', () => {
  const CSV = [
    'Date,Open,High,Low,Close,Volume',
    '2026-07-22,20.5,21.0,20.1,20.9,30000000',
    '2026-07-23,20.9,21.4,20.8,21.2,28000000',
  ].join('\n')

  it('produces bars that pass the dataset validator', () => {
    expect(validateBars(parseStooqCsv(CSV, 'INTC'))).toEqual([])
  })

  it('names the provider and symbol when the response is not a series', () => {
    // The endpoint answers 200 with a line of prose for an exceeded limit or an unknown
    // symbol, so the message has to say which request it was about.
    expect(() => parseStooqCsv('Exceeded the daily hits limit', 'INTC')).toThrow(
      /Stooq's response for INTC.*Exceeded the daily hits limit/
    )
  })
})

describe('the descriptor', () => {
  it('claims its series is adjusted, which the split check then enforces', () => {
    expect(stooqProvider.adjusted).toBe(true)
  })
})
