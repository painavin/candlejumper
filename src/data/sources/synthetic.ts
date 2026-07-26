import type { DateRange, OhlcvBar, PriceSeriesSource, TickerMeta } from '@shared/contracts/index.js'
import { createPrng, deriveSeed } from '@shared/math/index.js'

/**
 * A synthetic random-walk source.
 *
 * Slots into the same `PriceSeriesSource` interface as the bundled files, which is
 * the point: adding a source costs no changes to pole generation, the engine, or the
 * renderer.
 *
 * Useful for testing the engine against extreme price paths — a series that only
 * falls, or one with a 40% single-day gap — which the three curated real datasets
 * deliberately don't contain. It loses the "real stock" hook for actual play, so it
 * isn't the default.
 *
 * Seeded, so a given symbol always produces the same series. A source that generated
 * something different every load would break personal-best comparison, which needs
 * the same ticker to play identically every time.
 */

interface SyntheticSpec {
  symbol: string
  displayName: string
  /** Mean daily log return. Positive drifts up. */
  drift: number
  /** Daily volatility. */
  volatility: number
  bars: number
  startPrice: number
}

const SPECS: readonly SyntheticSpec[] = [
  {
    symbol: 'SYN-BULL',
    displayName: 'Synthetic — steady uptrend',
    drift: 0.0012,
    volatility: 0.012,
    bars: 480,
    startPrice: 100,
  },
  {
    symbol: 'SYN-CHOP',
    displayName: 'Synthetic — no drift, high volatility',
    drift: 0,
    volatility: 0.028,
    bars: 480,
    startPrice: 100,
  },
  {
    symbol: 'SYN-BEAR',
    displayName: 'Synthetic — sustained decline',
    drift: -0.0015,
    volatility: 0.016,
    bars: 480,
    startPrice: 200,
  },
]

/** Market-open aligned epoch seconds, one weekday step at a time. */
const FIRST_BAR_TIME = 1_600_000_000
const DAY = 86_400

function generate(spec: SyntheticSpec): OhlcvBar[] {
  const prng = createPrng(deriveSeed(1, `synthetic:${spec.symbol}`))
  const bars: OhlcvBar[] = []
  let close = spec.startPrice
  let time = FIRST_BAR_TIME

  for (let i = 0; i < spec.bars; i++) {
    const open = close
    // Box–Muller from two uniforms: a normal shock rather than a uniform one, so the
    // series has realistic tails instead of a hard cap on daily moves.
    const u1 = Math.max(prng.next(), 1e-12)
    const u2 = prng.next()
    const shock = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    close = open * Math.exp(spec.drift + spec.volatility * shock)

    const wick = spec.volatility * prng.range(0.2, 1.1)
    const high = Math.max(open, close) * (1 + wick)
    const low = Math.min(open, close) * (1 - wick)

    bars.push({
      o: open,
      h: high,
      l: low,
      c: close,
      v: Math.round(prng.range(4e6, 4e7)),
      t: time,
    })

    // Skip weekends, so date banners land where a player expects them.
    const weekday = Math.floor(time / DAY) % 7
    time += weekday === 4 ? DAY * 3 : DAY
  }

  return bars
}

export function createSyntheticSource(): PriceSeriesSource {
  const cache = new Map<string, OhlcvBar[]>()

  const load = (symbol: string): OhlcvBar[] => {
    const cached = cache.get(symbol)
    if (cached) return cached
    const spec = SPECS.find((entry) => entry.symbol === symbol)
    if (!spec) {
      throw new Error(
        `No synthetic series "${symbol}". Available: ${SPECS.map((entry) => entry.symbol).join(', ')}`
      )
    }
    const bars = generate(spec)
    cache.set(symbol, bars)
    return bars
  }

  return {
    id: 'synthetic',
    displayName: 'Synthetic (random walk)',

    async listTickers(): Promise<TickerMeta[]> {
      return SPECS.map((spec) => {
        const bars = load(spec.symbol)
        return {
          symbol: spec.symbol,
          displayName: spec.displayName,
          barCount: bars.length,
          firstBarTime: bars[0]?.t ?? 0,
          lastBarTime: bars[bars.length - 1]?.t ?? 0,
          // Nothing to adjust: there are no splits in a generated series. Stated
          // rather than implied, as any source must.
          adjusted: true,
        }
      })
    },

    async loadSeries(symbol: string, range?: DateRange): Promise<OhlcvBar[]> {
      const bars = load(symbol)
      if (!range) return [...bars]
      return bars.filter((bar) => bar.t >= range.from && bar.t <= range.to)
    },
  }
}
