import type { VisualTheme } from './types.js'

/**
 * Five moods, as plain data. A sixth is another object of this size — no pipeline, no
 * files, no build step.
 *
 * The generator does the work the art would have. `serious`'s "city skyline" is the same
 * mountain call as `jolly`'s rolling hills at high frequency and maximum ridging;
 * `vapour`'s forest of spikes is that again, denser; `cobalt`'s smooth bands are it with
 * the ridging turned off. Nothing in `generation/` knows how many moods exist.
 *
 * Two rules learned the hard way, both recorded on the themes that learned them:
 *
 * 1. **A dark mood still needs a contrast ladder.** `neon` first shipped with every
 *    background layer inside a 0.03–0.25 luma band and read as a black rectangle. What
 *    makes a layer visible is its gap against the sky *at the height it sits* — not its
 *    absolute darkness, and not whether the palette looks varied in a list.
 * 2. **`palette.candleRange` is not decoration.** It is mixed 62% into every high–low
 *    range, so a saturated theme neutral quietly drains the direction out of the bars
 *    while every existing test still passes. `neon` and `vapour` both had to give up the
 *    reference colour here; `candleColour.test.ts` pins a minimum hue margin so the next
 *    one fails loudly instead.
 *
 * All five are **moods**: the picker shows ids present in both this registry and
 * `audioThemes`, and every id here has a counterpart there. Adding a visual theme without
 * an audio one leaves it reachable only from the "Mix them" disclosure — which is where
 * these three sat until their audio bundles existed. See `ui/screens/Settings.svelte`.
 */

export const jollyTheme: VisualTheme = {
  id: 'jolly',
  displayName: 'Jolly',
  palette: {
    sky: [0x2f6ea8, 0x8fc4e8],
    mountains: [0x5b4b8a, 0x7a6bb0],
    trees: 0x2f7d4f,
    candleRange: 0x33405c,
    ground: 0x3e8a58,
    groundLine: 0x2b6b42,
    clouds: 0xffffff,
    foreground: 0x276b41,
  },
  // `dim` is lighter than it looks like it should be, on purpose: with an outline
  // behind every glyph, secondary text reads as light-on-dark-edge, so pushing it
  // *toward* white raises contrast rather than lowering it.
  accent: {
    text: 0xffffff,
    dim: 0xe4f0fb,
    axisLine: 0x9dc4e0,
    accent: 0xffd166,
    outline: 0x10314a,
  },
  terrain: {
    mountainsFar: { amplitude: 0.42, frequency: 3.2, octaves: 4, ridgeSharpness: 0.1, gain: 0.5 },
    mountainsNear: { amplitude: 0.3, frequency: 5.1, octaves: 4, ridgeSharpness: 0.15, gain: 0.5 },
    trees: { amplitude: 0.2, frequency: 14, octaves: 3, ridgeSharpness: 0.05, gain: 0.55 },
  },
  clouds: { style: 'puffy', density: 7, scale: 0.1 },
  // Sparse on purpose: this layer crosses the character, and it must never
  // obscure poles the player is trading.
  // Busiest foreground of the five, whichever shape the seed picks for it.
  foreground: { densityScale: 1.15 },
  poles: { capStyle: 'round', outline: false },
}

export const seriousTheme: VisualTheme = {
  id: 'serious',
  displayName: 'Serious',
  palette: {
    sky: [0x1b2331, 0x3d4a5c],
    mountains: [0x2a3341, 0x374250],
    trees: 0x2b3542,
    candleRange: 0x8fa3bd,
    ground: 0x222b36,
    groundLine: 0x39465a,
    clouds: 0x9aa8b8,
    foreground: 0x1a222c,
  },
  accent: {
    text: 0xe6edf5,
    dim: 0xa8b8cc,
    axisLine: 0x44536a,
    accent: 0x4da3ff,
    outline: 0x080d14,
  },
  terrain: {
    mountainsFar: { amplitude: 0.46, frequency: 2.6, octaves: 5, ridgeSharpness: 0.85, gain: 0.48 },
    // The skyline: high frequency, low amplitude, maximum ridging.
    mountainsNear: { amplitude: 0.26, frequency: 22, octaves: 2, ridgeSharpness: 1, gain: 0.4 },
    trees: { amplitude: 0.12, frequency: 30, octaves: 2, ridgeSharpness: 0.9, gain: 0.5 },
  },
  clouds: { style: 'wispy', density: 4, scale: 0.14 },
  foreground: { densityScale: 0.9 },
  // A Bollinger bar: range and body the same width. Rounded like `jolly`'s — the
  // corner is not what separates the two moods; the outline is.
  poles: { capStyle: 'round', outline: true },
}

/**
 * Glowing instrument on near-black: cyan grid, ember accent.
 *
 * Taken from a reference image rather than invented, which is why the numbers sit
 * where they do. Two things carry the look, and neither is a new renderer feature.
 *
 * **The glow is `groundLine` and `outline`, not a shader.** There is no bloom pass in
 * this renderer and adding one for a mood would be the wrong trade, so the neon comes
 * from a bright grid line against a near-black ground and a teal rim on every bar —
 * the two places a thin bright stroke already sits on a dark fill.
 *
 * **The scene is dark, not absent.** The first version took "near-black" literally and
 * put every background layer inside a 0.03–0.25 luma band with the terrain amplitudes
 * halved, chasing the reference's empty grid plane. On a real chart that reads as a
 * black rectangle: what makes a silhouette visible is its gap against the sky *at the
 * height it sits*, and that gap was 0.025 — a tenth of `jolly`'s. The layers now step
 * 0.09/0.08/0.06 apart on a 0.19 sky span, which is wider than `serious` manages, and
 * the amplitudes are back up so there is a shape to see the contrast on. Being the
 * darkest mood is a look; being an unreadable one is a bug.
 *
 * The one number that fought back was `candleRange` — see its own note below. A
 * saturated theme neutral is the mix target for every high–low range, so it can quietly
 * drain the direction out of the bars, and the existing cross-theme tests pass long
 * after that has happened. It was settled by measuring the hue margin across both P&L
 * palettes rather than by eye.
 */
export const neonTheme: VisualTheme = {
  id: 'neon',
  displayName: 'Neon',
  palette: {
    // Dark violet-navy overhead to a lit horizon, the same dark-top-to-light-bottom
    // direction as the other two moods. The span is what matters more than the floor:
    // 0.19 here against `serious`'s 0.15, so the gradient itself is legible.
    sky: [0x0b1a2e, 0x1e5480],
    mountains: [0x0d1f36, 0x143050],
    trees: 0x0e2a38,
    /**
     * The grid teal, pulled back from the reference's own saturation on purpose.
     *
     * This is the mix target for every range and the rim colour on every bar, so it
     * decides whether a falling bar still reads as falling. The reference's full-strength
     * teal (`0x1f5a6b`) passes every test in `candleColour.test.ts` and is still wrong:
     * under the colourblind-safe `blue-orange` palette its falling range lands on
     * `#747360`, an olive-grey whose red channel leads by **one** — a rounding step from
     * losing the direction entirely, in exactly the palette chosen by the players who can
     * least afford it. Desaturating to here restores a 18–28 margin across both palettes,
     * in family with the other two moods, and costs nothing visible: the neon identity is
     * carried by `groundLine` and the bar rim, not by this.
     */
    candleRange: 0x2b4a5a,
    ground: 0x0f2231,
    // Deliberately the brightest colour in the palette, and the only one far from its
    // own layer's fill — 0.52 luma above the ground it sits on. That single stroke is
    // what reads as a lit grid: the cheapest available stand-in for a glow.
    groundLine: 0x2ad4e8,
    // Well clear of the sky rather than just above it, because these are the reference's
    // out-of-focus blooms and a bloom that matches its background is invisible.
    clouds: 0x3d7fa0,
    foreground: 0x0a1a24,
  },
  accent: {
    text: 0xeaf8ff,
    dim: 0xb8e4f2,
    axisLine: 0x2a6b82,
    // Ember orange against the cyan, which is the reference's own contrast and the
    // reason it reads as more than a blue picture. Also the Play button's fill, and
    // that button's label is dark — so this has to stay light enough to sit under it.
    accent: 0xff7a3c,
    outline: 0x03070e,
  },
  terrain: {
    // Amplitudes in family with `serious` rather than halved. The first pass cut them to
    // chase the reference's empty grid plane and got an empty screen: contrast needs a
    // shape to sit on, and a 0.16-amplitude ridge is too small to show a 0.06 luma step.
    mountainsFar: { amplitude: 0.5, frequency: 2, octaves: 5, ridgeSharpness: 0.92, gain: 0.5 },
    // A band of sharp teeth rather than a skyline: the far edge of the grid.
    mountainsNear: { amplitude: 0.3, frequency: 18, octaves: 2, ridgeSharpness: 1, gain: 0.4 },
    trees: { amplitude: 0.16, frequency: 34, octaves: 2, ridgeSharpness: 1, gain: 0.45 },
  },
  // Sparse and large: the soft out-of-focus blooms behind the reference's chart, closer
  // to lens bokeh than to weather. Denser than the first pass, which had three per tile
  // and so left most screens with none at all.
  clouds: { style: 'wispy', density: 5, scale: 0.16 },
  foreground: { densityScale: 1 },
  poles: { capStyle: 'round', outline: true },
}

/**
 * Vapourwave: hot magenta grid, cyan accent, bokeh everywhere.
 *
 * The loudest mood, and the one where the reference's own colours were the least
 * usable directly. Its saturated magenta is a red-and-blue colour with almost no
 * green in it, and `candleRange` is mixed 62% into every high–low range — so taken
 * literally it drains a *rising* bar's green away. Hand-picked violets bore that out:
 * `0x4a2a5c` leaves the rising range with a 6-point hue lead and `0x5c3370` fails
 * outright. The shipped neutral is a plum found by searching the family for the widest
 * margin, and it reaches 20 — level with `jolly`.
 *
 * So the magenta lives where nothing derives from it: `groundLine`, the sky's lower
 * half, and the cloud blooms. That split — identity in the layers, restraint in the one
 * colour the bars read — is the same conclusion `neon` reached, arrived at twice.
 *
 * `clouds` is `puffy` at high density and small scale, which is this generator's closest
 * approach to the reference's scattered bokeh dots; the other dark mood uses `wispy` for
 * the same layer, and that one parameter is most of what separates them at a glance.
 */
export const vapourTheme: VisualTheme = {
  id: 'vapour',
  displayName: 'Vapour',
  palette: {
    sky: [0x1a0b2e, 0x6e1f92],
    mountains: [0x24103a, 0x391858],
    trees: 0x2b1242,
    /**
     * A plum, not the reference's magenta — see the note above. Found by searching the
     * violet family against every invariant in `candleColour.test.ts` rather than
     * chosen: the eye reaches for the saturated version, and the saturated version is
     * exactly what flattens a rising bar to grey.
     */
    candleRange: 0x642c48,
    ground: 0x1e0f2e,
    // The hot magenta the whole mood is named for, spent on the one stroke that can
    // carry it without touching the bars: 0.42 luma clear of the ground beneath it.
    groundLine: 0xff35c8,
    clouds: 0xb0479e,
    foreground: 0x140a20,
  },
  accent: {
    text: 0xfdeaff,
    dim: 0xe2bff2,
    axisLine: 0x7a3f8e,
    // Cyan against the magenta, which is the reference's own contrast — and the reason
    // the picture reads as more than one colour turned up.
    accent: 0x2ff0e0,
    outline: 0x0a0412,
  },
  terrain: {
    mountainsFar: { amplitude: 0.48, frequency: 2.4, octaves: 5, ridgeSharpness: 0.8, gain: 0.5 },
    // Dense sharp spikes: the reference is a forest of thin vertical bars, and maximum
    // ridging at high frequency is how this generator says that.
    mountainsNear: { amplitude: 0.32, frequency: 24, octaves: 2, ridgeSharpness: 1, gain: 0.42 },
    trees: { amplitude: 0.18, frequency: 44, octaves: 2, ridgeSharpness: 1, gain: 0.45 },
  },
  clouds: { style: 'puffy', density: 9, scale: 0.09 },
  foreground: { densityScale: 1.1 },
  poles: { capStyle: 'round', outline: true },
}

/**
 * Clean cobalt: a bright azure sky over deep blue, no glow.
 *
 * The only mood whose sky runs **light at the top and dark at the bottom**. Every other
 * one darkens upward, which is what a sky does; this reference is lit from above centre
 * and deepens toward the floor, and following it is what makes the mood read as a
 * presentation chart rather than a landscape. It is a two-number inversion, and worth
 * having precisely because nothing in the renderer had to know.
 *
 * That inversion moves the terrain, too. With the sky at its *darkest* where the hills
 * sit, a conventional dark silhouette disappears — the first attempt left `mountainsFar`
 * 0.024 from its own background. So the layers are **lighter** than the sky they stand
 * on, which is also what the reference does: pale translucent columns over a deep base.
 * Low `ridgeSharpness` throughout keeps them smooth, because this is the one mood with
 * nothing jagged in it.
 *
 * `outline: false` and no bright `groundLine` glow: the reference's candles are flat
 * fills on a clean gradient. This is the mood that demonstrates a theme can be quiet.
 */
export const cobaltTheme: VisualTheme = {
  id: 'cobalt',
  displayName: 'Cobalt',
  palette: {
    // Inverted on purpose: bright overhead, deep at the horizon. Also the widest sky
    // span of any mood at 0.30, which is what stops a single-hue scene reading as flat.
    sky: [0x1789d6, 0x0d2076],
    mountains: [0x3a72c8, 0x4a8ade],
    trees: 0x3060a8,
    /**
     * A slate blue, and close to `jolly`'s by necessity rather than by copying: the
     * deep royal blues this reference is actually made of (`0x2c4a8a` among them) fail
     * the range invariants, because a neutral that saturated overwhelms a red body once
     * it is 62% of the mix. The blue identity is carried by the sky and the terrain,
     * which nothing derives from.
     */
    candleRange: 0x304864,
    ground: 0x071043,
    groundLine: 0x6fc8ff,
    clouds: 0x9ed4f8,
    foreground: 0x050b30,
  },
  accent: {
    text: 0xf2f8ff,
    dim: 0xcfe4f8,
    axisLine: 0x5a8fd0,
    accent: 0x74c7ff,
    outline: 0x061033,
  },
  terrain: {
    mountainsFar: { amplitude: 0.4, frequency: 3, octaves: 4, ridgeSharpness: 0.08, gain: 0.5 },
    mountainsNear: { amplitude: 0.3, frequency: 8, octaves: 3, ridgeSharpness: 0.05, gain: 0.5 },
    trees: { amplitude: 0.16, frequency: 18, octaves: 3, ridgeSharpness: 0.05, gain: 0.5 },
  },
  clouds: { style: 'wispy', density: 3, scale: 0.16 },
  // Sparsest: this mood reads as an instrument, and clutter fights that.
  foreground: { densityScale: 0.8 },
  // No rim. The reference's candles are flat fills, and this is the mood that shows a
  // theme is allowed to add nothing.
  poles: { capStyle: 'round', outline: false },
}

export const visualThemes: readonly VisualTheme[] = [
  jollyTheme,
  seriousTheme,
  neonTheme,
  vapourTheme,
  cobaltTheme,
]

export function visualTheme(id: string): VisualTheme {
  return visualThemes.find((theme) => theme.id === id) ?? jollyTheme
}
