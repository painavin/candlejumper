import type { CloudParams, HeightfieldParams, MotifParams } from '@shared/contracts/index.js'

/**
 * A visual theme is a **parameter set, not an asset bundle**.
 *
 * Because every visual is generated at runtime, adding a mood costs no art
 * production — just numbers. Rendering code always asks "what does the *current*
 * theme supply for layer N" and never branches on theme id, which is what keeps
 * that true.
 *
 * Candle *geometry* is always price data and is never touched by a theme. What a
 * theme controls is colour, corner style, and the width of the high–low range —
 * and that last one is what makes one drawing routine serve two chart types.
 */

export interface ThemePalette {
  /** Vertical gradient, top then bottom. */
  sky: [number, number]
  /** Back to front, one per terrain layer instance. */
  mountains: [number, number]
  trees: number
  /**
   * The mood's own bar colour: what a direction colour is muted *toward*, and the flat
   * colour for a bar that closed exactly where it opened.
   *
   * Not the range colour itself. The range takes a desaturated, dimmed version of the
   * body's own direction colour — see `render/poles/candleColour.ts` for why a shared
   * neutral fails once the range is as wide as the body. What this controls is how
   * dark and how muted a mood's bars come out, so a theme still governs its own look
   * without owning the direction.
   */
  candleRange: number
  ground: number
  groundLine: number
  clouds: number
  foreground: number
}

/** HUD/UI colours matched to the mood, so a switch never leaves them mismatched. */
export interface AccentPalette {
  text: number
  dim: number
  axisLine: number
  accent: number
  /**
   * Outline drawn behind every HUD glyph.
   *
   * The HUD sits directly on a moving scene — a sky gradient, clouds, candles — so
   * **no single fill colour can be legible everywhere**. Contrast has to come from
   * the glyph's edge rather than from choosing a better fill, which is why this
   * exists as its own colour rather than being handled by tuning `text` and `dim`.
   *
   * Should be the counter-colour to `text` and `dim`: both shipped themes use light
   * HUD text, so both use a dark outline. A theme with *dark* HUD text would need a
   * light one, which is exactly why it's theme data.
   */
  outline: number
}

export interface VisualTheme {
  id: string
  displayName: string
  palette: ThemePalette
  accent: AccentPalette
  terrain: {
    /** Two mountain ranges, back and front, for cheap depth. */
    mountainsFar: HeightfieldParams
    mountainsNear: HeightfieldParams
    trees: HeightfieldParams
  }
  clouds: CloudParams
  foreground: MotifParams
  poles: {
    /**
     * Corner shape on both of a bar's rectangles.
     *
     * Both shipped moods now ask for `round`, so `flat` is currently a capability
     * rather than something you can see: soft corners turned out to read fine on the
     * serious mood too, and what actually separates the two is `outline` — one
     * constant edge colour on every bar is what makes a chart read as a terminal.
     * Kept because it is one branch in `poleLayer` and the obvious knob for a third
     * mood; if none arrives, delete it the way `wickWidthFraction` went.
     */
    capStyle: 'round' | 'flat'
    outline: boolean
    /**
     * Bar *width* is deliberately absent here.
     *
     * A `wickWidthFraction` used to live in this block so a mood could ship its own
     * chart type, read only when `visuals.barStyle` was `theme`. Both moods chose the
     * same value, so the setting resolved to the default either way — and a themeable
     * knob that never varies is a place for the two paths to drift apart rather than a
     * feature. The width now comes from the player's `visuals.barStyle` alone; see
     * `render/poles/candle.ts`.
     */
  }
}
