import type { BarInterval, OhlcvBar } from '@shared/contracts/index.js'
import { BAR_INTERVALS, DEFAULT_INTERVAL, intervalMatches, isBarInterval } from '@shared/contracts/index.js'
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
 * The largest range each interval can actually be asked for.
 *
 * Two separate constraints meet here, and both are external facts rather than choices:
 *
 *   - **Yahoo caps history by interval.** Fine intervals are only available for a recent
 *     window — roughly 7 days at `1m`, 60 days from `2m` to `30m`, and 730 days at `1h`.
 *     Ask for more and the response is an error body, not a shorter series.
 *   - **`range` is an enumeration, not a duration.** The recorded fixture reports
 *     `validRanges: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max`, so there is no
 *     `7d` or `60d` to ask for. Each interval therefore gets the largest *valid* range
 *     that fits under its cap: `5d` under 7 days, `1mo` under 60, `2y` at exactly 730.
 *
 * The enumeration is measured; the caps are Yahoo's documented limits and are **not**
 * verified here, since the endpoint is unreachable from the test environment. If one is
 * wrong the symptom is loud — an error body, reported verbatim — rather than silent.
 *
 * Daily and coarser take `max`, which is what this endpoint was doing all along.
 */
const RANGE_FOR: Readonly<Record<BarInterval, string>> = {
  '1m': '5d',
  '2m': '1mo',
  '5m': '1mo',
  '15m': '1mo',
  '30m': '1mo',
  '1h': '2y',
  '1d': 'max',
  '1wk': 'max',
  '1mo': 'max',
  '3mo': 'max',
}

/** Every interval this endpoint serves, finest first. */
export const YAHOO_INTERVALS: readonly BarInterval[] = BAR_INTERVALS

/**
 * `AAPL` → the chart URL for as much history as this interval allows.
 *
 * The range is **not** a parameter: it's whatever `RANGE_FOR` says is the most this
 * interval can return, because choosing less would decide how much of a stock's life
 * the player gets to see. What varies is the interval, and only because Yahoo won't
 * serve a decade of minutes.
 *
 * `interval` is required and always sent. Omitting it looks harmless and isn't: Yahoo
 * then picks a granularity to suit the range, which for `range=max` is *three-month*
 * bars — a response that parses cleanly and is not what anyone asked for.
 *
 * `base` is a parameter rather than a constant because the dev server proxies this
 * host to a same-origin path — that's the one way the browser build works without an
 * extension, and it's a composition-root decision, not this module's.
 */
export function yahooChartUrl(base: string, symbol: string, interval: BarInterval): string {
  const root = base.replace(/\/+$/, '')
  const query = `interval=${interval}&range=${RANGE_FOR[interval]}&includeAdjustedClose=true`
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

export function parseYahooChart(
  text: string,
  symbol: string,
  interval: BarInterval = DEFAULT_INTERVAL
): OhlcvBar[] {
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
    | {
        meta?: { dataGranularity?: unknown }
        timestamp?: unknown[]
        indicators?: Record<string, unknown[]>
      }
    | undefined

  /**
   * Refuse a response whose interval isn't the one asked for, by what it says it is.
   *
   * `interval` is **not** optional on this endpoint in the way it looks: omit it and
   * Yahoo picks a granularity to suit the range, which for `range=max` is *three-month*
   * bars. A hand-fetched URL missing it therefore returns something that parses
   * perfectly and is wrong — 168 quarters instead of 11,000 days.
   *
   * Checked here because the failure downstream is actively misleading: quarterly moves
   * routinely exceed 50%, so `validateBars` reports a wall of "likely an unadjusted
   * split" for data whose adjustment is fine and whose real problem is its interval. One
   * sentence naming the granularity and the missing parameter is worth more than eight
   * confident diagnoses of the wrong thing.
   *
   * Tolerates the field being absent rather than requiring it: a response that omits it
   * is judged on its bars, as before. `60m` and `1h` are accepted for each other, since
   * Yahoo answers with either — see `intervalMatches`.
   */
  const granularity = result?.meta?.dataGranularity
  if (typeof granularity === 'string' && !intervalMatches(granularity, interval)) {
    throw new Error(
      `This is ${granularity} data for ${symbol}, not ${interval}. The URL needs ` +
        `interval=${interval} — without it Yahoo chooses an interval to suit the range.`
    )
  }

  const timestamps = result?.timestamp
  const quote = result?.indicators?.quote?.[0] as QuoteArrays | undefined
  if (!Array.isArray(timestamps) || timestamps.length === 0 || !quote) {
    throw new Error(`Yahoo returned no ${interval} bars for ${symbol}.`)
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

/**
 * Is this a chart response — and if so, for what symbol, at what interval?
 *
 * The recogniser for a hand-fetched file, so a response the player saved from a browser
 * tab can be imported. See `PriceProvider.recognise`.
 *
 * Keyed on the `chart` envelope rather than on `result`, so an **error** body still
 * counts as Yahoo's: `parseYahooChart` reports "Yahoo rejected INTC: No data found" for
 * an unknown symbol, which is far more use than the importer's generic "JSON, but not a
 * series".
 *
 * Both fields are read from the payload rather than guessed, and for the same reason:
 * a browser names a saved API response after the URL or after nothing useful, so the
 * filename can't be trusted for the symbol, and the gaps between bars are a weaker
 * signal for the interval than the response simply saying `3mo`. Either may be absent,
 * and the caller falls back — to the filename, and to inference from the timestamps.
 */
export function recogniseYahooChart(
  text: string
): { symbol?: string; interval?: BarInterval } | undefined {
  if (!text.trimStart().startsWith('{')) return undefined
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return undefined
  }
  const chart = (payload as { chart?: unknown }).chart
  if (typeof chart !== 'object' || chart === null) return undefined

  const result = (chart as { result?: unknown }).result
  const first = Array.isArray(result) ? result[0] : undefined
  const meta = (first as { meta?: { symbol?: unknown; dataGranularity?: unknown } } | undefined)
    ?.meta

  // `60m` is Yahoo's other spelling of `1h`, and is not one of our ids.
  const reported = meta?.dataGranularity === '60m' ? '1h' : meta?.dataGranularity
  return {
    symbol: typeof meta?.symbol === 'string' ? normalizeSymbol(meta.symbol) : undefined,
    interval: isBarInterval(reported) ? reported : undefined,
  }
}

export const yahooProvider: PriceProvider = {
  id: YAHOO_PROVIDER_ID,
  displayName: 'Yahoo Finance',
  baseUrl: YAHOO_BASE_URL,
  // Adjusted closes are requested explicitly, and the ratio is carried to the other
  // three prices above — see the adjustment note in `parseYahooChart`.
  adjusted: true,
  intervals: YAHOO_INTERVALS,
  url: ({ base, symbol, interval }: ProviderRequest) => yahooChartUrl(base, symbol, interval),
  parse: parseYahooChart,
  recognise: recogniseYahooChart,
}
