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
