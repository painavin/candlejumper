import type { DateRange, OhlcvBar, PriceSeriesSource, TickerMeta } from '@shared/contracts/index.js'
import { bundledSymbols, loadBundledJson } from '../datasets.js'
import { parseBars, sliceByTime } from '../validate.js'

/**
 * The bundled source: three JSON files read from disk. Offline, no API keys, no
 * rate limits, and fully reproducible — which matters more than it first
 * appears, since personal-best comparison needs the same ticker to play
 * identically every time.
 *
 * See docs/data-sources.md#bundled-dataset.
 */

/** What each ticker teaches, from the doc's regime table. */
const DESCRIPTIONS: Record<string, string> = {
  AAPL: 'AAPL — uptrend with a deep drawdown',
  MSFT: 'MSFT — choppy and range-bound',
  NKE: 'NKE — sustained downtrend',
}

export const BUNDLED_SOURCE_ID = 'bundled'

export function createBundledSource(): PriceSeriesSource {
  const cache = new Map<string, OhlcvBar[]>()

  async function load(symbol: string): Promise<OhlcvBar[]> {
    const cached = cache.get(symbol)
    if (cached) return cached
    const bars = parseBars(await loadBundledJson(symbol), `bundled:${symbol}`)
    cache.set(symbol, bars)
    return bars
  }

  return {
    id: BUNDLED_SOURCE_ID,
    displayName: 'Bundled datasets',

    async listTickers(): Promise<TickerMeta[]> {
      const symbols = bundledSymbols()
      return Promise.all(
        symbols.map(async (symbol) => {
          const bars = await load(symbol)
          return {
            symbol,
            displayName: DESCRIPTIONS[symbol] ?? symbol,
            barCount: bars.length,
            firstBarTime: bars[0]?.t ?? 0,
            lastBarTime: bars[bars.length - 1]?.t ?? 0,
            // Verified in docs/data-sources.md: the largest single-bar moves
            // present are all plausible real moves, so no split artifacts.
            adjusted: true,
          }
        })
      )
    },

    async loadSeries(symbol: string, range?: DateRange): Promise<OhlcvBar[]> {
      return sliceByTime(await load(symbol), range)
    },
  }
}
