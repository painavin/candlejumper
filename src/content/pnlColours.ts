/**
 * The up/down colour pair, in one place.
 *
 * It lives in `content/` rather than `render/` because four zones now need it and
 * `@content` is the only one all of them may import: the top HUD, the juice layer,
 * the candle bodies, and the menus' `--up`/`--down` CSS variables. Before this it
 * was copy-pasted in two files, which is exactly the state in which a colourblind
 * user's setting gets honoured in one place and quietly ignored in another.
 *
 * Taking a plain `string` rather than `@config`'s `PnlPalette` is deliberate:
 * `content/` may not import `@config`, and re-declaring the union here would create
 * a second definition to keep in sync. An unknown id falls back to the default.
 *
 * **Colour is never the only cue.** Every P&L reading also carries a sign and an
 * arrow glyph, and a candle also carries its shape — so `red-green` staying the
 * default costs nothing in legibility. See docs/accessibility.md.
 */

export interface PnlColours {
  up: number
  down: number
}

const PALETTES: Record<string, PnlColours> = {
  'blue-orange': { up: 0x4da3ff, down: 0xff9d4d },
  'red-green': { up: 0x4ddb7a, down: 0xff6b6b },
}

const DEFAULT_PALETTE = 'red-green'

export function pnlColours(palette: string): PnlColours {
  return PALETTES[palette] ?? (PALETTES[DEFAULT_PALETTE] as PnlColours)
}
