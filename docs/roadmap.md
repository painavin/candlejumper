# Roadmap / Build Order

Sequenced so core mechanics are correct and feel right *before* visuals and
audio are layered on — both of those are additive and shouldn't drive
changes to the trading engine or state machine.

All design decisions are settled; see [config.md](./config.md) for the
resolved defaults and each system doc for its rationale.

0. **Scaffolding.** Vite + TypeScript + Svelte project; PixiJS and Tone.js
   dependencies; seeded PRNG helper and the `mintSeed()` entropy helper
   ([procedural-assets.md](./procedural-assets.md#determinism--seeded-prng-never-mathrandom))
   plus the lint rule banning `Math.random()` repo-wide with no exemptions;
   Vitest harness
   ([tech-stack.md](./tech-stack.md#testing)); the folder layout and
   import-zone lint rules from
   [code-structure.md](./code-structure.md#dependency-rules), which are what
   keep the trading engine free of any PixiJS/DOM imports so it stays
   unit-testable headless. Bundle the first OHLCV dataset
   ([data-sources.md](./data-sources.md)). No asset pipeline is needed —
   there are no art or audio files.
   - **0a. Screen layout wireframe — done.** Composed wireframes for
     landscape and portrait live in
     [hud.md](./hud.md#screen-layout). They already surfaced three real
     conflicts: `visibleBarCount` must be orientation-aware (60 poles is
     ~4px wide on a phone), the portrait top HUD only fits two lines so
     buying power and full session info move to the pause screen, and the
     fog strip can't be narrower than the Y-axis labels need.
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
   Build the loop's **stall rules here too** — one bar tick per frame, the
   accumulator clamped to a single bar's duration, and auto-pause on
   `visibilitychange`
   ([game-design.md](./game-design.md#scroll-speed-timing-and-pole-geometry)).
   They're three lines in the loop now; discovering them later means
   discovering them as wrong P&L, since banked bars apply buffered presses to
   bars they were never aimed at.
2. **Buy/sell state machine + auto-bounce + tick pipeline.** Signed
   position size from the start
   ([game-design.md](./game-design.md#shorting)) even though
   `allowShorting` ships off — retrofitting sign into a scalar position
   later would touch cost basis, P&L, stops, and rendering at once. Build
   the ordered tick pipeline
   ([game-design.md](./game-design.md#tick-pipeline)) here rather than
   letting ordering emerge — it's what makes same-bar interactions
   deterministic. Fixed unit size for now to isolate the state machine.
   Input bindings and buffering per [controls.md](./controls.md). Character
   animation hooks (`idle`, `bounce`, and the vertical flip for shorts)
   against the placeholder.
3. **Sizing, cost basis, capital, and core HUD.** `startingCapital`,
   buying-power clamps, and the short account model; `entrySize` and
   unit-counted exits (N entries → exactly N exits, including the clamped
   runt unit and the dust-entry guard); flatten-on-hold
   ([controls.md](./controls.md#flatten-close-everything)); fractional
   shares and the flat threshold; weighted-average cost basis; the
   edge-case rules — all in
   [game-design.md](./game-design.md#order-intent-matrix). Top HUD
   ([hud.md](./hud.md#top-hud)): P&L in currency and percent, signed
   position with explicit LONG/SHORT, avg cost, unrealized P&L, buying
   power, session info, **and reserved space for the streak meter**. Build
   the campaign vs. close-event stat units here
   ([game-design.md](./game-design.md#what-counts-as-one-trade)) — the
   discipline streak in step 4 ticks on close events, so the unit has to
   exist first.
   Unit-test the engine hard here, long *and* short side
   ([tech-stack.md](./tech-stack.md#testing)).
4. **Stop plugin system.** [stops.md](./stops.md) — the `StopPlugin`
   contract, the bar-N-computes / bar-N+1-enforces timing rule,
   **advisory mode** (display-only stops that record compliance events
   instead of closing), multiple-active-stop resolution, and the two
   built-ins (`fixed-percent`, `trailing-percent`). Close-based triggering,
   inverted for shorts. Distinct "stopped-out" feedback path (visual at
   minimum; audio in step 7), and stop levels drawn on the chart — dashed
   for advisory, solid for enforcing ([hud.md](./hud.md#top-hud)). Include
   the engine guard that coerces any non-finite stop level to `null`
   ([stops.md](./stops.md#warm-up-must-produce-null-never-a-nan-level)) — a
   `NaN` level is worse than no stop, since every comparison against it is
   false. Take `StopInstance.onBar`'s indicator argument now even though it's
   always empty here; the mechanism arrives in step 8 but the signature
   shouldn't change twice. This lands before the general plugin host in step
   8 because the built-ins are needed for gameplay; the sandbox for
   *user-supplied* stop plugins arrives with step 8's shared host.
   **The discipline streak lands here, not in step 3.** It ticks on rule
   compliance rather than profit
   ([game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-the-discipline-streak)),
   so it can't exist before there's a committed rule to comply with — build
   the streak, the ×5 multiplier, `arcadeScore`, and the meter's live /
   automated / dormant states alongside the advisory-breach compliance event
   that drives the reset. One signal, two consumers. This is also where the
   shipped default of one advisory `trailing-percent`
   ([config.md](./config.md#stops)) starts applying, so step 4 is the first
   step whose default configuration has a risk rule in it.
5. **Settings panel UI + persistence + run lifecycle.** Surface every config
   from [config.md](./config.md) that exists so far. A **pre-run screen**,
   not a mid-run overlay — config is fixed for a run's duration, so the flow
   is settings → run → results
   ([controls.md](./controls.md#run-lifecycle), including the pause menu's
   four distinct outcomes). Add the storage adapter
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
   progression, randomized voicing), movement sonification, and the event
   stingers. Note stingers key to **semantic position events**
   (`positionClosed.profit`, `stoppedOut`, `actionDenied`), never to button
   names — a `sell`-keyed cue misfires on every short exit, since closing a
   short is a `buy`. Build against one theme parameter set first; the second
   is again just numbers.
8. **Shared plugin host: indicators + user stop plugins + volume pane.**
   [indicators.md](./indicators.md) — the overlay/oscillator contract, the
   shared `OhlcvBar`/`ParamSpec` types, Web Worker sandboxing serving **both**
   plugin kinds, the sub-pane renderer and its vertical layout budget
   ([hud.md](./hud.md#sub-pane-vertical-layout)), the volume toggle, and one
   built-in indicator (Simple Moving Average) to prove the contract
   end-to-end. Oscillator normalization follows the same causality rule as
   poles. Stop plugins from step 4 move onto this host here, which is where
   user-supplied stop strategies become loadable — including the explicit
   player notification when a stop plugin auto-disables
   ([stops.md](./stops.md#sandboxing-and-hosting)), since a silently dead
   stop removes risk protection mid-position.
   Also here: **indicators become available to stop plugins**
   ([stops.md](./stops.md#using-indicators-inside-a-stop-plugin)) — the host
   resolves each stop's `requires()` at run start, owns those instances
   separately from displayed ones, and feeds them **every bar from the first
   bar**, not only while a position is open, so a warm-up period doesn't
   restart on every entry. Add the pre-run validation that refuses to start a
   run whose stop requests an unresolvable indicator. This is the step that
   makes an ATR or chandelier stop writable, so it's worth proving with one
   such stop even though neither ships as a built-in.
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
full-series normalization modes; theme-specific character variants;
rebindable controls; indicators beyond Simple Moving Average; stop
strategies beyond `fixed-percent` and `trailing-percent` — time-based and
break-even need only position state, while ATR and chandelier stops depend on
step 8's indicator-consuming mechanism
([stops.md](./stops.md#built-in-stop-plugins)); margin interest and forced
liquidation on shorts; shorting exposed in the UI (`allowShorting` ships off,
engine supports it).

## Notes on tuning and validation

- **The numeric defaults marked _provisional_ in
  [config.md](./config.md) are starting points, not considered values.**
  `scrollSpeed`, `visibleBarCount`, `entrySize`, `flattenHoldMs`, the two
  built-in stop percents, and `scoring.maxMultiplier` were chosen for
  internal consistency and will move once the game is playable.
- **Step 3 is not a go/no-go gate.** The design goal is training, not
  arcade fun, so a thin platforming layer is intended rather than a risk to
  validate away. What step 3 *is* worth pausing on is whether the trading
  feedback reads clearly — whether a player can tell what just happened to
  their position and why — since everything from step 6 onward is polish on
  top of that legibility.
- One thing to watch in playtesting rather than decide upfront: whether the
  discipline streak reads as *worth protecting*. Basing it on rule compliance
  rather than profit removes the obvious exploit (panic-scalping tiny wins to
  hold a chain earns nothing, since only profitable closes collect the
  multiplier), but it introduces the opposite risk — a meter that's too easy
  to keep is a meter nobody watches. Raw P&L stays visible alongside
  `arcadeScore` either way, so a distorted incentive would be visible if one
  appears.
