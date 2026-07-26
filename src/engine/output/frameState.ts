import type { OhlcvBar } from '@shared/contracts/index.js'
import type { PositionEvent } from './events.js'

/**
 * The engine's entire outward-facing surface.
 *
 * `render/` and `audio/` may import this folder and nothing else in `engine/`,
 * which is what keeps the trading logic free of any knowledge of how it's drawn.
 * Everything here is a plain value: a render pass is a pure function of one
 * snapshot plus theme and elapsed time.
 *
 * Note that stop levels arrive already converted to unit heights. The renderer
 * never sees a `StopEngine`, so it can't reach into risk management to draw a
 * line — and `engine/stops/` stays swappable without touching `render/`.
 */

/**
 * Which way a bar closed. `flat` is a doji: it opened and closed at the same price.
 *
 * Derived from the raw prices, and carried on the frame so every consumer reads the
 * *same* answer. The candle body, the candle's range, and the volume bar are all
 * coloured from it, and two of them computing it independently is two of them that can
 * disagree.
 */
export type BarDirection = 'up' | 'down' | 'flat'

/** One pole on screen. Only played bars ever appear here. */
export interface VisibleBar {
  bar: OhlcvBar
  /** Index into the full series. */
  index: number
  /** 0 for the newest (under the character), increasing to the left. */
  age: number
  /**
   * Close mapped to 0..1 of chart height, via the active normalizer.
   *
   * Still named `unit` unqualified because the close is the price the game
   * *trades* at: fills, stop comparisons, and where the character lands all read
   * this one and nothing else.
   */
  unit: number
  /**
   * Open, high, and low on the exact same 0..1 scale as `unit`.
   *
   * They're computed here rather than in `render/` for the same reason overlay
   * lines are: normalization is the engine's, and a renderer doing its own
   * price→height conversion is a renderer whose candles can drift out of
   * alignment with the axis describing them.
   */
  openUnit: number
  highUnit: number
  lowUnit: number
  /**
   * Up, down, or flat — from the **prices**, not the units.
   *
   * At the edge of the chart the unit conversion clamps, so a genuinely rising bar
   * whose open and close both sit above the bounds would compare *equal* in unit space
   * and be miscoloured as unchanged. Computing it here, once, from the raw values is
   * what makes that impossible rather than merely handled.
   */
  direction: BarDirection
  /**
   * 0..1 through the bar's formation. Only the newest bar is ever below 1 — a
   * bar appearing complete directly under the character reads as a rendering
   * glitch, so it forms the way a real bar does: opening as a flat mark at the
   * open and extending toward its close.
   */
  growth: number
}

/** Value-space bounds of the chart, already eased. The axis is their inverse. */
export interface ChartBounds {
  min: number
  max: number
}

export type RunPhase = 'waiting-for-data' | 'playing' | 'paused' | 'finished'

/** The chart half of a frame: what the price data is doing. */
export interface ChartFrame {
  phase: RunPhase
  /** Played bars currently on screen, oldest first. */
  bars: readonly VisibleBar[]
  bounds: ChartBounds
  /** 0..1 through the current bar; drives sub-bar scroll offset. */
  barPhase: number
  /** The bar being traded — the rightmost, still-growing one. */
  currentBar: OhlcvBar | undefined
  currentIndex: number
  totalBars: number
  /** Unit height of the previous bar's close, for the hop's takeoff point. */
  previousUnit: number | undefined
  /** Bars the stall clamp discarded. Surfaced rather than hidden. */
  droppedBars: number
}

export type PositionDirection = 'long' | 'short' | 'flat'

/** Meter states from docs/game-feel.md, mirrored so `render/` needn't import scoring. */
export type StreakMeter = 'live' | 'automated' | 'dormant'

export interface StreakView {
  meter: StreakMeter
  streak: number
  multiplier: number
  /** Realized P&L weighted by the multiplier. Shown *beside* raw P&L, never instead. */
  arcadeScore: number
  /** Cap, so the meter knows how many pips to draw. */
  maxMultiplier: number
}

/** Everything the top HUD reads. */
export interface HudState {
  direction: PositionDirection
  /** Signed, fractional. */
  shares: number
  avgCost: number
  /** Exactly how many exit presses remain to reach flat. */
  unitCount: number
  realizedPnl: number
  unrealizedPnl: number
  totalPnl: number
  /** Percent return on starting capital. */
  percentReturn: number
  buyingPower: number
  streak: StreakView
  /** Whether the run was stopped out this bar, for the distinct feedback path. */
  stoppedOutThisBar: boolean
}

/** A stop level as a chart line: solid when enforcing, dashed when advisory. */
export interface StopLine {
  stopId: string
  level: number
  /** 0..1 chart height, already converted. */
  unit: number
  advisory: boolean
  /** The player is currently past this advisory level. */
  breached: boolean
}

/**
 * An overlay indicator, already mapped onto the price scale.
 *
 * Overlays must go through the *exact same* transform and normalization pipeline as
 * the poles, or the line drifts out of alignment with the bars it's supposed to sit
 * on. Doing that conversion in the engine is what guarantees it.
 */
export interface OverlayLine {
  instanceId: string
  /**
   * Human label for the legend, e.g. `SMA 20`.
   *
   * Carried on the line rather than looked up by the renderer, because `render/` may
   * not import the plugin registry — and because several instances of one indicator
   * can be active, so the *instance* is what needs naming, not the type.
   */
  label: string
  output: string
  /** Player-chosen line colour, so the legend and the line cannot disagree. */
  colour: number
  /** One per visible bar, oldest first. `null` where the indicator was warming up. */
  units: readonly (number | null)[]
}

/** One oscillator or volume sub-pane. Values are normalized within the pane. */
export interface SubPane {
  instanceId: string
  title: string
  /** Independently normalized from the price scale above it. */
  series: readonly {
    output: string
    colour: number
    units: readonly (number | null)[]
    /**
     * Per-point direction, aligned index-for-index with `units`.
     *
     * When present, the renderer colours each point from its direction instead of the
     * series colour — the volume pane uses it so a day's volume bar matches that day's
     * candle. Optional because most series have no direction to report: a moving
     * average is just a level.
     *
     * The *direction* is here and the *colour* is not, deliberately. Colour depends on
     * the P&L palette and the theme, neither of which the engine may read, and routing
     * it through the renderer's own candle colouring is what guarantees a volume bar
     * and its candle come out the same shade rather than two places agreeing by hand.
     */
    directions?: readonly BarDirection[]
  }[]
  /** Value-space bounds, for the pane's own labels. */
  min: number
  max: number
  /** True for a histogram (volume) rather than a line. */
  histogram: boolean
}

export interface FrameState extends ChartFrame {
  hud: HudState
  stopLines: readonly StopLine[]
  /** Events produced by the bar that just closed, if any. Drives audio and juice. */
  events: readonly PositionEvent[]
  overlays: readonly OverlayLine[]
  subPanes: readonly SubPane[]
}
