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
 * reading preference and is excluded from the run fingerprint.
 *
 * There used to be a third value, `theme`, which deferred to the active visual
 * theme's own `wickWidthFraction` so a mood could ship a house style. Both shipped
 * moods chose Bollinger bars, so the option only ever meant "the default, indirectly"
 * — a control whose two settings did the same thing, and a per-theme number nothing
 * else read.
 */
export type BarStyle = 'candlestick' | 'bollinger'

/**
 * Defined in `shared/contracts` rather than here, because the plugin host needs
 * this shape and may not import the config tree. One definition, two readers.
 */
export type StopInstanceConfig = StopInstanceSpec

export interface IndicatorInstanceConfig {
  typeId: string
  params: Record<string, number>
  instanceId: string
  /**
   * Line colour, from the fixed palette in `content/indicatorPalette.ts`.
   *
   * Per *instance*, not derived from the instance's position in the list — otherwise
   * removing one indicator recolours every line below it, and a player who learned
   * "the amber one is the 200" has to relearn it.
   */
  colour: number
  /**
   * Where this instance is drawn, overriding the plugin's own `paneKind`.
   *
   * `undefined` means "whatever the plugin suggests": the plugin author's choice is a
   * sensible default, not a decision the player has to be locked out of.
   *
   * Legitimate because `paneKind` is documented as a *rendering hint*: the same
   * indicator is consumed as bare numbers by stop plugins, so it never depended on
   * having a pane. What the override cannot change is the scale — an overlay is drawn
   * on the price axis, so an indicator whose values aren't prices will sit squashed
   * against the bottom of the chart. The UI says so rather than refusing.
   */
  paneKind?: 'overlay' | 'oscillator'
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
  /**
   * No `plugins.loaded` list here, deliberately.
   *
   * docs/config.md used to describe one — "file path on desktop, imported blob on
   * mobile" — and it was never implementable: a browser cannot re-read a file the
   * player picked last week, and mobile has no stable path either. Imported plugins
   * persist as *source text* under their own storage key instead, so a list of
   * references in the config would have been a second, always-stale record of the
   * same thing. `active` below names plugins by id; whether one is loaded is the
   * plugin host's business.
   */
  stops: {
    active: StopInstanceConfig[]
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
  }
  volume: { enabled: boolean }

  // ── Visuals ──────────────────────────────────────────────────────────────
  background: { layers: Record<BackgroundLayerName, BackgroundLayerConfig> }
  visuals: {
    theme: string
    /** Same theme + seed always yields an identical world. */
    worldSeed: number
    /**
     * Reduced motion **as resolved for this session** — the value every renderer
     * reads. Derived at boot from `motionOverride` and the OS setting, and
     * deliberately *not* persisted: it's an outcome, not a preference.
     */
    reducedMotion: boolean
    /**
     * The player's explicit motion choice, or `undefined` to follow the OS.
     *
     * Three states rather than two, because a persisted boolean would silently
     * override `prefers-reduced-motion` — which is the one setting whose whole
     * purpose is to be respected without being asked twice. Same override-plus-
     * default shape as `IndicatorInstanceConfig.paneKind`.
     */
    motionOverride?: boolean
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
