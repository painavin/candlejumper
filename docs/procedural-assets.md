# Procedural Asset Generation

## Decision

**Every visual and audio asset is generated at runtime. The project ships
zero art files and zero audio files.** Art direction is committed to a
flat, silhouette-driven geometric look (the space Alto's Odyssey and
Canabalt live in) rather than cartoon illustration — that's an aesthetic
commitment, not just a technical one, and everything below assumes it.

The only binary asset in the build is a web font.

## Why this fits this game specifically

- The world is decorative. Poles carry all the real information; mountains
  and clouds exist for depth and mood, so they don't need to depict
  anything in particular. Procedural generation is a poor fit when art has
  to communicate specifics, and a great fit when it just has to look good.
- It removes the single largest schedule risk for a solo project — asset
  production — and it removes it permanently rather than deferring it.
- A **theme collapses from an asset bundle into a parameter set** (palette
  + shape params + noise params + chord progression). Adding a third or
  fourth mood costs no art production at all, just numbers.

## The core rule: generate once, not per frame

Generate into an offscreen `RenderTexture` **at load time**, then hand that
texture to `TilingSprite` for scrolling. Per-frame cost then equals what a
hand-drawn PNG would have cost. Redrawing vector shapes every frame is the
trap that makes procedural rendering seem expensive; baking avoids it
entirely.

Exception: the character rig is drawn live each frame (see below), because
its animation *is* the transform math. It's a handful of primitives, so
this is cheap.

## Determinism — seeded PRNG, never `Math.random()`

Reproducibility is a hard requirement, not a nicety: personal-best
comparison and the seeded "daily ticker" idea in
[game-feel.md](./game-feel.md) both need the same inputs to produce the
same run. So:

- Use a small seeded PRNG (mulberry32 / xorshift128 — a few lines, no
  dependency). **`Math.random()` is banned repo-wide, with no exemptions** —
  a lint rule is worth the five minutes, and a blanket rule is worth more
  than a scoped one, since an exemption comment is exactly what a stray
  PRNG call would hide behind.
- The one legitimate need for real entropy is minting a new
  `visuals.worldSeed` for a run. That lives in a single `mintSeed()` in
  `shared/math/` backed by `crypto.getRandomValues`, so entropy has exactly
  one door and everything downstream of the seed is deterministic. See
  [code-structure.md](./code-structure.md#src).
- `theme + seed` must always produce a byte-identical world. That makes
  generation **snapshot-testable**, which is a nice side benefit: a
  regression in the noise pipeline shows up as a failing test rather than
  as "the mountains look a bit off now."
- Surface the seed somewhere (results screen or settings), so a
  particularly good-looking world can be recovered.

## Visual generation techniques

### Background layers

All the terrain-style layers are the same algorithm at different
parameters — one implementation, reused:

- **Mountains / hills / treelines**: generate a 1D heightfield with
  fractal noise (fBm, or midpoint displacement for a crisper ridged look),
  then render as a filled polygon path. Amplitude, frequency, octaves, and
  ridge sharpness are theme parameters. Distant layers get lower amplitude
  and higher frequency; near layers the opposite.
- **Clouds**: unions of a few overlapping circles with soft alpha, placed
  by the PRNG at varying scales — or thresholded 2D noise for a wispier
  look. Cloud style is a theme parameter (`puffy` vs `wispy`).
- **Sky**: a vertical gradient between two palette colors. Nothing to
  generate beyond interpolation.
- **Foreground occlusion**: sparse repeated primitive motifs (grass blades
  as tapered triangles, leaves as ellipses) scattered by the PRNG along the
  strip, drawn at high alpha since this layer passes in front.
- **Tileability**: each layer's texture must loop seamlessly. Generate the
  heightfield on a circular domain (sample noise around a loop rather than
  along a line) so the left and right edges match by construction — much
  more reliable than generating a strip and trying to blend the seam.

### Poles

Already procedural by definition — height comes from price data. Theme
supplies fill color, outline treatment, and cap style. Draw as rectangles
with optional rounded caps; no texture needed.

### Leading-edge fog

A gradient rectangle in the theme's fog color, drawn above the world layers
and below the HUD. Since unplayed poles are never rendered at all (see
[game-design.md](./game-design.md#pole-generation--scroll)), the fog is
purely atmospheric and carries no information-hiding burden.

## Character generation

Characters are **primitive rigs animated by math**, not spritesheets.

- A character is a small tree of primitives (ellipses, triangles, arcs)
  with parameterized positions, sizes, and palette slots.
- Animation is transform functions driven by continuous state — bounce
  phase, vertical velocity, position direction:
  - **Squash-and-stretch** becomes a function of vertical speed, which is
    *better* than fixed frames: it responds continuously instead of
    snapping between poses.
  - **Wing flap / limb motion** is a sine function of bounce phase.
  - **`bounceShort`** is a sign flip on the vertical axis — free.
  - **Ghost stack** ([character.md](./character.md#position-size-visualization))
    re-renders the same rig at reduced alpha and offset — also free.
- Cost, stated honestly: personality lives in numeric constants you tune in
  code rather than in an art tool, and expressiveness is bounded by what
  primitives convey. Robin, Bull, and Bear will read as distinct
  silhouettes, not as illustrated characters.

## Audio generation

All three channels from [audio.md](./audio.md) are synthesized by Tone.js.
No audio files.

- **Channels 2 and 3** (sonification, stingers) were already synthesis —
  unchanged.
- **Channel 1, the ambient bed**, is now generative: a **fixed chord
  progression per theme** with randomized voicing, register, and timing
  over a pad or plucked instrument. Fixing the progression per theme is the
  deliberate mitigation for generative ambient's known failure mode —
  wandering aimlessly and becoming monotonous. The randomness lives in the
  surface, not the harmony.
- Reverb/delay sends are theme parameters, since ambience does more for
  perceived mood than note choice does.

## Theme = parameter set

Both [visuals.md](./visuals.md) and [audio.md](./audio.md) now define
themes as parameter sets rather than asset bundles. Practically this means
a theme is a plain data object of roughly 30 lines, and a new mood is a
new object — no pipeline, no files, no build step.

## Performance budget

- **Load-time generation must stay under ~500ms on a mid-range phone**,
  since it happens once per run start. If it exceeds that, generate the
  distant layers first and fill nearer layers in progressively — the
  player is looking at the chart, not the mountains.
- Texture memory: keep each layer's baked texture at most ~2× viewport
  width. Longer strips reduce visible repetition but cost memory on
  mobile; 2× is a reasonable balance and repetition in a fast-scrolling
  distant layer is barely perceptible.
- Regenerate only on theme change or new run, never mid-run.

## What is *not* generated

- **Fonts** — use a web font. Generating glyphs is effort with no payoff.
- **UI icons** — simple vector paths drawn directly, or font glyphs.
- **Nothing else.** There is no asset pipeline, no texture atlas to build,
  no art tooling in the toolchain.
