# Config Reference

Consolidated list of every configurable parameter across systems. This is
the source of truth for what the settings panel (see
[roadmap.md](./roadmap.md) milestone 5) needs to expose.

**All config is set before a run starts, not edited mid-run.** A run uses
one fixed configuration from first bar to last — changing settings means
returning to the settings screen and starting a new run. This keeps runs
comparable for personal-best tracking (a run whose scroll speed or stop
rules changed halfway through isn't a meaningful score), and it means the
settings UI and the game loop are never active simultaneously.

**No exceptions.** Stop levels are *not* editable mid-run either — stops are
plugins that recompute themselves each bar from a rule committed before the
run ([stops.md](./stops.md)). The player commits to a rule and lives with
it, which is the discipline lesson rather than a limitation.

**Tuning values below marked _provisional_ were chosen for internal
consistency, not from play** (e.g. `entrySize` at 20% gives exactly five
units to fully deploy, matching the 5-ghost cap in
[character.md](./character.md#position-size-visualization)). Expect all of
them to move once the game is playable; they're starting points, not
considered defaults.

## Trading

| Key | Description | Default |
|---|---|---|
| `startingCapital` | Cash balance at the start of a run; caps both long and short notional | $10,000 |
| `entrySize` | Cash deployed per *entry or add* press, stored as a **percent of `startingCapital`** so it tracks when that changes. Buying power, not a fixed multiple of this, is what bounds the open unit count — an entry clamped by remaining capital still counts as one unit. See [game-design.md](./game-design.md#trading-engine) | 20% of `startingCapital` *(provisional)* |
| `allowShorting` | `sell` while flat opens a short instead of being a no-op. Engine carries signed size regardless — see [game-design.md](./game-design.md#shorting) | off |
| `costBasisMethod` | `weighted-average` (built) or `fifo` (config option, unimplemented until wanted) | `weighted-average` |
| `flattenHoldMs` | How long the exit key must be held to close everything — see [controls.md](./controls.md#flatten-close-everything) | 400 |

**Exits are not separately configurable.** Each exit press closes
`shares / unitCount` — one unit's worth — so N entries always take exactly N
exits to reach flat. A percentage-of-remaining setting was considered and
rejected: it decays geometrically and never closes (49 presses at 25% to
reach the flat threshold). See
[game-design.md](./game-design.md#order-intent-matrix).

Position size is carried in **fractional shares**, with `unitCount` tracking
open entry presses. Sizes below `1e-6` shares snap to flat.

## Stops

| Key | Description | Default |
|---|---|---|
| `stops.active` | Active stop plugin instances: `{ typeId, params, advisory }`. Multiple may be active; whichever enforcing level is hit first closes the position. See [stops.md](./stops.md) | one **advisory** `trailing-percent` at 8% *(provisional)* |

Per-instance **`advisory: true`** displays the level without enforcing it —
the player must honour it themselves, and breaches are recorded as
compliance events ([stops.md](./stops.md#advisory-mode)). Advisory levels
draw dashed, enforcing ones solid.

**The default is one advisory stop rather than an empty list.** A trainer
whose out-of-the-box configuration carries no risk rule is a strange default,
and the discipline streak
([game-feel.md](./game-feel.md#where-the-streak-has-tension--and-where-it-doesnt))
has nothing to measure without one — advisory specifically, because that's
the only mode where the *player* rather than the engine is being measured.
Clearing the list is still fully supported and scores normally; the streak
meter simply goes dormant.

Built-ins available to add: `fixed-percent` (param: `percent`, default 5%,
from average entry) and `trailing-percent` (param: `percent`, default 8%,
from best price reached — looser than the fixed stop because it ratchets).
Both percents are *provisional*. Stop levels computed at bar N's close are
enforced against bar N+1 —
see [stops.md](./stops.md#causality-and-timing). Manual exits and flatten
always override an enforcing stop
([stops.md](./stops.md#player-override)).

A stop plugin may **consume indicators** to compute its level
([stops.md](./stops.md#using-indicators-inside-a-stop-plugin)). Its
dependencies are derived from its own `params` and so need no config key of
their own — but they add one **pre-run validation rule**: every indicator a
configured stop requests must resolve in the registry, or the run refuses to
start. A stop's indicator instances are separate from anything in
`indicators.active`, so the two lists never interact — toggling a chart
indicator cannot change what a stop does.

Stops trigger on the **bar's close**, not its intraday low, and invert
direction for shorts — see
[game-design.md](./game-design.md#risk-management). Score is reported as
both currency P&L and percent return on `startingCapital`. Fills execute at
the close of the pole the character is standing on.

## Scoring (the discipline streak)

| Key | Description | Default |
|---|---|---|
| `scoring.streakEnabled` | The discipline streak and its multiplier. Off means raw P&L only, no `arcadeScore`, no meter | on |
| `scoring.maxMultiplier` | Cap on `1 + streak`. 5 matches the five-unit full deployment and the five-ghost stack — one number governing all three | 5 *(provisional)* |

The streak ticks on **rule compliance, not profitability** — a loss taken
because the player's own committed rule said to exit builds the meter exactly
as a win does. Only ignoring a breached advisory level resets it. Full rules,
including the automated and dormant meter states, are in
[game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-the-discipline-streak).

There is deliberately **no qualifying-P&L threshold and no time decay** to
configure. Neither is needed once compliance rather than profit drives the
meter: the multiplier pays out only on profitable closes, so climbing it with
scratch trades earns nothing, and a decay timer would create an incentive to
always be in a position.

`arcadeScore` is a second score shown beside raw realized P&L, never in place
of it. Personal bests key off percent return as before, with best
`arcadeScore` recorded alongside in the same fingerprint bucket
([game-feel.md](./game-feel.md#new-session-structure-the-highest-leverage-item-here)).

## Scroll / poles

| Key | Description | Default |
|---|---|---|
| `scrollSpeed` | Speed in **bars per second** (trading days per second), not pixels — resolution-independent, and the auto-bounce cadence derives from it. Range 0.5–10 | 2 *(provisional)* |
| `visibleBarCount` | How many bars fit on screen at once. Bar width is derived as `playfieldWidth / visibleBarCount`, where **playfield means the pole region only** (left edge to the character, ~70–80% of viewport — not the full width, since the strip right of the character never holds poles). Also sets the `visible-window-min-max` window and therefore how reactive the axis is. **Orientation-aware**: 60 landscape / ~28 portrait, since 60 poles at phone width are ~4px and unreadable — see the wireframes in [hud.md](./hud.md#screen-layout). **Resolved once at run start and frozen for the run** — see below | 60 landscape, 28 portrait *(provisional)* |
| `priceTransform` | Applied to price *before* normalization: `none` or `log10`. `log10` tames series with a huge range so outlier days don't flatten everything else | `none` |
| `normalizationMode` | How transformed price maps to pole height — see table below | `visible-window-min-max` |
| `normalizationReference` | Reference scale value for `starting-price-relative` | 100 |

These are **two independent fields on purpose.** A single enum can't
represent the valid combinations, because the log transform *composes* with
a normalization mode rather than replacing one — "log price, then
visible-window min/max" is a legitimate and useful setting that a
one-field model has no way to express.

**Rotating the device mid-run does not change `visibleBarCount`.** It is
resolved once, at run start, from the orientation at that moment, and frozen
for the run — rotation re-lays out pixel geometry only. Three reasons this
matters more than it looks:

- `visibleBarCount` is the `visible-window-min-max` window, so changing it
  mid-run would rescale the chart under the player.
- It's a **run-fingerprint key**
  ([game-feel.md](./game-feel.md#new-session-structure-the-highest-leverage-item-here)),
  so a rotation would silently move the run into a different personal-best
  bucket.
- It's config, and config is fixed for a run's duration. No exception is
  needed here.

A portrait-started run rotated to landscape therefore shows its 28 bars
wider rather than reflowing to 60 — readable, and stable.

### `normalizationMode` values

Only **causal** modes (no future data) are legal during a live run. Modes
that compute bounds over the whole series leak future prices through the
axis — see
[game-design.md](./game-design.md#why-full-series-normalization-leaks) for
a worked example.

| Mode | Description | Live play? |
|---|---|---|
| `visible-window-min-max` | Min/max over only the bars currently on screen, **excluding any bar right of the character** | ✅ default |
| `fixed-price-per-pixel` | Constant scale factor, no data-dependent bounds | ✅ |
| `starting-price-relative` | Divide every price by the first bar's close (reference always in the past) | ✅ |
| `whole-series-min-max` | Min/max over all bars, including unplayed ones | ❌ leaks the run's high/low |
| `closing-price-relative` | Divide by the *last* bar's close | ❌ reference is the final price — worst leak |
| `average-price-relative` | Divide by the series' mean close | ❌ mean includes future bars |
| `high-price-relative` / `low-price-relative` | Divide by the series' max/min close | ❌ reference may be a future bar |

`priceTransform: log10` is causal regardless of mode — it's a per-bar
function with no dependence on other bars — so it inherits the legality of
whichever mode it composes with.

**Only the three ✅ modes are implemented.** The ❌ rows are documentation of
what was considered and why it's excluded, not code paths gated behind a
flag — an unimplemented mode can't leak, and a gated one is one careless
condition away from leaking. The settings UI offers three options.

The ❌ methods could be revived in a **post-run review/replay mode**, where
the outcome is already known — not built now. See
[game-design.md](./game-design.md#pole-generation--scroll) for methods
rejected outright (z-score/centering, return-series normalization,
brick/box resampling).

## HUD

| Key | Description | Default |
|---|---|---|
| `hud.showStopLevelOnChart` | Draw the active stop-loss/trailing-stop level as a horizontal line on the chart, in addition to the HUD readout | on |

See [hud.md](./hud.md) for the auto-scaling Y-axis (driven by
`normalizationMode` above, not separately configured) and the top
HUD (score/position/session info, not separately configurable — always
shown).

## Indicators & Volume

| Key | Description | Default |
|---|---|---|
| `indicators.active` | List of active indicator **instances** (`{ typeId, params, instanceId, colour, paneKind? }`). Several of one type at different params is the normal case — SMA 20 / 50 / 200 is three entries. `colour` comes from the fixed palette in `shared/palette/`; `paneKind` overrides the plugin's own hint, and unset means "whatever the plugin suggests". Excluded from the run fingerprint. See [indicators.md](./indicators.md) | empty; `sma` and `atr` available to add |
| `volume.enabled` | Show/hide the volume histogram sub-pane at the bottom of the screen | on |

Volume uses the same oscillator sub-pane mechanism as any other
indicator — see [indicators.md](./indicators.md#volume-pane--built-on-the-same-mechanism)
— so it has no separate normalization config; it defaults to
visible-window min/max like other oscillators without a fixed range.
Concurrent sub-panes are capped at 3 on desktop and 1 on mobile — see
[hud.md](./hud.md#sub-pane-vertical-layout).

## Visuals

| Key | Description | Default |
|---|---|---|
| `background.layers.<name>.enabled` | Per-layer on/off (sky, clouds, mountains, trees, ground/poles) | all on |
| `background.layers.<name>.speedMultiplier` | Per-layer speed relative to `scrollSpeed` — motion only, fixed across themes | see [visuals.md](./visuals.md) table |
| `visuals.theme` | Selected visual theme **parameter set** — palette plus shape/noise params for every layer, generated at runtime (no art files). See [visuals.md](./visuals.md#visual-themes) and [procedural-assets.md](./procedural-assets.md) | `jolly` |
| `visuals.worldSeed` | Seeds the PRNG that generates background layers. Same theme + seed always yields an identical world; surfaced so a good-looking world can be recovered | freshly minted per run via `shared/math/` `mintSeed()` |
| `visuals.motionOverride` | The player's explicit motion choice: `true` reduced, `false` full, **unset** follow the OS. The only motion value that is saved | unset |
| `visuals.reducedMotion` | Damps parallax, particles, and transitions. The **resolved** value every renderer reads, derived at boot from `motionOverride` and `prefers-reduced-motion`. Never persisted — it's an outcome, not a preference | OS-derived |
| `visuals.screenShake` | Screen shake on stop-out and large wins | on |
| `visuals.pnlPalette` | `red-green` (the familiar trading convention) or `blue-orange` (colorblind-safe). Drives the HUD, the exit particles, the menus' up/down accents, **and the candle bodies** — a chart is the setting's most important consumer. P&L is never conveyed by color alone regardless — see [accessibility.md](./accessibility.md) | `red-green` |
| `visuals.barStyle` | `bollinger` (one uniform column, open→close picked out in colour) or `candlestick` (narrow wick through a wide body). Both draw all four prices, so this is a reading preference and is **excluded from the run fingerprint**. See [game-design.md](./game-design.md#candle-geometry) | `bollinger` |

## Character

| Key | Description | Default |
|---|---|---|
| `character.selected` | Which roster entry is jumping — purely cosmetic, no gameplay effect. See [character.md](./character.md) for the roster shape and starter set (`robin`, `bull`, `bear`) | `robin` |

## Audio

| Key | Description | Default |
|---|---|---|
| `audio.theme` | Selected audio theme **parameter set** — chord progression, synth recipes, and scale for all three channels, synthesized at runtime (no audio files). See [audio.md](./audio.md#audio-themes) | `jolly` |
| `audio.masterVolume` | Overall volume | 1.0 |
| `audio.musicVolume` / `audio.musicMuted` | Ambient bed (channel 1), independent of theme | 0.6 / false |
| `audio.sfxVolume` / `audio.sfxMuted` | Sonification + stingers (channels 2–3), independent of theme | 0.8 / false |

`audio.theme` and `visuals.theme` are separate keys, but the settings UI
presents a single **"mood" picker** that sets both together — one coherent
choice by default, with the two keys still independently editable for
anyone who wants to mix them. See
[visuals.md](./visuals.md#visual-themes).

## Data

| Key | Description | Default |
|---|---|---|
| `data.source` | Which `PriceSeriesSource` implementation to use; switchable at runtime, not a build-time choice. `bundled`, `synthetic`, or `downloaded` — the library of series you've downloaded from a provider or imported from a file. See [data-sources.md](./data-sources.md) | `bundled` |
| `data.ticker` | The active source's id for the selected series, chosen from a dropdown of what it offers. Bundled set: `AAPL` (uptrend), `MSFT` (choppy), `NKE` (downtrend). Under `downloaded` it is `SYMBOL@interval` — `INTC@1wk` — because one ticker can be held at several intervals and they are different series. Treat it as opaque; only the source that published it may take it apart. A bare id from before intervals existed still resolves, as daily | `AAPL` |
| `data.dateRange` | Optional sub-range (epoch seconds, inclusive); unset plays the whole series | unset |

## Persistence

The whole tree above is saved under `candlejumper:config` and restored at the
next launch — see [tech-stack.md](./tech-stack.md#what-is-stored-where) for the
full storage map. Five rules, each deliberate:

- **Written on OK, and nowhere else.** The settings screen previews live by
  mutating the committed config, so writing on every change would save a mood
  the player was only looking at. This is what makes Cancel mean something.
- **Versioned** (`CONFIG_VERSION`), and a mismatch falls back to defaults rather
  than guessing at a half-migration.
- **Permissive about missing fields, strict about wrong ones.** A file written by
  an older build keeps everything it does carry; a field outside its domain falls
  back on its own without taking its neighbours with it. Nothing is *clamped* —
  a stored volume of `4` becomes the default rather than `1`, because a value
  nothing could have written is not evidence of intent.
- **Restored after the plugin host loads.** `stops.active` and
  `indicators.active` name plugins by id, so reading them before the imported
  ones registered would report every player plugin as missing.
- **`stops.active` and `indicators.active` are never filtered on load.** A stop
  whose plugin has gone missing survives to be complained about: `validateConfig`
  refuses the run and names it, which is far better than silently disarming a
  risk rule. `data.ticker` is the exception — a series that's no longer in the
  library falls back to one that is, because there is no danger in it and a
  sensible default exists.

Two things are read fresh at every launch instead: `visuals.reducedMotion` (see
above) and whether the device has a coarse pointer.

## Controls

Key bindings and mobile button layout are fixed rather than configurable
for now — see [controls.md](./controls.md). Rebindable controls are a
reasonable later addition but not a launch requirement for a two-button
game.
