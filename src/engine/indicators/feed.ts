import type { OhlcvBar } from '@shared/contracts/index.js'

/**
 * The port displayed indicators answer through.
 *
 * A sibling of `engine/stops/` and for the same reason: `engine/` states what it
 * needs, `plugins/host/` supplies it, and the engine never learns that an indicator
 * is a plugin. Two port folders rather than one because the two plugin kinds have
 * genuinely different shapes — a stop returns a level, an indicator accumulates a
 * series.
 *
 * Same shape of dependency inversion as `engine/stops/`: the engine says what it
 * needs, `plugins/host/` supplies it. The engine never learns that an indicator is
 * a plugin, so it stays testable against a hand-written fake.
 *
 * These instances are **entirely separate from any a stop owns**. Toggling a pane
 * must never change risk management — if they shared an instance, hiding an overlay
 * could alter or kill the stop driving the player's exits.
 */

export interface IndicatorSeries {
  instanceId: string
  displayName: string
  /**
   * Line colour for every output of this instance.
   *
   * Carried through the engine rather than chosen by the renderer, because it's a
   * player setting: `render/` may not read config, and deriving it from list position
   * there would recolour every line whenever one is removed.
   */
  colour: number
  /** A rendering hint. A stop consuming the same indicator ignores it entirely. */
  paneKind: 'overlay' | 'oscillator'
  /** Named output series, in declaration order. */
  outputs: string[]
  /** Fixed y-range for oscillators that have one, e.g. [0, 100] for RSI. */
  fixedRange?: [number, number]
  /**
   * Values per output, oldest first, one per bar played so far — `NaN` while warming
   * up, which the renderer skips rather than drawing a line to zero.
   */
  history: Record<string, number[]>
}

export interface IndicatorFeed {
  /** Fed once per closed bar, in order, never ahead of the playback cursor. */
  observeBar(bar: OhlcvBar, isLastBar: boolean): void
  reset(): void
  readonly series: readonly IndicatorSeries[]
}

/** No indicators configured. */
export function createNoIndicators(): IndicatorFeed {
  return {
    observeBar() {},
    reset() {},
    series: [],
  }
}
