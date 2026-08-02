# Implementation Details

Decisions made while building that the design docs don't cover — either
because they're toolchain-level, or because writing the code forced a choice
the prose left open. Newest step last.

This is a log, not a spec. Where it contradicts a doc in `docs/`, the doc
wins and this file should be fixed.

## Step 0 — Scaffolding

### Toolchain versions

| Package | Version | Note |
|---|---|---|
| TypeScript | `~6.0.3` | **Not 7.0.2**, see below |
| Vite | `^8.1.5` | requires Node `^20.19` \|\| `>=22.12`; local Node is 20.20.2 |
| Vitest | `^4.1.10` | |
| PixiJS | `^8.19.0` | v8's `Graphics` API is `rect().fill()`, not v7's `beginFill()` |
| Svelte | `^5.56.8` | runes-era; only used from `ui/`, which starts at step 5 |
| Tone.js | `^15.1.22` | unused until step 7 |
| ESLint | `^10.8.0` | with `typescript-eslint@^8.65` |

**TypeScript 6, not 7.** 7.0.2 is the current stable release, but
`typescript-eslint@8.65` declares `typescript: ">=4.8.4 <6.1.0"`. The
import-zone lint rules are load-bearing architecture rather than style
(`docs/code-structure.md`), so keeping the linter working outranks being on
the newest compiler. Revisit once typescript-eslint supports 7.

`baseUrl` is deprecated in TS 6 and removed in 7, so `paths` entries are
written relative to `tsconfig.json` (`./src/...`) with no `baseUrl` at all.

`vite.config.ts` imports `defineConfig` from `vitest/config` rather than
`vite`, so the `test` block is typed.

### Path aliases per zone

Each top-level folder in `docs/code-structure.md` gets an alias:
`@shared`, `@config`, `@content`, `@engine`, `@generation`, `@data`,
`@plugins`, `@render`, `@audio`, `@input`, `@platform`, `@ui`, `@app`.

This exists to make the import-zone rules enforceable: a lint rule can match
`@render/**` reliably, where it can't reason about `../../render/foo`. A
companion rule bans relative imports that climb two or more levels
(`../../**`), which is exactly the set that would escape a zone — one level
(`../sibling/x`) stays fine inside a zone.

### The import-zone rules, and one real trap

`no-restricted-imports` patterns use **gitignore semantics**, which produced
a rule that silently denied everything. Two consequences worth knowing before
editing `eslint.zones.js`:

1. A bare directory pattern (`'@engine'`) excludes everything beneath it, so
   it cannot coexist with a grant for `@engine/output`. Denying the bare
   barrel import belongs in the rule's `paths` (exact match) rather than its
   `patterns`.
2. Negation does not work here. `['@engine/**', '!@engine/output/**']` denies
   `@engine/output/events.js` too, because you cannot re-include a child of an
   excluded parent. So partial grants are expressed by **listing the denied
   siblings by name** — hence `ZONE_SUBFOLDERS` in `eslint.zones.js`.

The cost of (2) is that a new `src/engine/*` folder must be added to
`ZONE_SUBFOLDERS` or it becomes importable from `render/` while linting
clean. `src/app/architecture.test.ts` asserts the list matches what's on
disk, so that failure mode is a failing test rather than a silent hole.

The zone table lives in `eslint.zones.js` (plain JS, so `eslint.config.js` can
import it without a build step) with types in `eslint.zones.d.ts`.

Verified by probe files that each rule actually fires: engine importing
`pixi.js`, `@render/*`, `@ui/*`, `Math.random()`, and `window`; the plugin
worker importing `@config`; `render/` reaching `@engine/position` (denied)
versus `@engine/output` (allowed).

### Datasets are served, not imported

They live in `public/datasets/` and are fetched at runtime. Two earlier homes and one
earlier mechanism, each removed for a reason worth keeping:

1. **At the repo root**, which forced a permanent lint exemption for the one file
   reaching outside `src/`.
2. **Under `src/data/datasets/`, imported through a lazy `import.meta.glob`.** That
   deleted the exemption and split each dataset into its own chunk, so nothing sat in
   the main bundle — and it was correct for the three datasets it was written for.

What killed (2) was the catalogue, not the bundling. `listTickers` computed each
series' bar count and date span by *loading the series*, so at 644 datasets opening
the app meant 64 MB downloaded before the title screen, ~3.6M bar objects retained,
and `data.test.ts` exhausting a 4 GB Node heap.

`public/datasets/manifest.json` is that answer precomputed by `scripts/datasets.mjs`
(`npm run datasets`), so the catalogue is one 60 kB request and a dataset is fetched
only when played. Serving rather than importing is what makes it possible: a `public/`
file has a stable URL, where a bundled chunk's name is known only to the bundler. It
is byte-neutral — rolldown emitted each dataset as `JSON.parse("…")`, so a minified
`.json` is the same payload minus the wrapper — and the build went from 657 chunks and
1.6s to 14 chunks and under 600ms.

The datasets are then stored **gzipped**, which took the deploy from 245 MB to 65 MB.
That is for the size cap, not for the player: the host compresses text responses in
flight, so the browser was already receiving ~123 kB for a 472 kB dataset. `.gz` files
are opaque bytes, so `jsonFromBytes` inflates them via `DecompressionStream` —
sniffing the gzip magic number rather than trusting the extension, because a CDN that
decodes `.gz` for us would otherwise break every dataset with an error nowhere near
the cause. Gzip and not brotli because `DecompressionStream` has no brotli, and the
alternatives are a wasm decoder in the bundle or an untestable `Content-Encoding`
header. This also retired the array-of-arrays idea: compressed, it saves 13 kB of 123.

Serving them is also what makes compression possible at all — a bundler will not hand
you opaque bytes under a name you chose.

Two consequences that needed handling rather than noting:

- **Names aren't content-hashed**, and a refreshed dataset reuses its name. Since the
  run fingerprint keys on bar count and last bar time *from the manifest*, a stale
  cached dataset behind a fresh manifest would file runs under a bucket describing a
  different series. Every request carries `?v=<lastBarTime>`, which is what makes the
  year-long cache header in `public/staticwebapp.config.json` safe.
- **The split heuristic had to stop being a load-time rejection.** Apple's real
  −51.9% day and an unadjusted 2:1 split are the same number; 66 of the 644 datasets
  would be listed and then refuse to load. It reports at index time instead — see
  [data-sources.md](./data-sources.md#on-adjustment-and-the-check-that-had-to-go).

### Layout constants

`docs/` gave ranges rather than values for a few numbers. Picked in
`src/config/defaults.ts` as `LAYOUT`, all provisional in the same sense
`config.md` means it:

| Constant | Value | Source |
|---|---|---|
| `characterXFraction` | `0.75` | midpoint of the doc's 70–80% |
| `poleGapFraction` | `0.15` | doc says ~15% of bar width |
| `barGrowthFraction` | `0.25` | doc says "a fraction of a bar's duration" |
| `hopHeightInBarWidths` | `1.5` | unspecified |
| `axisLabelCount` | `5` | unspecified |

### Config shape

- Key names mirror `docs/config.md` one-for-one, including its mix of
  top-level trading/scroll keys and namespaced groups, so a reader can move
  between doc and code without translating.
- `entrySize` is a **fraction** (`0.2`), not an absolute cash amount, per the
  doc's resolution that it tracks `startingCapital`.
- `visibleBarCount` is `{ landscape, portrait }` in config; the single
  resolved number is a run-time value, frozen at run start.
- `costBasisMethod: 'fifo'` validates as an *error* rather than silently
  computing weighted-average — the doc lists it as an unimplemented option, and
  reporting FIFO while computing something else is worse than refusing.
- Only the three causal `normalizationMode` values exist in the type. The four
  leaky ones are documentation, per `docs/config.md`.

### Fingerprint

`FINGERPRINT_VERSION = 1`. Hash is FNV-1a/32 over a canonical serialization
with object keys sorted at every depth — a personal-best bucket must not split
because a config object was built in a different order. `stops.active` is
sorted by `typeId` before hashing, since the order a player added two stops in
isn't part of the challenge. Non-finite numbers throw rather than hash.

The resolved `visibleBarCount` is passed in rather than read off the config,
because the config holds one value per orientation and only the resolved one
describes the challenge.

## Step 1 — Poles, growth, hop, axis

- **Bounds easing lives in the engine, not the renderer.** The axis is the
  inverse of the active normalizer, so if the renderer eased its labels
  independently the poles and the axis could disagree about what the chart shows.
  `engine/normalization/` eases the bounds once and both read the result.
- **Easing is frame-rate corrected** (`damp()` in `shared/math`). The naive
  `current += (target - current) * factor` converges at a rate that depends on
  call frequency, so the same easing would settle at different speeds on 60Hz and
  120Hz — the same class of bug as frame-based motion.
- **Bounds get 8% padding and a 0.5%-of-price minimum span.** Without padding the
  tallest visible pole is flush with the top and the shortest has zero height,
  and an invisible pole reads as missing data. Without the minimum span, a flat
  stretch divides by ~0 and the chart explodes into noise.
- **`fixed-price-per-pixel` locks its span at run start and then pans.** The doc
  says "constant scale factor" without saying what happens when a trending series
  walks off the view; panning to keep the played window centred is the only way a
  fixed span can follow a trend without losing it.
- **`starting-price-relative` composes with `log10` additively.** A ratio of
  logarithms is meaningless, so in log space "relative to start" is a difference.
- **The run clock carries a 1e-9 tolerance.** Sixty frames of `1/60` sum to
  0.9999999999999999, so an exact `>=` defers a bar by a whole frame at every
  integer-second boundary.
- **The hop starts when the bar closes**, and takes `hopDurationFraction` of a bar;
  the rest is spent standing. It spanned the *growth* window at first, so the
  character rode a forming bar up to its close and landed as it finished — which
  satisfied "ride the bar up or down" but committed to a bar still being drawn, and
  left the character motionless at a fixed screen position for the other three
  quarters of every bar. That reads as a slide, because a fixed point against a
  moving world is one. The character now rides the bar it stands on and leaps one bar
  width on each hop; `characterX` is where it arrives, not where it lives. The timing
  is a pure function in `render/character/gait.ts`, whose load-bearing property is
  continuity at three seams: hop start, hop end, and the bar boundary where the bar
  just ridden becomes the previous bar.

## Steps 2 + 3 — Trading engine and HUD

Built as one module rather than two. The roadmap separates them so step 2 can use
a fixed unit size and isolate the state machine, but implementing them together
avoided writing cost basis twice, and the tests cover both.

- **`Position` carries no cash field.** Buying power is derived
  (`min(startingCapital + realizedPnl, startingCapital) − notionalAtCost`) rather
  than a mutated balance, so there is no second number to keep in sync.
- **`positionClosed` is one event with a `profitable` flag**, not two event types.
  `positionClosed.profit` is a *theme key*, derived by `eventKey()` — so audio and
  animation still key on the semantic distinction the docs require, without the
  engine carrying two nearly identical event shapes.
- **`forceClose` is a tick input, not a separate code path.** End-of-data and the
  pause menu's "end run" both route through `tickBar`, so there is exactly one
  place a position can change.
- **The HUD renders in Pixi**, per the structure doc — with the rule that made it
  acceptable enforced in practice: while a run is playing, the Svelte layer renders
  nothing at all.

## Step 4 — Stops

- **`StopInstanceSpec` lives in `shared/contracts`, not `config/`.** The lint rule
  caught the host importing the config tree, which was correct: a plugin host has
  no business knowing what else is in a run's configuration. It needs the list of
  stops to instantiate, and that shape is a seam.
- **Level rotation needs no double buffer.** `evaluate` (step 5) always runs before
  `computeLevels` (step 6) within a tick, so writing the new level into the same
  slot the old one was read from is correct — and much easier to reason about than
  a current/next pair.
- **Tightest-binding is direction-aware**: for a long, the *highest* triggered
  level; for a short, the lowest.

## Step 5 — Lifecycle, persistence, screens

- **`ui/appState.svelte.ts`** is the seam between `app/` (which owns the run) and
  `ui/` (which draws menus). A `.svelte.ts` module so runes work outside a
  component; `app/` mutates it, `ui/` reads it.
- **Restart and abandon share one `discard()`.** Both record nothing, which is the
  documented behaviour — the difference is only where the player lands next.
- **The save file is permissive about missing fields and strict about wrong ones.**
  A player who upgrades keeps their history; a hand-edited file can't inject a
  shape the rest of the app then trusts. Individual malformed personal bests are
  dropped without discarding the good ones.
- **A fingerprint-version bump clears personal bests but keeps lifetime totals**,
  since those aren't keyed by challenge.
- ESLint needed `svelte-eslint-parser` with `parserOptions.parser` set to the TS
  parser, and `no-undef` off for TS files (TypeScript already resolves identifiers
  and knows the DOM globals the base rule's environment list doesn't).
- **The settings screen surfaces every config key**, grouped by what a player is
  deciding rather than by how the config tree nests. It didn't originally, and the
  gap was invisible because everything worked from `defaultConfig()` — a whole
  character roster and a second theme were built, wired, and unreachable. Anything
  unreachable from the UI is effectively unshipped.
- **Rarely-touched keys are collapsed into `<details>`, not omitted.** A first run
  shouldn't open onto thirty controls, but a hidden control is still shipped and a
  missing one isn't.
- **A "mood" is an id present in both theme registries**, computed as the
  intersection of `visualThemes` and `audioThemes` rather than a third hardcoded
  list — adding a theme to both registries makes it appear in the picker with no
  UI change. Picking a mood writes both `visuals.theme` and `audio.theme`; the
  disclosure below it still edits the two keys independently, because they really
  are independent keys and the docs promise mixing stays possible.
- **The mood `<select>` shows a disabled "Mixed" option only when the two keys
  disagree.** Otherwise a mixed configuration would silently display as whichever
  mood the visual key happened to hold, which reads as a bug.
- **World seed is reachable, with a "New world" button.** `visuals.worldSeed` is
  documented as surfaced so a good-looking world can be recovered; a read-only
  display would not achieve that, and the button reuses `mintSeed()` rather than
  adding a second entropy path.
- **Testing a Svelte 5 delegated handler needs `bubbles: true`.** `onchange` on a
  plain element is delegated to the mount root, so `dispatchEvent(new Event('change'))`
  — non-bubbling by default — never reaches it, while a `bind:value` on the same
  element does fire because bindings attach directly. That asymmetry made the first
  version of the mood test fail while the mix test passed.

## Steps 6 + 6a — Procedural visuals and character rigs

- **Generation parameter types live in `shared/contracts/generation.ts`.** The lint
  rule caught `content/` importing `generation/`; the shapes are a seam between the
  two — `content/` declares them, `generation/` consumes them — and neither zone
  may import the other.
- **The heightfield is sampled around a circle**, so tiles loop by construction
  rather than needing a blended seam. The test asserts the wrap step is no larger
  than a typical interior step.
- **`deriveSeed(seed, label)` per layer.** Without it, adding an octave to the
  mountains would shift every subsequent layer's noise, because they'd share one
  PRNG stream.
- **Two mountain ranges from one generator.** `serious`'s city skyline is the same
  algorithm at high frequency, low amplitude, maximum ridge sharpness.
- **Determinism snapshots** cover the jolly silhouette, the serious skyline, the
  cloud field, and the grass placement.
- The placeholder palette module is gone; every colour now comes from the active
  theme's `palette` or `accent`.

## Step 7 — Audio

- **Tone.js is lazy-loaded.** It's ~250 kB and nothing needs it before a run
  starts, so `runSession` imports it dynamically. Keeps first paint — the settings
  screen — cheap on a phone.
- **Stinger voices are pooled per recipe kind**, not built per event.
- **The bed's chord progression is fixed and its surface is seeded** from
  `visuals.worldSeed`, so a run sounds the same way twice.
- **Sonification saturates at a 5% move.** Beyond that the interval stops widening
  rather than running off the top of the scale — a crash should sound extreme, not
  silent.

## Step 8 — Plugin host and sandbox

- **`engine/indicators/` is a new port folder**, sibling to `engine/stops/`. The
  lint rule caught the host reaching into `engine/run/` for the feed type; a port
  per plugin kind is the consistent answer, and `docs/code-structure.md` now lists
  it.
- **The wire protocol lives in `shared/contracts/pluginProtocol.ts`**, because the
  worker may import nothing else — a shared protocol type is the only thing that
  can legitimately cross that boundary. Note that files inside `shared/` import
  each other *relatively*, since `shared/` may not even import itself by alias.
- **ATR shipped alongside SMA.** The docs call it the first indicator with a second
  customer, and it's what proves the indicator-consuming stop mechanism end to end
  — `atr-stop` is built for exactly that reason, though it isn't active by default.
- **A test asserts the worker's import graph contains only `@shared/`**, so the
  trust boundary is a checked property rather than a config detail.
- **Volume and oscillators share one renderer**, since they're structurally
  identical: a series with its own scale in its own pane.
- **Sub-pane count must be known before layout.** Panes share 40% of the chart
  area, so the main chart's height depends on how many there are — the stage
  computes layout with the count, then the controller is told the resolved cap.

## Step 9 — Juice, session structure, and the shell

- **Screen shake moves the world containers, not the HUD.** Numbers a player is
  trying to read shouldn't jump, and the effect reads better on the scene anyway.
- **Shake is a deterministic sine/cosine wobble**, not random jitter — the
  `Math.random()` ban has no cosmetic exemption. Particles are seeded from
  `worldSeed` for the same reason.
- Floating text is pooled, and keyed to the close *event* so it fires correctly on
  short exits.
- **Particle bursts differ by cause, not just colour.** Confetti on a profitable
  close travels up and out; the stop-out puff hugs the ground. The two events have
  to be distinguishable from the corner of the eye without reading the number, and
  hue alone can't do that.
- **A loss taken on purpose gets a small dust puff rather than nothing.** Under the
  discipline rules it may well have *built* the streak, so silence would read as
  punishment.
- **Vertical camera easing lives in `app/runSession.ts`, and moves the axis too.**
  Only the composition root holds the stage, and an axis that doesn't follow the
  camera labels prices at heights the poles aren't at — the axis and the poles are
  two views of one scale. Shake is the opposite case and deliberately does *not*
  move the axis: shake is noise, and noise on numbers just makes them harder to
  read. The follow amount is 6% of chart height, small enough not to slide the
  chart under someone reading a level off it.
- **HUD numbers tween, and colour keys off the true value, not the tweened one.**
  A number sliding through zero would otherwise flicker to the opposite colour on
  the way past. The first frame snaps rather than easing up from zero, which would
  show a P&L history the player didn't earn.
- **The motion trail lives outside the character's own container**, because that
  container is scaled, rotated, and moved every frame — a child would inherit all
  of it and smear instead of trailing. It only draws while a position is open,
  which makes it information ("I am exposed right now") rather than decoration.
- **Landmarks compare two bars already on screen.** Month, quarter, and year
  boundaries are detected from `frame.bars`, so no new data is needed and nothing
  can leak — a landmark derived from the full series (e.g. "the year's high is
  coming") would. `boundaryBetween` is split into a Pixi-free module for the same
  reason `axis.ts` is split from `axisLayer.ts`: it's a date calculation, and
  "does 31 Dec → 2 Jan register as a *year*" is wrong once and then wrong forever.
  UTC throughout, so the same bar doesn't land in different months for players in
  different time zones.
- **The HUD font floor is one constant, not a convention.**
  `render/hud/hudFont.ts` clamps every size through `hudFontSize()`. A minimum
  spread across a dozen literals decays the first time someone needs one more line
  to fit; the smallest label in the game was 10px before this.

### The shell: title screen and attract mode

- **The canvas is never empty.** The Pixi app used to be created inside the run
  session and destroyed with it, so between runs no renderer existed — which is the
  structural reason the old landing screen read as a web form rather than a game.
  An attract-mode session now plays whenever no run is in progress.
- **Attract mode is the same `startRunSession` with four things off**: no input, no
  audio, no HUD, and an autopilot pressing the buttons. `docs/game-feel.md`
  describes it as "just the existing render loop with input disabled", and building
  it as a *mode* rather than a second scene is what keeps that true — a separate
  menu renderer would drift from the real one.
- **Attract mode gets an inert `AudioSystem` rather than a real one.** Autoplay is
  blocked before a user gesture anyway, and a menu that greets you with music you
  didn't ask for is worse than a quiet one. It also means the backdrop never pays
  for the Tone.js chunk.
- **The autopilot is deliberately not a strategy.** It looks only at whether it
  holds something and for how long — never at price. A trainer that ships a bundled
  strategy teaches the wrong lesson, and anyone reading `demoPilot.ts` for edge
  will find none. Seeded, so the demo replays identically and is testable.
- **The backdrop plays a random 240-bar window**, since a full series takes minutes
  to loop and a different stretch of market each visit is more interesting. Safe to
  randomise because nothing attract mode does is ever recorded.
- **Play starts a run; Settings is its own button.** Play originally opened the
  settings form, which asked a first-time player to make eleven decisions before
  they knew what the game was — and the shipped defaults are a perfectly good first
  run. The button names the ticker it will play, so it isn't a mystery. This also
  retired the separate "Quick run", which Play now *is*.
- **The settings screen previews live.** Changing mood, jumper, ticker, or scroll
  speed restarts the backdrop, keyed on only the settings the backdrop can visibly
  show — reacting to the whole draft would rebuild the Pixi scene on every drag of a
  capital slider.
- **Menus take their colours from the game's theme** via CSS custom properties
  (`ui/uiTheme.ts`), not their own hardcoded palette. `ui/` was always allowed to
  import `@content`; nothing structural was stopping this, it just hadn't been done.
- **Panels are translucent over the backdrop.** A menu that hides the game it's
  advertising defeats the point; the scrim is what keeps text legible over a moving
  scene.
- **Transitions are skipped entirely under reduced motion, not shortened.** A
  fly-in is exactly the incidental movement the OS setting is asking about, and
  nothing here needs motion to be understood.

### Progression and the record

- **Achievements gate nothing.** Built first as unlockables per game-feel.md — the
  roster and the second mood behind play milestones — and then un-gated, because it
  makes the trainer worse at its job. All of that content is cosmetic and finished;
  a player who wants to be the bear should be the bear on their first run. The
  design doc has been updated rather than the code left contradicting it.
- **Every badge is earned on discipline or volume, never on profit.** A
  profit-gated badge would reward holding a loser past a stop and getting away with
  it — the exact habit the game exists to break. `cleanRuns` (a run that traded and
  broke no rule) is the lifetime stat this needed.
- **A run with no campaigns can't be "clean".** Sitting flat for a whole series
  would otherwise be the cheapest possible way to farm a discipline badge.
- **Badges are recomputed from lifetime stats on every load**, never stored as a
  list. A corrupted or partial save then can't lose one someone earned, and changing
  a rule applies retroactively rather than only to new players. It's also why
  renaming every id from `character:*` to `badge:*` needed no save migration.
- **Lifetime totals were being recorded and displayed nowhere.** The record screen
  leads with clean runs rather than profit, because that's the number the game is
  about.

### Settings: live mix

- **Volume was applied once at construction and never again**, so a slider did nothing
  until the next run started — and on the settings screen, where the only thing
  playing is the title bed, it appeared to do nothing at all. `AudioSystem.setMix`
  makes it live. Not an exception to "config is fixed for a run's duration": that rule
  is about settings that change the *challenge*, and the mix is excluded from the run
  fingerprint precisely because it doesn't.
- **A mix change moves a gain; it does not restart the session.** Restarting would
  drop the music back to the top of the progression on every pixel of slider travel.
  So `backdropKey` — which decides whether a restart is warranted — deliberately
  excludes volume, and deliberately *includes* `audio.theme`, where a different
  progression and possibly a different bed engine mean there's nothing to adjust in
  place.
- **Gains ramp over 40ms rather than being set.** A stepped gain change on a sounding
  voice is an audible edge, and a drag would machine-gun them.
- **The effects slider gets an audition cue**, because behind a menu there are no
  position events, so channel 3 would be silent for exactly as long as the player is
  trying to set its level. Stingers are therefore built in menu mode too — but
  `update()` is inert there, so the only way one sounds behind a menu is the explicit
  preview. Throttled to 220ms: a stinger per pixel of travel is a machine gun, not a
  preview. Master and music need no cue, since the bed is already audible.
- **`toGain` moved to `audio/mix.ts` to be testable.** One rule in it has a right and
  a wrong answer: **muted is exactly zero**, not −60dB, which is audible in a quiet
  room and gets reported as a broken mute button. It also rejects non-finite values —
  a NaN gain silences a Web Audio node permanently and is near-impossible to diagnose
  from the symptom. The previous version round-tripped through `gainToDb`/`dbToGain`,
  which cancelled out and only obscured what the number meant.

### Settings: OK / Cancel, and two columns

- **OK and Cancel, not "Start run".** Reaching this screen isn't a commitment to
  play — it's often "turn the music down and go back" — so neither button starts
  anything, and both return to the title. OK takes effect immediately: the committed
  config is what the backdrop draws, what Play runs, and what the personal-best
  bucket keys on.
- **Cancel needs a snapshot taken on entry.** The screen previews live, which means
  it mutates the committed config as the player scrolls through moods. Without
  stashing the config when the screen opens, backing out would silently keep every
  change made while looking around — and leave the previewed world on screen.
- **Two columns via `auto-fit` with a `minmax(300px, 1fr)` track**, not a hard
  `1fr 1fr` plus a media query: the same rule collapses to one column on a phone,
  and section reading order survives either way. `align-items: start` stops a short
  card stretching to match a tall neighbour and becoming mostly padding. The two
  disclosures span both columns — they hold wide content and read badly at half
  width.
- **OK/Cancel live only in the sticky header.** They were briefly duplicated at the
  bottom as well, on the theory that two columns put the footer a long way from
  whatever was just changed — but a sticky header already solves that, and a second
  copy of the same pair is just a second thing to read. The personal-best line moved
  up under the header, where it sits with the config it describes.

### Mobile

- **There was no touch input at all** — `input/` bound `keydown`/`keyup`/`blur` and
  nothing else, so on a phone there was no way to buy or sell. Easy to miss because
  the *render* side was already portrait-ready (orientation-aware bar count, a
  two-line portrait HUD), which made the game look supported.
- **Thumb buttons are DOM; the gesture mapping is not.** `ui/mobile/` draws the
  buttons (allowed: static for the whole run, and touch is what DOM is good at) and
  binds handlers from `input/touchControls.ts`, so tap-versus-hold has exactly one
  implementation. The seam type lives in `shared/contracts/controls.ts` because
  neither zone may import the other — same pattern as `StopInstanceSpec`.
- **`pointerdown`, not `click`.** A click fires on release, which would make every
  entry feel late, and the exit button needs the press/release pair anyway.
- **A thumb sliding off the button cancels rather than exits.** The release happens
  outside the element so `pointerup` never arrives, and without a cancel path the
  hold timer fires a flatten the player didn't ask for.
- **No whole-screen region tapping.** The chart occupies the screen and a misplaced
  tap would open a position; discrete corner buttons also keep a thumb off the poles
  being read.
- **Thumb buttons key off `(pointer: coarse)`**, not screen width or a user-agent
  string: a small desktop window still has a mouse, a tablet with a keyboard still
  has a touchscreen.
- **Haptics ship as `navigator.vibrate`**, feature-detected and silent where absent
  (iOS Safari, desktop). Correct rather than degraded — haptics are always redundant
  with something visible and audible. Capacitor's plugin swaps in inside
  `platform/haptics/haptics.ts` and nothing else changes.

## Step 10 — Synthetic source

Built as `data.source: synthetic`: three seeded series from a log-normal random
walk with Box–Muller normal shocks, so they have realistic tails rather than a
uniform cap on daily moves. Seeded per symbol, because a source that generated
something different every load would break personal-best comparison.

## Step 11 — Packaging

**Configured, not built.** `src-tauri/tauri.conf.json`, `capacitor.config.json`,
and the `desktop:*` / `android:*` scripts are in place; neither shell has been
built, because Tauri needs a Rust toolchain and Capacitor needs the Android SDK
and neither is installed here. See [packaging.md](./packaging.md) for what's
still missing (icons, `Cargo.toml`) and why.

- **Neither CLI is a dependency.** The scripts fetch on first use, so the web
  build's install stays small and an unbuildable native toolchain can't break
  `npm install`.
- **The CSP has to allow `blob:` in `script-src` *and* `worker-src`.** The plugin
  sandbox works by `import()`-ing a blob URL inside the worker, which is the only
  mechanism available for evaluating player source there. A default-restrictive CSP
  silently breaks every imported plugin. It looks like a security regression and
  isn't: the blob is what keeps plugin code *inside* the worker, and denying it
  wouldn't make plugins safer, only impossible — with the pressure then to run them
  on the main thread, which is the actually dangerous option.

## Corrections to the gap audit

Two claims in the original gap inventory were wrong and are worth recording:

- **The ATR stop already existed.** `plugins/builtin/stops/atrStop.ts` and the ATR
  indicator were both built and registered; the inventory listed
  "no indicator-consuming stop" as outstanding. Nothing was needed.
- **The plugin worker had a real bug the audit didn't find**: `load` replied with a
  hardcoded `id: 0` instead of the request's id, so the host would have resolved
  whichever call happened to be outstanding. It had never been caught because
  nothing instantiated the worker.
