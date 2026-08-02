import type { DateRange, OhlcvBar, PriceSeriesSource, TickerMeta } from '@shared/contracts/index.js'
import { intervalName } from '@shared/contracts/index.js'
import {
  createHttpJsonFetcher,
  datasetPath,
  manifestPath,
  parseManifest,
} from '../datasets.js'
import type { BundledDataset, JsonFetcher } from '../datasets.js'
import { datasetKey } from './library.js'
import { parseBars, sliceByTime } from '../validate.js'

/**
 * The bundled source: static JSON served from the site's own origin. No API keys, no rate
 * limits, and the same series every time — which matters more than it first appears, since
 * personal-best comparison needs a ticker to play identically on every run.
 *
 * **The catalogue is the manifest, never the data.** `listTickers` used to load every
 * dataset to count its bars; see `../datasets.ts` for why that stopped being viable and
 * what replaced it. The rule to keep: nothing here may read a dataset the player hasn't
 * chosen.
 *
 * **No dataset is special.** Every file in `public/datasets/` is offered on identical
 * terms, named from its own file name. There used to be a hand-written description per
 * ticker — three of them, from the doc's regime table — which was a good idea at three
 * datasets and became 641 unnamed ones the moment the set grew.
 *
 * See docs/data-sources.md#bundled-dataset.
 */

export const BUNDLED_SOURCE_ID = 'bundled'

export interface BundledSourceOptions {
  /**
   * How a JSON file is read. Defaults to `fetch` against the site root.
   *
   * Injected so tests can read from disk: a relative-URL `fetch` has nothing to resolve
   * against under Node, and standing up a server to test a data source would be testing
   * the server.
   */
  fetchJson?: JsonFetcher
}

export function createBundledSource(options: BundledSourceOptions = {}): PriceSeriesSource {
  const fetchJson = options.fetchJson ?? createHttpJsonFetcher()
  const bars = new Map<string, OhlcvBar[]>()

  /**
   * The manifest, fetched at most once.
   *
   * The *promise* is cached rather than the result, so concurrent callers share one
   * request — `listTickers` and a run starting in the same tick is the normal case, not a
   * race worth ignoring.
   */
  let catalogue: Promise<BundledDataset[]> | undefined

  function manifest(): Promise<BundledDataset[]> {
    catalogue ??= (async () => {
      const path = manifestPath()
      try {
        return parseManifest(await fetchJson(path), path)
      } catch (error) {
        // Cleared so a later attempt can retry: a cached rejection would make one failed
        // request at boot permanent for the session.
        catalogue = undefined
        throw error
      }
    })()
    return catalogue
  }

  async function datasetFor(symbol: string): Promise<BundledDataset> {
    const datasets = await manifest()
    const found = datasets.find((dataset) => datasetKey(dataset.ticker, dataset.interval) === symbol)
    if (!found) {
      // The count, not the list. Naming 644 symbols in an error message is not help.
      throw new Error(`No bundled dataset for "${symbol}". ${datasets.length} available.`)
    }
    return found
  }

  async function load(symbol: string): Promise<OhlcvBar[]> {
    const cached = bars.get(symbol)
    if (cached) return cached

    const dataset = await datasetFor(symbol)
    const parsed = parseBars(await fetchJson(datasetPath(dataset)), `bundled:${symbol}`, {
      /**
       * **The split heuristic is off here, and only here.**
       *
       * It exists to catch *unverified* data — a hand-fetched URL, an imported CSV — where
       * an unadjusted split reads as a 75% crash and would teach a pattern that never
       * happened. It cannot survive contact with full market history, because the thing it
       * measures does not separate the two cases: Apple really did fall 51.9% on
       * 2000-09-29, SVXY really did lose 83% on 2018-02-06, and an unadjusted 2:1 split is
       * 50%. One number, two meanings.
       *
       * Applied at the interval's threshold, 66 of the 644 bundled datasets would be
       * listed and then refuse to load — a ticker you can pick and cannot play, which is
       * worse than either alternative. So for this source the check moves from load time to
       * index time: `npm run datasets` reports every dataset whose largest single-bar move
       * exceeds the threshold, and that list is reviewed once by a person who can tell
       * Morgan Stanley's 2008 rally from a leveraged ETF's reverse split.
       *
       * Every *structural* check still runs: strictly increasing timestamps, positive
       * prices, high never below low. Those catch corruption, and corruption is what a
       * load-time check can actually decide.
       */
      maxBarMove: Number.POSITIVE_INFINITY,
    })
    bars.set(symbol, parsed)
    return parsed
  }

  return {
    id: BUNDLED_SOURCE_ID,
    displayName: 'Bundled datasets',

    async listTickers(): Promise<TickerMeta[]> {
      const datasets = await manifest()
      return datasets.map((dataset) => ({
        // The composite id, matching the library source's convention: one ticker can be
        // held at several intervals and they are genuinely different series.
        symbol: datasetKey(dataset.ticker, dataset.interval),
        displayName: `${dataset.ticker} · ${intervalName(dataset.interval)}`,
        barCount: dataset.barCount,
        firstBarTime: dataset.firstBarTime,
        lastBarTime: dataset.lastBarTime,
        // Every bundled export is adjusted. Asserted here rather than carried per file
        // because the generator can't verify it either, so a per-entry flag would be the
        // same claim with more places to disagree. docs/data-sources.md#on-adjustment.
        adjusted: true,
      }))
    },

    async loadSeries(symbol: string, range?: DateRange): Promise<OhlcvBar[]> {
      return sliceByTime(await load(symbol), range)
    },
  }
}
