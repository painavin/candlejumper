/**
 * The config tree.
 *
 * Key names mirror docs/config.md one-for-one, including its mix of top-level
 * trading/scroll keys and namespaced groups — so a reader can move between the
 * doc and the code without translating. All of it is fixed for a run's
 * duration; there is no mid-run editing path anywhere.
 */

import type { StopInstanceSpec } from '@shared/contracts/index.js'

export type CostBasisMethod = 'weighted-average' | 'fifo'
export type PriceTransform = 'none' | 'log10'

/**
 * Only the three causal modes exist. The four leaky ones documented in
 * docs/config.md are deliberately not implemented rather than flag-gated: an
 * unimplemented mode can't leak future prices, a gated one is one careless
 * condition away from it.
 */
export type NormalizationMode =
  | 'visible-window-min-max'
  | 'fixed-price-per-pixel'
  | 'starting-price-relative'

export type PnlPalette = 'blue-orange' | 'red-green'

/**
 * How a bar is drawn. Both styles show the same four prices — the difference is
 * only how wide the high–low range is relative to the body, so this is purely a
 * preference and is excluded from the run fingerprint.
 *
 * `theme` defers to the active visual theme's `wickWidthFraction`, which is what
 * lets a mood ship with a house style (`jolly` candlesticks, `serious` Bollinger
 * bars) while still letting a player who prefers one override it everywhere.
 */
export type BarStyle = 'theme' | 'candlestick' | 'bollinger'

/**
 * Defined in `shared/contracts` rather than here, because the plugin host needs
 * this shape and may not import the config tree. One definition, two readers.
 */
export type StopInstanceConfig = StopInstanceSpec

export interface IndicatorInstanceConfig {
  typeId: string
  params: Record<string, number>
  instanceId: string
}

/**
 * How many bars fit on screen, per orientation. Resolved to a single number
 * once at run start and frozen — 60 poles at phone width are ~4px wide, and
 * re-resolving on rotation would rescale the chart mid-run and change the run
 * fingerprint. See docs/config.md#scroll--poles.
 */
export interface VisibleBarCount {
  landscape: number
  portrait: number
}

export interface BackgroundLayerConfig {
  enabled: boolean
  /** Speed relative to `scrollSpeed`. Motion only — fixed across themes. */
  speedMultiplier: number
}

export type BackgroundLayerName =
  | 'sky'
  | 'clouds'
  | 'mountains'
  | 'trees'
  | 'ground'
  | 'foreground'

export interface RunConfig {
  // ── Trading ──────────────────────────────────────────────────────────────
  /** Cash balance at the start of a run; caps both long and short notional. */
  startingCapital: number
  /**
   * Cash deployed per entry or add press, as a **fraction of
   * `startingCapital`** (0.2 = 20%) so it tracks when that changes.
   * Buying power, not a multiple of this, bounds the open unit count.
   */
  entrySize: number
  allowShorting: boolean
  costBasisMethod: CostBasisMethod
  /** How long the exit key must be held to flatten, in ms. */
  flattenHoldMs: number

  // ── Stops ────────────────────────────────────────────────────────────────
  stops: {
    active: StopInstanceConfig[]
    plugins: { loaded: string[] }
  }

  // ── Scoring ──────────────────────────────────────────────────────────────
  scoring: {
    /** The discipline streak and its multiplier. */
    streakEnabled: boolean
    /** Cap on `1 + streak`. */
    maxMultiplier: number
  }

  // ── Scroll / poles ───────────────────────────────────────────────────────
  /** Bars (trading days) per second. Pixel velocity derives from bar width. */
  scrollSpeed: number
  visibleBarCount: VisibleBarCount
  /** Applied to price *before* normalization. Composes with any mode. */
  priceTransform: PriceTransform
  normalizationMode: NormalizationMode
  /** Reference scale value for `starting-price-relative`. */
  normalizationReference: number

  // ── HUD ──────────────────────────────────────────────────────────────────
  hud: { showStopLevelOnChart: boolean }

  // ── Indicators & volume ──────────────────────────────────────────────────
  indicators: {
    active: IndicatorInstanceConfig[]
    plugins: { loaded: string[] }
  }
  volume: { enabled: boolean }

  // ── Visuals ──────────────────────────────────────────────────────────────
  background: { layers: Record<BackgroundLayerName, BackgroundLayerConfig> }
  visuals: {
    theme: string
    /** Same theme + seed always yields an identical world. */
    worldSeed: number
    reducedMotion: boolean
    screenShake: boolean
    pnlPalette: PnlPalette
    barStyle: BarStyle
  }

  // ── Character ────────────────────────────────────────────────────────────
  character: { selected: string }

  // ── Audio ────────────────────────────────────────────────────────────────
  audio: {
    theme: string
    masterVolume: number
    musicVolume: number
    musicMuted: boolean
    sfxVolume: number
    sfxMuted: boolean
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  data: {
    source: string
    ticker: string
    /** Optional sub-range in epoch seconds, inclusive. Unset plays it all. */
    dateRange?: { from: number; to: number }
  }
}
