# Roadmap / Build Order

Sequenced so core mechanics are correct and feel right *before* visuals and
audio are layered on — both of those are additive and shouldn't drive
changes to the trading engine or state machine.

All design decisions are settled; see [config.md](./config.md) for the
resolved defaults and each system doc for its rationale.

0. **Scaffolding.** Vite + TypeScript + Svelte project; PixiJS and Tone.js
   dependencies; seeded PRNG helper
   ([procedural-assets.md](./procedural-assets.md#determinism--seeded-prng-never-mathrandom))
   plus the lint rule banning `Math.random()`; Vitest harness
   ([tech-stack.md](./tech-stack.md#testing)); directory layout that keeps
   the trading engine free of any PixiJS/DOM imports so it stays
   unit-testable headless. Bundle the first OHLCV dataset
   ([data-sources.md](./data-sources.md)). No asset pipeline is needed —
   there are no art or audio files.
   - **0a. Screen layout wireframe.** Before writing the render loop,
     compose one wireframe showing the top HUD, right-edge axis, character
     at ~70–80% right, sub-panes, and mobile control strip *together* — in
     both landscape and portrait. Each piece is specified in isolation
     across [hud.md](./hud.md) and [controls.md](./controls.md), but nothing
     has yet shown them coexisting, and portrait phone is where they're
     most likely to conflict (60 bars + a volume pane + a thumb strip is
     tight). Cheap to catch now, expensive mid-implementation.
1. **Scrolling poles from static price data, plus the auto-scaling Y-axis.**
   No trading input yet. Wire up `scrollSpeed` in bars/second,
   `visibleBarCount`-derived bar geometry, and time-based (never
   frame-based) motion
   ([game-design.md](./game-design.md#scroll-speed-timing-and-pole-geometry));
   the `visible-window-min-max` normalizer; and the eased Y-axis that reads
   off that same normalizer ([hud.md](./hud.md)) — the chart is close to
   unreadable without it, and easing is load-bearing here rather than
   cosmetic. Render a placeholder character shape; the real rigs come in
   step 6a.
   **Spawn poles only when they reach the character** — never render
   unplayed bars ([game-design.md](./game-design.md#pole-generation--scroll)).
   That makes the no-lookahead constraint structural rather than dependent
   on fog opacity, and it's the cheapest possible moment to get right.
   Include the **bar-forming growth animation** and the **fixed-height hop**
   from the same doc — both are direct consequences of not rendering the
   future, not polish, so building them later would mean reworking the
   motion code.
2. **Buy/sell state machine + auto-bounce.** Signed position size from the
   start ([game-design.md](./game-design.md#shorting)) even though
   `allowShorting` ships off — retrofitting sign into a scalar position
   later would touch cost basis, P&L, stops, and rendering at once. Fixed
   unit size for now to isolate the state machine. Input bindings per
   [controls.md](./controls.md). Character animation hooks (`idle`,
   `bounce`, and the vertical flip for shorts) against the placeholder.
3. **Configurable sizing, cost basis, capital, and core HUD.**
   `startingCapital` and buying-power limits; `buyUnitSize`/`sellUnitSize`;
   weighted-average cost basis; the edge-case rules in
   [game-design.md](./game-design.md#trade-rules--edge-cases). Top HUD
   ([hud.md](./hud.md)): realized P&L in both currency and percent,
   position size/avg cost, unrealized P&L, session info. Also fold in the
   streak/multiplier scoring layer
   ([game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-streaks--multipliers))
   — it touches the scoring path rather than being pure presentation.
   Unit-test the engine hard here, long *and* short side
   ([tech-stack.md](./tech-stack.md#testing)).
4. **Stop loss / trailing stop with auto-close.** Percent units, close-based
   triggering, inverted for shorts
   ([game-design.md](./game-design.md#risk-management)). Distinct
   "stopped-out" feedback path (visual at minimum; audio in step 7) and the
   stop level drawn on the chart per [hud.md](./hud.md#top-hud).
5. **Settings panel UI + persistence.** Surface every config from
   [config.md](./config.md) that exists so far. A **pre-run screen**, not a
   mid-run overlay — config is fixed for a run's duration, so the flow is
   settings → run → results. Add the storage adapter
   ([tech-stack.md](./tech-stack.md#persistence)), versioned from the first
   write.
6. **Procedural background generation + parallax.**
   [visuals.md](./visuals.md) and
   [procedural-assets.md](./procedural-assets.md) — the fractal-noise
   heightfield generator (one algorithm serving mountains, hills, and
   treelines), cloud and foreground-motif generators, seamless circular-domain
   tiling, and baking each layer once at load into a `RenderTexture`.
   Purely additive, zero coupling to game logic. Build against the `jolly`
   theme parameter set first, then add `serious` as pure numbers — no new
   code, which is the payoff of themes-as-parameters.
   - **6a. Character rigs.** [character.md](./character.md) — replace the
     placeholder with the real primitive rigs (`robin`, `bull`, `bear`),
     math-driven bounce/squash animation, the vertical flip for shorts, and
     the ghost-stack position-size visualization. Budget iteration time for
     tuning how the bounce *feels*; that replaces animation work rather than
     eliminating it. Independent of visual theme, so this can happen
     alongside or after 6 in either order.
7. **Audio synthesis.** [audio.md](./audio.md) — all three channels via
   Tone.js, including the generative ambient bed (fixed per-theme chord
   progression, randomized voicing), movement sonification, and event
   stingers including the distinct stop-out alarm from step 4. Build against
   one theme parameter set first; the second is again just numbers.
8. **Indicator plugin architecture + volume pane.**
   [indicators.md](./indicators.md) — our own overlay/oscillator contract,
   Web Worker plugin sandboxing, the sub-pane renderer and its vertical
   layout budget ([hud.md](./hud.md#sub-pane-vertical-layout)), the volume
   toggle, and one initial built-in indicator (Simple Moving Average) to
   prove the contract end-to-end. Oscillator normalization follows the same
   causality rule as poles.
9. **Game feel & polish pass.** [game-feel.md](./game-feel.md) — floating
   P&L text, HUD number tweening, screen shake/particles, results/summary
   screen, progression/unlockables, date banners and event flags, title
   screen with attract mode, screen transitions, session variety, haptics.
   Mostly presentation on top of events steps 1–8 already emit. Apply
   [accessibility.md](./accessibility.md) here: colorblind-safe P&L
   encoding, reduced-motion handling, minimum font sizes.
10. **Additional data sources**, expanding beyond the bundled OHLCV dataset
    used since step 0 ([data-sources.md](./data-sources.md)) — live API
    and/or synthetic, both behind the existing interface.
11. **Packaging**: desktop via Tauri first (Windows/macOS/Linux share one
    build), then Android via Capacitor.

## Deferred by design (not open questions)

Deliberately out of scope for now, each noted in its own doc so the
reasoning isn't lost: mood-reactive backgrounds (cheaper now that themes
are parameter sets — interpolating palette values rather than swapping
assets) and drawdown-reactive bed voicing; day/night as an orthogonal
lighting variant within a theme; FIFO cost basis (config option,
unimplemented); a post-run review/replay mode that would allow the
full-series normalization methods; theme-specific character variants;
rebindable controls; indicators beyond Simple Moving Average; shorting
exposed in the UI (`allowShorting` ships off, engine supports it).

## Notes on tuning and validation

- **The numeric defaults marked _provisional_ in
  [config.md](./config.md) are starting points, not considered values.**
  `scrollSpeed`, `visibleBarCount`, `buyUnitSize`, and `sellUnitSize` were
  chosen for internal consistency and will move once the game is playable.
- **Step 3 is not a go/no-go gate.** The design goal is training, not
  arcade fun, so a thin platforming layer is intended rather than a risk to
  validate away. What step 3 *is* worth pausing on is whether the trading
  feedback reads clearly — whether a player can tell what just happened to
  their position and why — since everything from step 6 onward is polish on
  top of that legibility.
- One thing to watch in playtesting rather than decide upfront: whether the
  streak multiplier ever rewards trading behavior a real trader shouldn't
  have (e.g. panic-scalping tiny wins to protect a streak). Raw P&L stays
  visible alongside it so the distortion would be visible if it appears.
