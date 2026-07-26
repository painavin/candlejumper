# Tech Stack & Platforms

## Target platforms

Windows, macOS, Linux, and Android from one codebase.

## Recommendation

- **Core game loop**: TypeScript + **PixiJS** for canvas rendering (poles,
  character, parallax layers). Its `Graphics` and `RenderTexture` APIs also
  do the procedural art generation — see
  [procedural-assets.md](./procedural-assets.md).
- **Audio**: **Tone.js** for all three channels, including the generative
  ambient bed (see [audio.md](./audio.md)). No audio files.
- **Randomness**: a small inlined seeded PRNG (mulberry32 or xorshift128 —
  a few lines, not a dependency). `Math.random()` is banned repo-wide with
  no exemptions; the only source of real entropy is one `mintSeed()` helper
  over `crypto.getRandomValues`, used to mint a run's world seed.
  Determinism is a hard requirement, not a nicety.
- **No asset pipeline.** No texture atlases, no sprite sheets, no audio
  encoding, no art tooling. The only binary asset in the build is a web
  font.
- **Build tooling**: **Vite** — instant hot reload during development, and
  both Tauri and Capacitor document first-class Vite setups, so packaging
  doesn't fight the dev server.
- **UI (settings/config panels)**: **Svelte**, for the settings panels and
  menus only — the PixiJS canvas owns the game world, Svelte owns the DOM
  around it. Reasoning:
  - **Config is set before a run starts, not edited during play** (see
    [config.md](./config.md)), so the settings UI and the 60fps render
    loop are never active at the same time. That makes runtime rendering
    performance a **non-factor** in this choice — the usual "virtual DOM
    diffing steals main-thread time from the game loop" argument does not
    apply here, and shouldn't be used to justify the pick.
  - What actually decides it: two-way binding onto a plain config object is
    essentially the entire UI job here (a large surface of sliders,
    toggles, and dropdowns over one config tree — see
    [config.md](./config.md)), and Svelte's `bind:` does that with the
    least ceremony of the options. Smaller runtime bundle also helps the
    Android build.
  - Honest tradeoff: this is a **weak preference, not a strong technical
    win**. React would work fine and has a far bigger ecosystem of
    off-the-shelf component libraries — if the settings UI ever grows into
    something wanting a full design system, that's React's advantage.
    Switching later is contained, since the framework only touches menus
    and panels, never the canvas or the game logic.
- **Desktop packaging**: **Tauri** (Windows/macOS/Linux) — lighter than
  Electron, wraps the web build as a native app.
- **Android packaging**: **Capacitor** — wraps the same web build for
  mobile; also leaves iOS available later for free if ever needed.

## Rationale / tradeoffs

- One shared TypeScript codebase reaches every target, including a
  zero-install browser build for fast iteration during development — no
  separate export pipeline per platform.
- Browser-based dev loop is fast: every change is testable immediately
  without a native build step.
- Tradeoff: gives up some of the native "game engine feel" and built-in
  tooling (animation editors, physics, particle systems) that Godot or
  Unity provide out of the box.

## Persistence

Settings, personal bests, unlockables, achievements, and lifetime stats
([game-feel.md](./game-feel.md#new-progression--meta-game)) all need to
survive a restart, and the storage API differs per platform.

Put everything behind a single narrow interface — `load(key)` /
`save(key, value)` over JSON — with one implementation per platform:

| Platform | Backing store |
|---|---|
| Browser (dev) | `localStorage` |
| Desktop (Tauri) | Tauri filesystem API, app-data directory |
| Android (Capacitor) | Capacitor Preferences |

Nothing outside that adapter knows which platform it's on. Two rules worth
holding to: keep the persisted shape **versioned** from the first write, so
a later schema change doesn't silently discard someone's accumulated stats;
and treat all persisted data as **untrusted on read** — a corrupt or
hand-edited file should fall back to defaults rather than crash the app.

Personal bests are stored **keyed by run fingerprint**
([game-feel.md](./game-feel.md#new-session-structure-the-highest-leverage-item-here)),
a stable hash of the config keys that change the challenge. Version the
fingerprint alongside the schema: adding a key to it later invalidates
existing buckets, which should be an explicit migration rather than silent
loss of a player's history.

## Testing

Not every layer is worth the same effort here:

- **Trading engine — unit tested thoroughly.** Signed position sizing, the
  order-intent matrix, weighted-average cost basis, realized P&L, the tick
  pipeline ordering, buying-power clamps, the flat threshold, and the
  edge-case table in
  [game-design.md](./game-design.md#trade-rules--edge-cases) are pure
  functions over numbers with exactly known expected values. This is the
  part where a subtle sign error silently produces wrong scores forever, so
  it gets real coverage — including a short-side case for every long-side
  case, and an explicit test that `buy` on a short reduces rather than
  flips.
- **Stop plugins — unit tested**, including that a level computed at bar N
  is enforced against bar N+1 and never retroactively against bar N
  ([stops.md](./stops.md#causality-and-timing)). That off-by-one is
  invisible in play but changes every stop-out. Two more assertions once
  stops can consume indicators
  ([stops.md](./stops.md#using-indicators-inside-a-stop-plugin)): that a
  stop's indicators are fed **from the first bar of the run**, not from
  position entry — otherwise warm-up silently restarts every trade — and
  that a non-finite level is coerced to `null` rather than becoming a stop
  that can never trigger.
- **The discipline streak — unit tested**, since it's scoring logic and a
  wrong tick silently changes a player's history
  ([game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-the-discipline-streak)).
  The cases that matter are the ones a win-streak implementation would get
  wrong: a **losing** close with no advisory breach must *build* the streak,
  an advisory breach must reset it **on the breach bar** rather than at the
  eventual exit, an enforcing stop firing must leave it unchanged, and a run
  with no stop configured must leave the meter dormant with `arcadeScore`
  equal to raw P&L. Plus: the multiplier applies to profitable closes only,
  so a sequence of scratch trades climbs the meter and scores nothing.
- **The run loop's stall rules — unit tested** against a synthetic clock: a
  frame gap of ten bar-durations must advance exactly one bar, not ten
  ([game-design.md](./game-design.md#scroll-speed-timing-and-pole-geometry)).
  This is cheap to test with an injected time source and impossible to notice
  by playing, since it only manifests as P&L that's subtly wrong after a tab
  switch.
- **Normalizers — unit tested**, with an explicit assertion that no causal
  method ever reads a bar beyond the current index. That's the regression
  guard for the future-price leak described in
  [game-design.md](./game-design.md#why-full-series-normalization-leaks),
  which is invisible by inspection and easy to reintroduce.
- **Indicators — unit tested** against known-good reference values.
- **Procedural generation — snapshot tested for determinism.** Since
  `theme + seed` must always produce an identical world
  ([procedural-assets.md](./procedural-assets.md#determinism--seeded-prng-never-mathrandom)),
  the generators' numeric output is snapshot-testable. This catches
  regressions in the noise pipeline as failing tests rather than as "the
  mountains look a bit different now," which is otherwise very easy to miss.
  Worth a lint rule banning `Math.random()` repo-wide alongside it.
- **Rendering, audio, parallax — not unit tested.** Verify by playing.
  Snapshot-testing canvas pixels costs more than it catches.

**Vitest** is the runner, since it shares Vite's config and transform
pipeline — no second build setup. The engine should have no import
dependency on PixiJS or the DOM, which keeps these tests fast and headless
and is good architecture regardless.

## Runner-up considered

**Godot** (GDScript or C#) — a real 2D game engine with native export to
every target platform (including Android) from one project, no
Tauri/Capacitor wrapper layer needed, and a capable UI system (Control
nodes) for settings panels. Reasonable alternative if native game-engine
polish matters more than fast browser-based iteration. Not chosen because
the config-heavy UI and fast edit/test loop favor web tech here.
