# Code Structure

Where every piece of code lives, and the import rules that keep it there.

This exists because three requirements already decided elsewhere are
*structural* — they can't be satisfied by discipline alone, only by a layout
plus a lint rule:

1. **The trading engine must not import PixiJS or the DOM**
   ([tech-stack.md](./tech-stack.md#testing)), so it stays headless and
   fast to unit test.
2. **Plugin code must never reach the Tauri/Capacitor native bridge**
   ([indicators.md](./indicators.md#plugin-loading--sandboxing)). The Web
   Worker is the trust boundary, and a boundary is only as good as the
   worker bundle's import graph.
3. **Procedural generation must be snapshot-testable as numbers**
   ([tech-stack.md](./tech-stack.md#testing)), which means the generators
   can't be entangled with the code that draws them.

Each of those is a directory boundary below, backed by an ESLint rule.

## Top level

```
candlejumper/
├── docs/            these planning docs
├── public/          the web font; the only binary asset in the build
├── src/             everything the app is made of, data included (see below)
├── src-tauri/       Tauri desktop shell (step 11)
├── android/         Capacitor Android project (step 11)
└── tests/fixtures/  golden data shared across suites; unit tests are colocated
```

Plus the root configs: `eslint.config.js` carries the import-zone rules and the
`Math.random()` ban, `eslint.zones.js` holds the dependency table both the lint
config and `src/app/architecture.test.ts` read, and `vite.config.ts` declares
the app build and the separate plugin-worker entry.

**The bundled price data lives in `public/datasets/`, and `scripts/` holds the
one script that maintains it.** It sat at the repo root first, then inside
`src/data/datasets/` to remove a lint exemption for the one file reaching outside
`src/`, and now in `public/` because it is *served* rather than imported — see
[data-sources.md](./data-sources.md#why-served-not-bundled). Nothing under `src/`
imports it, so the escaping-relative-import rule has nothing to say about it, and
the exemption that motivated the second move stays deleted.

## `src/`

```
src/
├── shared/         contracts at every seam; imports nothing at all
│   ├── contracts/    OhlcvBar, ParamSpec, both plugin contracts, PriceSeriesSource
│   ├── math/         the one seeded PRNG, the one seed minter, easing, hashing
│   └── palette/      the indicator line colours — see the note below
│
├── config/         the config tree: types, defaults, validation, run fingerprint
│
├── content/        parameter sets as plain data — no logic, no branching on id
│   ├── visualThemes/ palette + shape/noise params per mood
│   ├── audioThemes/  progression + synth recipes per mood
│   ├── characters/   primitive rig definitions and motion constants
│   └── progression/  unlocks, gated on discipline rather than profit
│
├── engine/         the trading engine. No PixiJS, no Tone.js, no DOM. Ever.
│   ├── position/     signed size, cost basis, order intent, buying power
│   ├── pipeline/     the ordered per-bar tick, and input buffering
│   ├── stops/        the port stops answer through, level resolution, trigger timing
│   ├── indicators/   the port displayed indicators answer through
│   ├── normalization/ price transform and the causal normalization modes
│   ├── scoring/      campaigns, close events, streaks, stop compliance
│   ├── run/          playback cursor, bar clock and its stall rules, run controller
│   └── output/       the semantic event vocabulary and the per-frame state snapshot
│
├── generation/     procedural art as numbers: noise, heightfields, placements.
│                   No PixiJS — this is what makes it snapshot-testable.
│
├── data/           dataset validation, the manifest reader, and:
│   └── sources/      PriceSeriesSource implementations + the source registry
│                     (the OHLCV JSON itself is in public/datasets/, served not imported)
│
├── plugins/
│   ├── worker/       THE TRUST BOUNDARY. Its own bundle; imports shared/ only.
│   ├── host/         instantiation, dependency resolution, validation, time budgets
│   └── builtin/      the shipped stops and indicators, same contract as user code
│
├── render/         PixiJS lives here and only here
│   ├── stage/        Application setup, resize/orientation, layer ordering
│   ├── bake/         generation output → RenderTexture, once at load
│   ├── layers/       the parallax stack, back to front
│   ├── poles/        candle geometry and colour, bar-forming growth
│   ├── character/    rig drawing, math-driven animation, ghost stack
│   ├── hud/          Y axis, top HUD, streak meter, stop lines, sub-panes
│   ├── juice/        floating text, particles, screen shake
│   └── landmarks/    date banners at month/quarter/year boundaries
│
├── audio/          Tone.js lives here and only here — setup, mixer, and the
│   └── channels/     engine-event → stinger map. Channels: ambient bed,
│                     movement sonification, event stingers.
│
├── input/          device listeners and the tap-vs-hold gesture;
│                   the last place button names exist
│
├── platform/       the ONLY place Tauri/Capacitor APIs may be imported
│   ├── persistence/   one store interface, one implementation per platform
│   ├── pluginLoading/ obtains plugin *source*; never evaluates it
│   ├── fileImport/    one file picker, shared by plugin and price-data import
│   ├── http/          one GET interface; browser `fetch` now, native later
│   └── haptics/       navigator.vibrate now, Capacitor Haptics when packaged
│
├── ui/             Svelte. Menus and screens only, never the game world.
│   ├── screens/      title, settings, how-to, record, pause, results
│   ├── controls/     reusable inputs, incl. the generic ParamSpec renderer
│   └── mobile/       thumb buttons
│
└── app/            composition root: bootstrap, screen routing, run session,
                    the time-based loop, the camera, attract mode
```

`src/main.ts` is the entry point and does nothing but boot `app/`.

**Vertical camera easing lives in `app/runSession.ts`, not `render/juice/`.** It
moves whole stage containers, and `app/` is the only place that holds the stage —
`render/` layers each receive one `Container` by design. It also has to move the
*axis* along with the world, since an axis that doesn't follow the camera labels
prices at the wrong heights, and only the composition root can see both.

Three folder names are doing real work rather than describing contents.
`engine/output/` is the engine's entire outward-facing surface — the semantic
events and the frame-state snapshot — which is why the dependency rules below
can grant `render/` and `audio/` access to it and nothing else in `engine/`.
And `engine/stops/` and `engine/indicators/` hold the *ports* plugins are asked
through, not the hosts that answer them; that split is what lets step 4 ship
working stops before step 8's sandbox exists, and what keeps the engine from
ever learning that a stop can consume an indicator.

## Dependency rules

Arrows are the only permitted direction. Anything not listed is forbidden.

| Folder | May import |
|---|---|
| `shared/` | nothing |
| `config/`, `content/`, `generation/`, `data/` | `shared/` |
| `engine/` | `shared/`, `config/` |
| `plugins/worker/` | `shared/` — **nothing else, ever** |
| `plugins/host/`, `plugins/builtin/` | `shared/`, `engine/stops/`, `engine/indicators/`, `platform/pluginLoading/` |
| `render/` | `shared/`, `config/`, `content/`, `generation/`, `engine/output/` |
| `audio/` | `shared/`, `content/`, `engine/output/` |
| `input/` | `shared/`, `engine/pipeline/` (to enqueue presses) |
| `platform/` | `shared/` |
| `ui/` | `shared/`, `config/`, `content/`, `platform/`, `engine/scoring/` |
| `app/` | everything |

**`shared/palette/` is a deliberate exception worth explaining**, because it looks
misfiled. The indicator line colours are presentation data and belong with the themes
in `content/` on every reading except the one that matters: four zones need them —
`ui/` for the picker, `render/` for drawing, `engine/` for the volume pane's default,
and `plugins/host/` for an instance that arrives without one — and `engine/` and
`plugins/` may not import `content/`. Widening that grant to place a colour table
would trade a real boundary for a filing preference. `shared/` is the zone every other
one may reach, so that's where cross-zone constant data goes.

Four prohibitions carry real weight, and all four are lint rules rather
than conventions:

- **`engine/` and `generation/` may not import `pixi.js`, `tone`, `svelte`,
  or any DOM global.** This is requirement 1 and 3 above.
- **`plugins/worker/` may import only `shared/`.** This is requirement 2.
  The worker bundle is separately verifiable: if its import graph contains
  only `shared/`, it provably cannot reach the native bridge, no matter what
  a plugin author writes.
- **Only `platform/` may import `@tauri-apps/*` or `@capacitor/*`.** Native
  capability has exactly one door.
- **Nothing may import from outside `src/`.** Relative imports may not climb two
  or more levels, which is exactly the set that would escape a zone. This is why
  the datasets moved inside `src/`: the rule now has no exemptions at all.
- **`Math.random()` is banned everywhere, with no exemptions.**
  `shared/math/` holds the only randomness source, per
  [procedural-assets.md](./procedural-assets.md#determinism--seeded-prng-never-mathrandom).
  Real entropy has one door too: a single `mintSeed()` over
  `crypto.getRandomValues`, which is what makes `visuals.worldSeed`'s
  "random per run" default possible without weakening the rule.

Nothing downstream of `engine/` mutates engine state. `render/` is a
function of the frame state + theme + elapsed time; `audio/` is a function of
the event stream. That's what makes both safe to skip in a headless build.

## Three vocabularies, narrowing at each seam

The docs warn repeatedly about the same class of bug: keying behaviour to
button names, when closing a short is a `buy` press
([audio.md](./audio.md#channel-3--event-stingers-one-shots),
[character.md](./character.md),
[game-feel.md](./game-feel.md#new-per-action-feedback-juice)). The layout
makes that mistake hard to write rather than merely documented:

| Folder | Vocabulary | Example |
|---|---|---|
| `input/` | **device gestures** | `↓` held 400ms |
| `engine/position/` | **buy / sell / flatten** | `buy` while short |
| `engine/output/` | **semantic position events** | `positionClosed.profit` |

Button names stop existing at `input/`'s boundary. `audio/`, `render/juice/`,
and `render/character/` may only import `engine/output/`, so there is no
`sell` for them to bind to.

## Decisions this layout commits to

Three things the folder tree settles that no other doc states outright.

### The HUD renders in PixiJS, not Svelte

[tech-stack.md](./tech-stack.md#recommendation) picks Svelte on the premise
that the settings UI and the render loop are never active simultaneously.
The HUD updates every tick ([hud.md](./hud.md#y-axis-auto-scaling-price-axis)),
so putting it in Svelte would break that premise and re-open the
performance argument that doc explicitly retracts.

So `render/hud/` is Pixi. Everything anchored to chart coordinates needs to
be anyway — Y-axis labels sit at price positions, stop lines at price
levels, floating P&L at the character. Keeping the top HUD in the same
system avoids a second coordinate space and a DOM/canvas sync seam.

The cost is honest: manual text layout for the two-line portrait block, and
no screen-reader access to HUD numbers. The rule that makes it tolerable is
**no per-frame DOM updates during a run** — which is why `ui/mobile/`
thumb buttons *can* stay Svelte (they're static during play; touch handling
is DOM's strength) while the HUD can't.

### Built-in plugins run through the same host as user plugins

[indicators.md](./indicators.md#typescript-indicator-contract) requires no
separate code path for official plugins. But step 4 needs working stops
before step 8 builds the worker sandbox, so `engine/stops/` exposes a port
with two implementations in `plugins/host/`: one in-process for step 4, one
worker-sandboxed for step 8. At step 8 the built-ins move onto the worker
path and the in-process one survives only as a test double.

Without the port, step 8 would mean rewriting step 4's stop wiring instead
of swapping an implementation.

It also settles where indicator-consuming stops live
([stops.md](./stops.md#using-indicators-inside-a-stop-plugin)). The third
argument of `StopInstance.onBar` exists from step 4, where the host passes
`{}` because the two percent stops declare no `requires()`. Step 8 adds
dependency resolution to `plugins/host/` and starts filling it — so the
signature never changes, and the mechanism costs nothing until there's an
indicator registry to draw on. `IndicatorInstance.onBar` gained the same third
argument for the same reason once indicators could be composed of other
indicators, and one resolver in `plugins/host/indicatorTree.ts` serves both:
a stop's dependencies and a displayed composite's are the same tree.

Note which side of the boundary the wiring sits on: **`engine/` never learns
that stops can use indicators.** It asks the port for a level and gets a
number or `null`. Dependency resolution, instance ownership, and per-bar
feeding are all `plugins/host/` concerns. That's what keeps `engine/stops/`
testable against a hand-written fake instead of a plugin runtime.

### `shared/` has an admission test

`shared/` is the standard place for a junk drawer to form. The rule: a file
belongs there only if it is imported by **two or more** top-level folders
**and** imports nothing outside `shared/`. `OhlcvBar` qualifies (engine,
data, plugins, render). A pole-geometry helper does not — it belongs to
`render/`.

## Where each roadmap step lands

Read alongside [roadmap.md](./roadmap.md). Steps touch few folders each,
which is the point.

| Step | Folders |
|---|---|
| 0 Scaffolding | `shared/`, `config/`, `data/`, root configs |
| 1 Poles + Y-axis | `engine/run/`, `engine/normalization/`, `render/stage/`, `render/poles/`, `render/hud/` |
| 2 State machine | `engine/position/`, `engine/pipeline/`, `engine/output/`, `input/`, `render/character/` |
| 3 Sizing + HUD | `engine/position/`, `engine/scoring/`, `render/hud/` |
| 4 Stops + discipline streak | `engine/stops/`, `engine/scoring/`, `plugins/host/`, `plugins/builtin/`, `render/hud/` |
| 8 Plugin host | adds `engine/indicators/`, `plugins/worker/` |
| 5 Settings + lifecycle | `ui/screens/`, `platform/persistence/`, `app/` |
| 6 Backgrounds | `generation/`, `render/bake/`, `render/layers/`, `content/visualThemes/` |
| 6a Characters | `content/characters/`, `render/character/` |
| 7 Audio | `audio/`, `content/audioThemes/` |
| 8 Plugin host | `plugins/worker/`, `plugins/host/`, `plugins/builtin/`, `render/hud/`, `platform/pluginLoading/` |
| 9 Feel & polish | `render/juice/`, `render/landmarks/`, `ui/screens/`, `platform/` |
| 10 Data sources | `data/sources/` |
| 11 Packaging | `src-tauri/`, `android/`, `platform/persistence/` |

## Tests

Unit tests are **colocated** as `*.test.ts` beside the file under test —
Vitest shares Vite's resolution, so no path mapping is needed, and a test
next to its subject is likelier to be updated with it. `tests/fixtures/`
holds only golden data shared across suites.

Which folders carry real coverage is set by
[tech-stack.md](./tech-stack.md#testing): `engine/` thoroughly (long *and*
short side for every case), `engine/normalization/` with the explicit
no-future-reads assertion, `engine/stops/` with the bar-N/N+1 timing
assertion, `plugins/builtin/` against reference values, and `generation/` by
determinism snapshot. `render/` and `audio/` are verified by playing, not by
tests — which is affordable precisely because the two pure folders they
depend on are covered.
