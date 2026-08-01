import type { IndicatorDrawStyle, OhlcvBar } from '@shared/contracts/index.js'

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
   * The instance's colour, used by every output that doesn't name its own.
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
  /**
   * How each output is drawn, already resolved by the host from the plugin's defaults
   * and the player's overrides — keyed by output name, one entry per output.
   *
   * Resolved before it gets here on purpose: `render/` may not reach the plugin
   * registry, and a second resolution is how a line and its legend entry end up
   * disagreeing. `colour` may still be absent, meaning "the instance's colour".
   */
  styles?: Readonly<Record<string, ResolvedOutputStyle>>

  /** Fixed y-range for oscillators that have one, e.g. [0, 100] for RSI. */
  fixedRange?: [number, number]
  /**
   * Values per output, oldest first, one per bar played so far — `NaN` while warming
   * up, which the renderer skips rather than drawing a line to zero.
   */
  history: Record<string, number[]>
}

/** A style with the defaults already applied. Only `colour` may still be absent. */
export interface ResolvedOutputStyle {
  draw: IndicatorDrawStyle
  /** Absent means "the instance's colour" — the engine applies that. */
  colour?: number
  /** Pixels to lift a mark above its value; plugin-declared, never a player choice. */
  offsetPx?: number
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
