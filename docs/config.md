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
presses to fully deploy, matching the 5-ghost cap in
[character.md](./character.md#position-size-visualization)). Expect all of
them to move once the game is playable; they're starting points, not
considered defaults.

## Trading

| Key | Description | Default |
|---|---|---|
| `startingCapital` | Cash balance at the start of a run; caps both long and short notional | $10,000 |
| `entrySize` | Cash deployed per *entry or add* press (`buy` when flat/long, `sell` when short-adding). Clamped to remaining buying power | 20% of `startingCapital` *(provisional)* |
| `exitFraction` | Fraction of the open position closed per *reduce* press (`sell` when long, `buy` when short). Clamped to flat | 25% *(provisional)* |
| `allowShorting` | `sell` while flat opens a short instead of being a no-op. Engine carries signed size regardless — see [game-design.md](./game-design.md#shorting) | off |
| `costBasisMethod` | `weighted-average` (built) or `fifo` (config option, unimplemented until wanted) | `weighted-average` |

Key names describe their **effect on position size** (grow vs. shrink), not
the button pressed — `buy` on a short is an *exit* and so is governed by
`exitFraction`. See the order-intent matrix in
[game-design.md](./game-design.md#order-intent-matrix); getting this
backwards is the most likely recurring bug in the engine.

Position size is carried in **fractional shares**; cash and percentages are
input units only. Sizes below `1e-6` shares snap to flat.

## Stops

| Key | Description | Default |
|---|---|---|
| `stops.active` | List of active stop plugin instances (`{ typeId, params }`). Multiple may be active; whichever level is hit first closes the position. See [stops.md](./stops.md) | empty (no stop — player fully in charge of exits) |
| `stops.plugins.loaded` | Loaded custom stop plugin references, same loading surface as indicator plugins | empty |

Built-ins available to add: `fixed-percent` (param: `percent`, from average
entry) and `trailing-percent` (param: `percent`, from best price reached).
Stop levels computed at bar N's close are enforced against bar N+1 —
see [stops.md](./stops.md#causality-and-timing).

Stops trigger on the **bar's close**, not its intraday low, and invert
direction for shorts — see
[game-design.md](./game-design.md#risk-management). Score is reported as
both currency P&L and percent return on `startingCapital`. Fills execute at
the close of the pole the character is standing on.

## Scroll / poles

| Key | Description | Default |
|---|---|---|
| `scrollSpeed` | Speed in **bars per second** (trading days per second), not pixels — resolution-independent, and the auto-bounce cadence derives from it. Range 0.5–10 | 2 *(provisional)* |
| `visibleBarCount` | How many bars fit on screen at once. Bar width is derived as `playfieldWidth / visibleBarCount`, where **playfield means the pole region only** (left edge to the character, ~70–80% of viewport — not the full width, since the fog strip never holds poles). Also sets the `visible-window-min-max` window and therefore how reactive the axis is. **Orientation-aware**: 60 landscape / ~28 portrait, since 60 poles at phone width are ~4px and unreadable — see the wireframes in [hud.md](./hud.md#screen-layout) | 60 landscape, 28 portrait *(provisional)* |
| `priceTransform` | Applied to price *before* normalization: `none` or `log10`. `log10` tames series with a huge range so outlier days don't flatten everything else | `none` |
| `normalizationMode` | How transformed price maps to pole height — see table below | `visible-window-min-max` |
| `normalizationReference` | Reference scale value for `starting-price-relative` | 100 |

These are **two independent fields on purpose.** A single enum can't
represent the valid combinations, because the log transform *composes* with
a normalization mode rather than replacing one — "log price, then
visible-window min/max" is a legitimate and useful setting that a
one-field model has no way to express.

### `normalizationMode` values

Only **causal** modes (no future data) are legal during a live run. Modes
that compute bounds over the whole series leak future prices through the
axis — see
[game-design.md](./game-design.md#why-full-series-normalization-leaks) for
a worked example.

| Mode | Description | Live play? |
|---|---|---|
| `visible-window-min-max` | Min/max over only the bars currently on screen, **excluding anything behind the leading-edge fog** | ✅ default |
| `fixed-price-per-pixel` | Constant scale factor, no data-dependent bounds | ✅ |
| `starting-price-relative` | Divide every price by the first bar's close (reference always in the past) | ✅ |
| `whole-series-min-max` | Min/max over all bars, including unplayed ones | ❌ leaks the run's high/low |
| `closing-price-relative` | Divide by the *last* bar's close | ❌ reference is the final price — worst leak |
| `average-price-relative` | Divide by the series' mean close | ❌ mean includes future bars |
| `high-price-relative` / `low-price-relative` | Divide by the series' max/min close | ❌ reference may be a future bar |

`priceTransform: log10` is causal regardless of mode — it's a per-bar
function with no dependence on other bars — so it inherits the legality of
whichever mode it composes with.

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
| `indicators.active` | List of active indicator instances (`{ typeId, params, instanceId }`), each an overlay or oscillator per its `paneKind`. See [indicators.md](./indicators.md) | empty; only `sma` (Simple Moving Average) available to add initially |
| `indicators.plugins.loaded` | List of loaded custom plugin references (file path on desktop, imported blob on mobile) | empty |
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
| `visuals.worldSeed` | Seeds the PRNG that generates background layers. Same theme + seed always yields an identical world; surfaced so a good-looking world can be recovered | random per run |
| `visuals.reducedMotion` | Damps parallax, particles, and transitions. Initialized from the OS `prefers-reduced-motion` setting | OS-derived |
| `visuals.screenShake` | Screen shake on stop-out and large wins | on |
| `visuals.pnlPalette` | `blue-orange` (colorblind-safe default) or `red-green` (familiar trading convention). P&L is never conveyed by color alone regardless — see [accessibility.md](./accessibility.md) | `blue-orange` |

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
| `data.source` | Which `PriceSeriesSource` implementation to use; switchable at runtime, not a build-time choice. See [data-sources.md](./data-sources.md) | `bundled` |
| `data.ticker` | Selected symbol, chosen from a dropdown of what the active source offers. Bundled set: `AAPL` (uptrend), `MSFT` (choppy), `NKE` (downtrend) | `AAPL` |
| `data.dateRange` | Optional sub-range (epoch seconds, inclusive); unset plays the whole series | unset |

## Controls

Key bindings and mobile button layout are fixed rather than configurable
for now — see [controls.md](./controls.md). Rebindable controls are a
reasonable later addition but not a launch requirement for a two-button
game.
