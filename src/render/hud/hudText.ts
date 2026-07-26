import type { TextStyleOptions } from 'pixi.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import { HUD_FONT, hudFontSize } from './hudFont.js'

/**
 * One home for HUD text *style*, as `hudFont.ts` is for HUD text *size*.
 *
 * ## Why an outline rather than a better colour
 *
 * The HUD is drawn directly over a moving scene: a sky gradient, clouds passing
 * behind it, candles scrolling through it. So there is no fill colour that is legible
 * everywhere — the same light grey that reads well against `serious`'s dusk sky
 * disappears into the top of `jolly`'s. Picking a better colour can only move which
 * part of the frame is unreadable.
 *
 * An outline fixes it structurally instead: a dark edge behind every glyph means the
 * contrast travels *with the text*, and stops depending on what happens to be behind
 * it. This is why `accent.dim` in both themes is lighter than it looks like it should
 * be — with an outline, secondary text reads as light-on-dark-edge, so pushing it
 * toward the text colour raises contrast rather than lowering it.
 *
 * ## Why it lives here
 *
 * Seven files construct HUD `Text` objects. A treatment applied seven times is a
 * convention, and conventions decay the first time someone adds an eighth — exactly
 * the argument `hudFont.ts` already makes for the size floor. Style goes through this
 * function so the outline is enforced rather than intended.
 *
 * Runtime-free of Pixi (the import is a type, erased at build) so it stays testable
 * without a WebGL context.
 */

/**
 * Outline thickness in CSS pixels.
 *
 * Thick enough to survive the half-pixel softening of antialiasing at the 12px
 * accessibility floor, thin enough not to close up the counters of small digits —
 * which would trade one legibility problem for another.
 */
export const HUD_OUTLINE_WIDTH = 3

export interface HudTextOptions {
  theme: VisualTheme
  /** Preferred size; clamped to the accessibility floor by `hudFontSize`. */
  size: number
  /**
   * Overrides the theme's primary text colour — for P&L direction, series colours,
   * and anything else whose hue is information.
   */
  fill?: number
}

export function hudTextStyle({ theme, size, fill }: HudTextOptions): TextStyleOptions {
  return {
    fontFamily: HUD_FONT,
    fontSize: hudFontSize(size),
    fill: fill ?? theme.accent.text,
    stroke: { color: theme.accent.outline, width: HUD_OUTLINE_WIDTH, join: 'round' },
  }
}

/** As `hudTextStyle`, in the theme's secondary colour. */
export function hudDimTextStyle(theme: VisualTheme, size: number): TextStyleOptions {
  return hudTextStyle({ theme, size, fill: theme.accent.dim })
}
