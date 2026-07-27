import type { OhlcvBar } from '@shared/contracts/index.js'
import type { PriceProvider, ProviderRequest } from './types.js'

/**
 * The Yahoo Finance chart endpoint, as a pure adapter.
 *
 * No I/O here: a URL builder and a parser, so the interesting part — split
 * adjustment, and which rows are unusable — is tested against a recorded response
 * (`yahooChart.fixture.json`) with no network in the suite.
 *
 * ## Why this endpoint
 *
 * It needs no API key, offers any symbol and any span, and reports adjusted closes.
 * The costs are real and worth stating: it is **undocumented and unofficial**, it can
 * change or start refusing traffic without notice, and it sends no
 * `Access-Control-Allow-Origin`, so a browser will not hand its response to script
 * without a proxy or an extension. See docs/data-sources.md.
 */

export const YAHOO_PROVIDER_ID = 'yahoo'
export const YAHOO_BASE_URL = 'https://query1.finance.yahoo.com'

/**
 * `AAPL` → the chart URL for its whole daily history.
 *
 * `range=max`, always. The endpoint can return a bounded window, but asking for one
 * would mean choosing how much of a stock's life the player gets to see, and there is
 * no answer to that which is right for every symbol.
 *
 * `base` is a parameter rather than a constant because the dev server proxies this
 * host to a same-origin path — that's the one way the browser build works without an
 * extension, and it's a composition-root decision, not this module's.
 *
 * `range` rather than `period1`/`period2` also means no clock, which keeps this
 * function pure and its tests free of a frozen time.
 */
export function yahooChartUrl(base: string, symbol: string): string {
  const root = base.replace(/\/+$/, '')
  const query = 'interval=1d&range=max&includeAdjustedClose=true'
  return `${root}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`
}

/**
 * `AAPL` from ` aapl `. Yahoo symbols carry `-` and `.` (`BRK-B`, `RELIANCE.NS`),
 * both of which survive uppercasing, so this is the whole normalisation.
 */
export function normalizeSymbol(input: string): string {
  return input.trim().toUpperCase()
}

/** Storage is the binding constraint on how many tickers can be cached, and a raw
 * float like `287.3999938964844` costs 18 characters per price. Six decimals is
 * lossless for any price anyone trades and roughly halves the cached size. */
const round = (value: number): number => Math.round(value * 1e6) / 1e6

const finite = (value: unknown): value is number => typeof value === 'number' && isFinite(value)

interface QuoteArrays {
  open?: unknown[]
  high?: unknown[]
  low?: unknown[]
  close?: unknown[]
  volume?: unknown[]
}

export function parseYahooChart(text: string, symbol: string): OhlcvBar[] {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`Yahoo returned something that isn't JSON for ${symbol}.`)
  }

  const chart = (payload as { chart?: Record<string, unknown> }).chart
  const failure = chart?.error as { code?: string; description?: string } | null | undefined
  if (failure) {
    // A 200 response with an error body — how an unknown symbol arrives. Reported as
    // what it is rather than as a parse failure.
    throw new Error(
      `Yahoo rejected ${symbol}: ${failure.description ?? failure.code ?? 'no reason given'}`
    )
  }

  const result = (chart?.result as unknown[] | undefined)?.[0] as
    | { timestamp?: unknown[]; indicators?: Record<string, unknown[]> }
    | undefined
  const timestamps = result?.timestamp
  const quote = result?.indicators?.quote?.[0] as QuoteArrays | undefined
  if (!Array.isArray(timestamps) || timestamps.length === 0 || !quote) {
    throw new Error(`Yahoo returned no daily bars for ${symbol}.`)
  }
  const adjusted = (result?.indicators?.adjclose?.[0] as { adjclose?: unknown[] } | undefined)
    ?.adjclose

  const bars: OhlcvBar[] = []
  let previousTime = -Infinity

  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i]
    const o = quote.open?.[i]
    const h = quote.high?.[i]
    const l = quote.low?.[i]
    const c = quote.close?.[i]

    /**
     * Rows with a null price are dropped rather than repaired.
     *
     * Not hypothetical: the **last** row of a response taken during or just after a
     * session is the live bar, and its close is `null` while its open, high, and low
     * are already real — the recorded fixture contains exactly that. Left in, it
     * fails `parseBars`; filled in from `meta.regularMarketPrice`, it would cache a
     * half-formed bar as though the day had closed. Halted days look the same.
     */
    if (!finite(t) || !finite(o) || !finite(h) || !finite(l) || !finite(c)) continue
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue
    // A repeated or regressing timestamp carries no new day, and would fail the
    // strict-monotonic check downstream. Dropped, not thrown on.
    if (t <= previousTime) continue

    /**
     * Split and dividend adjustment.
     *
     * Yahoo adjusts only the close, so the ratio has to be applied to the other
     * three — otherwise a 4:1 split shows up as a 75% single-bar crash, which
     * `validateBars` correctly refuses, and which would teach a pattern that never
     * happened. Volume is *divided* by the same ratio: post-split share counts are
     * four times pre-split ones, so leaving it raw puts a step change in the volume
     * pane on a day when nothing happened.
     */
    const adj = adjusted?.[i]
    const ratio = finite(adj) && adj > 0 ? adj / c : 1
    const v = quote.volume?.[i]

    bars.push({
      o: round(o * ratio),
      h: round(h * ratio),
      l: round(l * ratio),
      c: round(finite(adj) ? adj : c),
      // A missing volume keeps the bar — the prices are the point, and dropping a
      // real trading day over an absent share count loses more than it protects.
      v: finite(v) && v >= 0 ? Math.round(v / ratio) : 0,
      // Already epoch SECONDS, which is what OhlcvBar.t wants. No conversion.
      t,
    })
    previousTime = t
  }

  if (bars.length === 0) throw new Error(`Yahoo returned no usable bars for ${symbol}.`)
  return bars
}

export const yahooProvider: PriceProvider = {
  id: YAHOO_PROVIDER_ID,
  displayName: 'Yahoo Finance',
  baseUrl: YAHOO_BASE_URL,
  // Adjusted closes are requested explicitly, and the ratio is carried to the other
  // three prices above — see the adjustment note in `parseYahooChart`.
  adjusted: true,
  url: ({ base, symbol }: ProviderRequest) => yahooChartUrl(base, symbol),
  parse: parseYahooChart,
}
