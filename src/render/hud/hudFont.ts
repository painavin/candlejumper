/**
 * One home for HUD typography.
 *
 * docs/accessibility.md asks for **minimum font sizes on the HUD**, "which is dense
 * with numbers and is the first thing to become unreadable on a phone." A minimum
 * spread across a dozen literals in six files isn't a minimum — it's a convention
 * that decays the first time someone needs one more line to fit. So every HUD text
 * size goes through `hudFontSize()`, and the floor is enforced rather than intended.
 *
 * Sizes are CSS pixels: Pixi's `autoDensity` and resolution handle device pixel
 * ratio, so 12 here is 12 readable pixels on a phone, not 12 physical ones.
 */

/**
 * The floor. Chosen as the smallest size that stays legible for *digits* at arm's
 * length on a phone — decimal-heavy text is harder than prose, and every number
 * here is something the player may need to act on.
 */
export const MIN_HUD_FONT_SIZE = 12

/** Shared across the HUD so numbers align in columns. */
export const HUD_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** Clamp a preferred size to the accessibility floor. */
export function hudFontSize(preferred: number): number {
  return Math.max(MIN_HUD_FONT_SIZE, preferred)
}
