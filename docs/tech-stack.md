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
  a few lines, not a dependency). `Math.random()` is banned in generation
  code; determinism is a hard requirement, not a nicety.
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

## Testing

Not every layer is worth the same effort here:

- **Trading engine — unit tested thoroughly.** Signed position sizing,
  weighted-average cost basis, realized P&L, stop triggering, and the
  edge-case table in
  [game-design.md](./game-design.md#trade-rules--edge-cases) are pure
  functions over numbers with exactly known expected values. This is the
  part where a subtle sign error silently produces wrong scores forever, so
  it gets real coverage — including a short-side case for every long-side
  case.
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
  Worth a lint rule banning `Math.random()` in generation code alongside it.
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
