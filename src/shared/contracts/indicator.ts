import type { OhlcvBar } from './bar.js'
import type { ParamSpec, ParamValues } from './params.js'

/**
 * An indicator plugin. Built-ins and user plugins are both just objects
 * matching this shape — there is no separate "official indicator" code path.
 *
 * See docs/indicators.md#typescript-indicator-contract.
 */
export interface IndicatorPlugin {
  id: string
  displayName: string
  /**
   * Short form for chart legends and pane titles, e.g. `SMA`.
   *
   * Needed because several instances of one indicator can be active at once, and a
   * legend reading "Simple Moving Average 20 / Simple Moving Average 50 / Simple
   * Moving Average 200" is unreadable at the size a legend has to be. Optional:
   * `displayName` is the fallback, so an existing plugin keeps working.
   */
  abbreviation?: string
  /**
   * A rendering hint only. An indicator must be usable with no pane at all,
   * because stop plugins consume indicators as numbers — see
   * docs/indicators.md#two-consumers-the-chart-and-stop-plugins.
   */
  paneKind: 'overlay' | 'oscillator'
  /** Named output series, e.g. ['macd', 'signal', 'histogram']. */
  outputs: string[]
  params: ParamSpec[]
  /** Fixed y-range for oscillator panes that have one, e.g. [0, 100] for RSI. */
  fixedRange?: [number, number]
  createInstance(params: ParamValues): IndicatorInstance
}

/**
 * The naming half of a plugin — everything `instanceLabel` needs and nothing else.
 *
 * Deliberately narrower than `IndicatorPlugin` so `ui/` can label a row without
 * holding a plugin: the settings screen only ever has a descriptor (id, names, param
 * specs), never a `createInstance`. `IndicatorPlugin` satisfies this structurally, so
 * there's no adapter and no second implementation.
 */
export interface LabelledIndicator {
  displayName: string
  abbreviation?: string
  params: ParamSpec[]
}

/**
 * The label for one configured instance, e.g. `SMA 20`.
 *
 * Derived in one place rather than at each consumer, because the chart legend, the
 * sub-pane title, and the settings row all have to agree — three instances of SMA are
 * only distinguishable if every surface names them identically.
 *
 * Every declared param is appended in declaration order, which is what makes this
 * work for an indicator with more than one: MACD(12, 26, 9) labels itself without
 * needing to know about this function. Integers print bare; anything else keeps a
 * couple of decimals so 0.5 doesn't collapse to 0.
 */
export function instanceLabel(plugin: LabelledIndicator, params: ParamValues): string {
  const name = plugin.abbreviation ?? plugin.displayName
  const values = plugin.params.map((spec) => {
    const value = params[spec.key] ?? (spec.default as number)
    if (typeof value !== 'number' || !Number.isFinite(value)) return '?'
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  })
  return values.length === 0 ? name : `${name} ${values.join(' ')}`
}

export interface IndicatorInstance {
  reset(): void
  /**
   * Called once per bar, in order. Returns one value per declared output.
   *
   * Return NaN for bars where the indicator isn't warmed up yet (e.g. an
   * SMA(20) before 20 bars exist) — the renderer skips NaN rather than drawing
   * a line to zero. A stop consuming this must translate NaN to a `null` level;
   * see docs/stops.md#warm-up-must-produce-null-never-a-nan-level.
   */
  onBar(bar: OhlcvBar, isLastBar: boolean): Record<string, number>
}
