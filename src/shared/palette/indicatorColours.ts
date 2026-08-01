/**
 * The colours an indicator line can be drawn in.
 *
 * A **curated palette plus a free picker**, which is a revision of an earlier decision
 * and worth recording as such. This was originally a fixed palette *only*, on the
 * grounds that an arbitrary hex lets a player pick something that vanishes into the sky
 * or a red that reads as a losing bar. Both remain true. What the fixed list couldn't
 * survive is an indicator with several outputs at once — a breakout marker, a retrace
 * level and a stop level want deliberately related colours, and eight presets ran out
 * before the intent could be expressed.
 *
 * So the presets stay, first and one click away, because they're named, accessible and
 * legible against both moods. The picker sits beside them for everything they can't say,
 * and `describeColourRisk` reports the two original failure modes rather than preventing
 * them — a warning respects the choice, and a chart the player deliberately made
 * unreadable is their business.
 *
 * **Two presets are not clear of the P&L pair**, contrary to what this comment used to
 * claim: `Sky` is byte-identical to `blue-orange`'s up colour and `Orange` to its down
 * colour. So those two warn when that palette is selected, which is correct rather than
 * noise — it matters *most* there, because a colourblind player is relying on exactly
 * those hues to read the candles. They are last in the list so that the colours handed
 * to a player's first few indicators are the ones that never warn.
 *
 * **`Red`, `Green` and `Blue` are the deliberately awkward entries.** They were asked
 * for, and they sit closer to the P&L hues than the rest by their nature — the loss
 * colour *is* a red, the profit colour *is* a green. The values here are the vivid ends
 * of each: far enough from the pair to clear `describeColourRisk` (42, 45 and 169 units
 * of separation respectively, against a threshold of 30) while still being what someone
 * asking for "red" meant. That's a narrower margin than the rest of the palette enjoys,
 * so it's a judgement rather than a guarantee — worth revisiting if a red line and a
 * losing bar turn out to be confusable in play.
 *
 * Every entry is also **light**: a Rec. 601 luma above 0.5, asserted by test, because
 * both moods draw the chart over a sky. That constraint is what rules out a saturated
 * dark red — `#e03131` reads as red on paper and vanishes into `serious`'s dusk.
 *
 * Named because a swatch alone isn't accessible: the names are what a screen reader
 * and a colourblind player get, and picking "Teal" from a list works where picking
 * the third orange square doesn't. A custom value has no name, which is a real cost of
 * the picker and the reason the presets are offered first.
 *
 * ## Why this is in `shared/` and not `content/`
 *
 * Conceptually it belongs with the themes — it's presentation data. But four zones
 * need it: `ui/` for the picker, `render/` for drawing, `engine/` for the volume
 * pane's default, and `plugins/host/` for an instance that arrives without one.
 * `engine/` and `plugins/` may not import `@content`, and weakening that grant to
 * place a colour table would be the wrong trade — `shared/` is precisely the zone
 * every other one may reach. See docs/code-structure.md#dependency-rules.
 */

export interface IndicatorColour {
  name: string
  value: number
}

export const INDICATOR_COLOURS: readonly IndicatorColour[] = [
  { name: 'Teal', value: 0x4fd6c8 },
  { name: 'Violet', value: 0xd2a8ff },
  { name: 'Rose', value: 0xff9ec4 },
  { name: 'Red', value: 0xff4d4d },
  { name: 'Green', value: 0x33dd55 },
  { name: 'Blue', value: 0x8080ff },
  // Last on purpose: these two are the pair that collides with `blue-orange`, so
  // ordering them behind the rest means the colours assigned to a player's first few
  // indicators never warn. See the note above.
  { name: 'Sky', value: 0x4da3ff },
  { name: 'Orange', value: 0xff9d4d },
]

/** Fallback for a colour that isn't in the palette, e.g. from a hand-edited config. */
export const DEFAULT_INDICATOR_COLOUR = INDICATOR_COLOURS[0]?.value ?? 0x4fd6c8

/**
 * The first palette colour not already in use.
 *
 * Deterministic, and it wraps rather than running out — with more instances than
 * colours, reuse is better than refusing to add one. Assigning on *add* rather than
 * by list position is what stops every other line changing colour when you remove
 * one from the middle: a line's colour belongs to the instance, not to its index.
 */
export function nextIndicatorColour(taken: readonly number[]): number {
  const used = new Set(taken)
  for (const colour of INDICATOR_COLOURS) {
    if (!used.has(colour.value)) return colour.value
  }
  return INDICATOR_COLOURS[taken.length % INDICATOR_COLOURS.length]?.value ?? DEFAULT_INDICATOR_COLOUR
}

export function indicatorColourName(value: number): string {
  return INDICATOR_COLOURS.find((colour) => colour.value === value)?.name ?? 'Custom'
}

/** `0xffd166` → `#ffd166`, for a style attribute or an `<input type="color">`. */
export function colourToHex(value: number): string {
  const clamped = Math.max(0, Math.min(0xffffff, Math.round(value)))
  return `#${clamped.toString(16).padStart(6, '0')}`
}

/**
 * `#ffd166` → `0xffd166`, or `undefined` for anything that isn't a 6-digit hex colour.
 *
 * `undefined` rather than a fallback: the caller keeps the previous colour, which is
 * what a half-typed value should do. A native colour input only ever emits the long
 * form, but this also reads a hand-typed one.
 */
export function colourFromHex(hex: string): number | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return undefined
  return Number.parseInt(match[1]!, 16)
}

/** Perceived brightness, 0–1. sRGB coefficients; good enough to spot "too dark". */
function luminance(value: number): number {
  const r = ((value >> 16) & 0xff) / 255
  const g = ((value >> 8) & 0xff) / 255
  const b = (value & 0xff) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Straight-line RGB distance, 0–441. Crude, but it only has to catch near-misses. */
function distance(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff)
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff)
  const db = (a & 0xff) - (b & 0xff)
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/**
 * What's wrong with this colour for a chart overlay, if anything.
 *
 * The two failure modes the fixed palette existed to prevent, reported rather than
 * blocked. Every preset returns `undefined`, which is the property that makes them
 * worth offering first.
 *
 * The P&L pair is passed in rather than imported: this module is in `shared/`, which
 * may not reach `@content`, and the active pair depends on the player's colourblind
 * setting — a warning against the wrong pair would be worse than none.
 */
export function describeColourRisk(
  value: number,
  pnl: { up: number; down: number }
): string | undefined {
  // The menus and every mood's darkest sky sit near #0b0e14, so a very dark line is
  // invisible somewhere in every theme rather than only in one.
  if (luminance(value) < 0.18) return 'Very dark — may vanish against the chart.'

  /**
   * 30 of a possible 441 — near-identical only.
   *
   * Deliberately tight. A looser 60 would also catch `Orange` and `Red` against
   * `red-green`'s down colour, 58 and 42 apart, both of which are tellable from a losing
   * bar in practice — so it would warn about colours that are fine. What survives at 30
   * are the two exact collisions, which are worth a warning: a glance mistakes the line
   * for a bar, and that misreads as information rather than merely being hard to see.
   */
  const NEAR = 30
  if (distance(value, pnl.up) < NEAR) return 'Close to the profit colour — may read as a gain.'
  if (distance(value, pnl.down) < NEAR) return 'Close to the loss colour — may read as a loss.'
  return undefined
}
