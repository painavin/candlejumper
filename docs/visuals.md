# Visuals: Parallax Background System & Visual Themes

## Goal

Give the side scroller a sense of depth using the classic multi-layer
parallax trick, fully configurable, and decoupled from game logic so it can
be built or restyled without touching the trading engine.

## Layers (back to front)

| Layer | Speed (relative to base scroll speed) | Notes |
|---|---|---|
| Sky | ~0 (static or near-static) | Gradient or flat color, can shift with theme |
| Clouds | ~0.2x | Slow drift |
| Mountains | ~0.4x | Mid-distance |
| Trees / background props | ~0.8x | Behind the gameplay plane |
| Poles / ground | 1x | This is the actual gameplay scroll speed |
| Foreground occlusion | ~1.2–1.5x | Grass/leaves/foliage passing *in front* of the character — strongest depth cue in the stack, see [game-feel.md](./game-feel.md#new-depth--motion-refinements). Must stay sparse enough not to obscure poles the player is trading |

Note the stack extends *past* the gameplay plane at the bottom — a layer
in front of the character is what sells 2D depth, and it's easy to omit by
accident when thinking of parallax as "backgrounds."

Speeds are expressed as **multipliers of the base scroll speed**, not
absolute values, so the existing `scrollSpeed` config drives everything
uniformly — turning the dial up speeds up the whole scene coherently. Speed
multipliers are a *motion* property and stay fixed across themes below —
only the asset skin per layer changes with theme, never the parallax math.

## Implementation approach

- **All layers are generated at runtime, not drawn by hand** — see
  [procedural-assets.md](./procedural-assets.md) for the generation
  techniques. The terrain-style layers (mountains, hills, treelines) are
  one fractal-noise heightfield algorithm at different parameters.
- Each layer is baked **once at load** into an offscreen `RenderTexture`,
  then scrolled with a tiling sprite primitive (e.g. PixiJS
  `TilingSprite`) that handles infinite horizontal looping by offsetting a
  UV/texture coordinate. Per-frame cost is then the same as a hand-drawn
  PNG would have been.
- Textures are generated on a circular noise domain so they tile
  seamlessly by construction rather than needing a blended seam.
- Layers are just visual; they should have zero coupling to the trading
  state machine. Safe to build after the core loop works, and safe to skip
  entirely in a headless/test build.

## Visual themes

Mirrors the [audio theme](./audio.md#audio-themes) architecture: one
bundle defines **every background layer plus HUD accents at once**, so
switching mood never leaves layers mismatched (e.g. puffy bright clouds
over a charcoal trading-floor ground).

Because all art is procedural, a theme is a **parameter set, not an asset
bundle** — palette colors plus shape and noise parameters. A new mood is a
new plain data object of roughly 30 lines, with no art production, no
files, and no build step. Conceptually:

```
VisualTheme {
  id, displayName
  palette: { sky: [top, bottom], mountains: [...], trees, candleRange, ground, accent }
  terrain: {
    mountains: { amplitude, frequency, octaves, ridgeSharpness },
    trees:     { amplitude, frequency, density },
  }
  clouds: { style: 'puffy' | 'wispy', density, scale }
  foreground: { motif: 'grass' | 'leaves' | 'railing', density }
  poles: { outline, capStyle }
  accentPalette: HUD/UI colors matching mood
}
```

Rendering code always asks "what does the *current* theme supply for layer
N" — it never branches on theme id. Candle **geometry** is always price data
and never touched by theme. What a theme owns of the bars is colour and corner
style, and nothing else.

Bar *width* deliberately isn't here. A `wickWidthFraction` lived in this block
briefly, so a mood could ship its own chart type; both moods chose the same
value, so it never varied. The width comes from `visuals.barStyle` alone — see
[game-design.md](./game-design.md#candle-geometry).

Note that the body's **up/down colour is deliberately not here**. It comes
from `visuals.pnlPalette`, the same accessibility setting the HUD and the exit
particles read, because a red/green chart is the canonical colourblind hazard.
`palette.candleRange` is the theme's contribution: the colour a direction is
muted *toward* for the high–low range, and the flat colour for a bar with no
direction to report. It controls how dark and how muted a mood's bars are
without owning which way they point.

Note: the jumping character is **not** part of this bundle — see
[character.md](./character.md) for why it's a separate, theme-independent
selection.

### Initial theme set

Named to match the audio themes so a player can pair them, though the two
are independently configurable (see [Config](#config) below). These
describe the *parameter intent*; exact values are tuned in code:

| | **Jolly** | **Serious** |
|---|---|---|
| Sky | Bright blue gradient | Muted slate/dusk gradient |
| Clouds | `puffy`, high density, large scale | `wispy`, low density, thin |
| Mountains | Low ridge sharpness (rounded), saturated greens/purples | High ridge sharpness (angular), desaturated grey-blue |
| Trees / background props | Dense, bright | Sparse, muted — or a skyline silhouette via high frequency + low amplitude |
| Bars | Bollinger bars, rounded corners | Bollinger bars, square corners, outlined |
| Ground | Candy-colored grass | Charcoal/steel |
| Foreground occlusion | `grass` motif, moderate density | `railing` motif, sparse |
| HUD accent palette | Warm, saturated | Cool, professional (navy/graphite) |

Note the "city skyline" idea for Serious falls out of the *same* mountain
generator at different parameters — high frequency, low amplitude, maximum
ridge sharpness — rather than needing separate art. That's the payoff of
themes-as-parameters.

**Theme selection UI**: the settings screen presents a single **"mood"
picker** that sets `visuals.theme` and `audio.theme` together, so the
default experience is always coherent. The two remain separate config keys
underneath, independently editable for anyone who wants to mix a jolly
world with serious audio. Default: `jolly`, for approachability on first
launch.

**Future extension, not built now**: day/night could become an orthogonal
lighting variant composed *within* whichever theme is active (e.g.
"Jolly — Night") rather than a competing theme axis — don't design for this
yet, just don't preclude it.

## Config

- Per-layer enable/disable.
- Per-layer speed multiplier (defaults above, but tunable).
- `visuals.theme` — selects the active theme parameter set (see above).
- `visuals.worldSeed` — seeds the PRNG that generates the layers, so a
  given theme + seed always produces an identical world. See
  [procedural-assets.md](./procedural-assets.md#determinism--seeded-prng-never-mathrandom).
- See [config.md](./config.md) for the full key reference.

## Stretch goal (not in initial scope)

Tie background mood to trading state — e.g. desaturate or redden the scene
during a drawdown, brighten during a profitable stretch. Cheaper than it
sounds now that themes are parameter sets: this becomes interpolating
palette values rather than swapping assets. Still not designed yet; just
don't preclude it (keep theme selection driven by a function of game state,
not hardcoded at load time).

