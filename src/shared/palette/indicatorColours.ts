/**
 * The colours an indicator line can be drawn in.
 *
 * A **fixed palette rather than a free colour picker**, which is the decision worth
 * recording. An arbitrary hex value lets a player pick something that vanishes into
 * the sky, or a red that reads as a losing bar — the two things a chart overlay must
 * never do. Constraining the choice means every option is legible against both moods
 * and none of them collide with the P&L palette's up/down pair.
 *
 * Named because a swatch alone isn't accessible: the names are what a screen reader
 * and a colourblind player get, and picking "Amber" from a list works where picking
 * the third orange square doesn't.
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
  { name: 'Amber', value: 0xffd166 },
  { name: 'Sky', value: 0x4da3ff },
  { name: 'Orange', value: 0xff9d4d },
  { name: 'Mint', value: 0x9dd6a0 },
  { name: 'Violet', value: 0xd2a8ff },
  { name: 'Teal', value: 0x4fd6c8 },
  { name: 'Rose', value: 0xff9ec4 },
  { name: 'Sand', value: 0xe8dcc0 },
]

/** Fallback for a colour that isn't in the palette, e.g. from a hand-edited config. */
export const DEFAULT_INDICATOR_COLOUR = INDICATOR_COLOURS[0]?.value ?? 0xffd166

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
