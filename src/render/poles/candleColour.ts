import type { PnlColours } from '@content/pnlColours.js'

/**
 * Candle colours: which colour the body gets, and which the high–low range gets.
 *
 * Pixi-free and pure, like `candle.ts` next to it — `poleLayer.ts` can't be tested,
 * so anything with a rule in it lives on this side of the line.
 *
 * ## Why the range is tinted rather than neutral
 *
 * It was a single neutral grey-blue at first, on the reasoning that direction is the
 * body's job and a coloured range would say the same thing twice. That's sound for a
 * *candlestick*, where the range is a thin wick and the body dominates. It falls apart
 * at Bollinger width, where the range **is** most of the column: the neutral then
 * occupies the majority of every bar and the coloured section reads as a sticker
 * applied to a dark bar rather than as the bar's own direction. The thing the eye
 * lands on first ends up being the part carrying no information.
 *
 * So the range takes a desaturated version of the direction colour. The column's
 * overall hue becomes the direction — legible at a glance across the whole chart —
 * while the fully saturated body still marks *where* open and close sit. Same
 * information, ordered by prominence instead of fighting.
 *
 * The theme's `candleRange` is still doing work: it's the colour the direction is
 * mixed *toward*, so a mood keeps control of how dark and how muted its bars are, and
 * it remains the flat colour for a bar with no direction to report.
 */

export interface CandlePalette {
  /** Direction colours, from `visuals.pnlPalette`. */
  pnl: PnlColours
  /** The theme's neutral: the mix target, and the doji body. */
  neutral: number
}

/**
 * How far the range is mixed toward the theme's neutral, 0..1.
 *
 * High enough that the range never competes with the body for attention — the body
 * has to stay the thing you read a price off. Low enough that the hue survives the
 * mixing, which is the entire point. Below about 0.4 the two are hard to tell apart;
 * above about 0.8 the tint is gone and this is a neutral again.
 */
export const RANGE_MIX = 0.62

/**
 * Minimum lightness the range must sit below the body by.
 *
 * Mixing toward the neutral is not enough on its own, and that isn't obvious:
 * `serious`'s neutral is a *light* steel blue, so mixing its red body toward it barely
 * changes the lightness at all — the two would differ only in saturation. A
 * saturation-only difference is the weakest cue available and the first one lost to
 * any colour-vision difference, so the range is additionally dimmed until there's a
 * lightness difference too.
 *
 * Always dimmer, never lighter. Receding is what the range should do, and a single
 * direction means the rule reads the same in every theme rather than flipping
 * depending on which side of the body colour a mood's neutral happens to fall.
 */
export const MIN_LUMA_GAP = 0.12

/** Rec. 601 luma. Linear in the channels, which is what makes `dimTo` exact. */
function luma(colour: number): number {
  const r = (colour >> 16) & 0xff
  const g = (colour >> 8) & 0xff
  const b = colour & 0xff
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/**
 * Darkens a colour until its luma is at or below `target`, leaving hue alone.
 *
 * Solved rather than iterated: luma is a linear function of the channels and mixing
 * toward black scales all three, so the blend factor comes straight out of the ratio.
 */
function dimTo(colour: number, target: number): number {
  const current = luma(colour)
  const wanted = Math.max(0, target)
  if (current <= wanted || current <= 0) return colour
  return mixColour(colour, 0x000000, (current - wanted) / current)
}

/** Linear blend between two packed RGB colours. `t` of 0 is `from`, 1 is `to`. */
export function mixColour(from: number, to: number, t: number): number {
  const amount = Math.max(0, Math.min(1, t))
  const channel = (shift: number): number => {
    const a = (from >> shift) & 0xff
    const b = (to >> shift) & 0xff
    return Math.round(a + (b - a) * amount) & 0xff
  }
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/** The direction colour at full strength, or the neutral when there's no direction. */
export function bodyColour(direction: 'up' | 'down' | 'flat', palette: CandlePalette): number {
  if (direction === 'up') return palette.pnl.up
  if (direction === 'down') return palette.pnl.down
  // Closed where it opened: neutral, because there is no direction to report.
  return palette.neutral
}

/**
 * The body's colour, desaturated toward the theme's neutral and dimmed.
 *
 * Both steps are needed: the mix supplies the drop in saturation, the dim guarantees
 * the drop in lightness. Either alone leaves a theme where the two sections are hard
 * to separate.
 */
export function rangeColour(direction: 'up' | 'down' | 'flat', palette: CandlePalette): number {
  if (direction === 'flat') return palette.neutral
  const body = bodyColour(direction, palette)
  return dimTo(mixColour(body, palette.neutral, RANGE_MIX), luma(body) - MIN_LUMA_GAP)
}
