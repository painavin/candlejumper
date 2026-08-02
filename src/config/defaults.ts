import { mintSeed } from '@shared/math/index.js'
import type { RunConfig } from './types.js'

/**
 * Defaults, matching the tables in docs/config.md.
 *
 * Values the doc marks *provisional* were chosen for internal consistency
 * rather than from play — `entrySize` at 20% gives exactly five units to fully
 * deploy, matching the five-ghost stack and `scoring.maxMultiplier`. Expect
 * them to move once the game is playable.
 */
export function defaultConfig(): RunConfig {
  return {
    startingCapital: 10_000,
    entrySize: 0.2, // provisional
    allowShorting: false,
    costBasisMethod: 'weighted-average',
    flattenHoldMs: 400, // provisional

    stops: {
      // One advisory stop rather than an empty list: a trainer with no risk
      // rule out of the box is a strange default, and the discipline streak has
      // nothing to measure without one. Advisory specifically, because that's
      // the only mode where the player rather than the engine is measured.
      active: [{ typeId: 'trailing-percent', params: { percent: 8 }, advisory: true }],
    },

    scoring: {
      streakEnabled: true,
      maxMultiplier: 5, // provisional
    },

    scrollSpeed: 2, // provisional
    visibleBarCount: { landscape: 60, portrait: 28 }, // provisional
    // Off by default: it shortens the playable series, which is a trade the player
    // should opt into rather than discover.
    preloadBars: 0,
    priceTransform: 'none',
    normalizationMode: 'visible-window-min-max',
    normalizationReference: 100,

    hud: { showStopLevelOnChart: true },

    indicators: { active: [] },
    volume: { enabled: true },

    background: {
      layers: {
        sky: { enabled: true, speedMultiplier: 0 },
        clouds: { enabled: true, speedMultiplier: 0.2 },
        mountains: { enabled: true, speedMultiplier: 0.4 },
        trees: { enabled: true, speedMultiplier: 0.8 },
        ground: { enabled: true, speedMultiplier: 1 },
        foreground: { enabled: true, speedMultiplier: 1.35 },
      },
    },
    visuals: {
      theme: 'jolly',
      worldSeed: mintSeed(),
      // Resolved at boot from `motionOverride` and prefers-reduced-motion; this is
      // only the value before that runs.
      reducedMotion: false,
      screenShake: true,
      // Red/green: the language traders already read. Safe as a *default* only
      // because P&L never depends on hue — every value carries a sign and an arrow
      // too — and blue/orange stays one click away. See docs/accessibility.md.
      pnlPalette: 'red-green',
      // One uniform column per bar, in every theme — a mood picks the bars' colour
      // and corner style, never their chart type. `candlestick` is one click away
      // for a player who reads wicks faster. See `config/types.ts`.
      barStyle: 'bollinger',
    },

    character: { selected: 'robin' },

    audio: {
      theme: 'jolly',
      masterVolume: 1,
      /**
       * The bed sits **well under** the other two channels, not just under them.
       *
       * Channel 2 is the feature that makes price movement audible, and it is one
       * tone per bar arguing with a bed of anywhere from two to ten simultaneous
       * voices. At the old 0.6/0.8 split — about 2.5 dB — a composed track masked it
       * outright, and even the generated bed left it borderline. ~6.5 dB of headroom
       * is what makes a single bell legible over an arrangement.
       *
       * These are the *defaults* only: both are live sliders, excluded from the run
       * fingerprint, and a stored value overrides them. Players who already set a
       * level keep it.
       */
      musicVolume: 0.42,
      musicMuted: false,
      sfxVolume: 0.9,
      sfxMuted: false,
    },

    data: { source: 'bundled', ticker: 'AAPL' },
  }
}

/**
 * Layout constants that aren't player-facing config but are referenced by more
 * than one system, so they need a single home.
 */
export const LAYOUT = {
  /**
   * Where the character sits, as a fraction of viewport width. The docs gave a
   * 70–80% range; 75% is the midpoint. Load-bearing because bar width is
   * `playfieldWidth / visibleBarCount`, and the playfield is everything left of
   * this line — the strip right of it never holds poles.
   */
  characterXFraction: 0.75,
  /** Gap between poles, as a fraction of bar width. */
  poleGapFraction: 0.15,
  /** How much of a bar's duration the newest bar spends growing to its close. */
  barGrowthFraction: 0.25,
  /**
   * How much of a bar's duration the hop takes, starting the instant the bar closes.
   *
   * The rest of the bar is spent standing on the perch, so this is the ratio of moving to
   * waiting — at 0.35 the character is airborne about a third of the time. Deliberately
   * less than half: the point of the change that introduced it was that the character
   * should *wait on the bar*, and a hop occupying most of the bar would be the old
   * complaint with the phases reordered.
   *
   * Must stay at or below 1. Consecutive hops start one bar apart — each begins the moment
   * a bar closes — so a full bar's duration is the most one can have without the next hop
   * beginning while this one is still in the air.
   */
  hopDurationFraction: 0.35,
  /** Hop arc height, in bar widths. Fixed height, variable landing. */
  hopHeightInBarWidths: 1.5,
  /** Y-axis label count. */
  axisLabelCount: 5,
  /** Main chart keeps 60% when any sub-pane is enabled. */
  mainChartFractionWithSubPanes: 0.6,
} as const

/** Below this many shares, a position is treated as exactly flat. */
export const FLAT_THRESHOLD_SHARES = 1e-6

/**
 * An entry is denied rather than opened when remaining buying power is below
 * this fraction of `entrySize` — otherwise dust presses inflate `unitCount` and
 * dilute every later exit.
 */
export const MIN_FUNDABLE_ENTRY_FRACTION = 0.01
