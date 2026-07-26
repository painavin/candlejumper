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

One deliberate exception: `initialStopLoss` and `trailingStop` levels can
be adjusted on an *open position* during a run — that's a trading
decision, not a settings change. See
[game-design.md](./game-design.md#risk-management).

**Tuning values below marked _provisional_ were chosen for internal
consistency, not from play** (e.g. `buyUnitSize` at 20% gives exactly five
presses to fully deploy, matching the 5-ghost cap in
[character.md](./character.md#position-size-visualization)). Expect all of
them to move once the game is playable; they're starting points, not
considered defaults.

## Trading / risk management

| Key | Description | Default |
|---|---|---|
| `startingCapital` | Cash balance at the start of a run; caps how far the player can scale in | $10,000 |
| `buyUnitSize` | Cash amount deployed per buy press | 20% of `startingCapital` *(provisional)* |
| `sellUnitSize` | Fraction of the open position closed per sell press | 25% *(provisional)* |
| `allowShorting` | `sell` while flat opens a short position instead of being a no-op. Engine carries signed size regardless — see [game-design.md](./game-design.md#shorting) | off |
| `costBasisMethod` | `weighted-average` (built) or `fifo` (config option, unimplemented until wanted) | `weighted-average` |
| `initialStopLoss` | Stop distance as a **percent** from average entry. Disabled = no forced exit; player has full manual control | off |
| `trailingStop` | Trailing stop distance as a **percent** from the best price reached. Disabled = no forced exit | off |

Stops trigger on the **bar's close**, not its intraday low, and invert
direction for shorts — see
[game-design.md](./game-design.md#risk-management). Score is reported as
both currency P&L and percent return on `startingCapital`. Fills execute at
the close of the pole the character is standing on.

## Scroll / poles

| Key | Description | Default |
|---|---|---|
| `scrollSpeed` | Speed in **bars per second** (trading days per second), not pixels — resolution-independent, and the auto-bounce cadence derives from it. Range 0.5–10 | 2 *(provisional)* |
| `visibleBarCount` | How many bars fit on screen at once. Bar width is derived as `playfieldWidth / visibleBarCount`, where **playfield means the pole region only** (left edge to the character, ~70–80% of viewport — not the full width, since the fog strip never holds poles). Also sets the `visible-window-min-max` window and therefore how reactive the axis is | 60 *(provisional)* |
| `poleHeightNormalization` | Method used to map price to pole height — see table below | `visible-window-min-max` |
| `poleHeightNormalization.multiplier` | Reference scale value for `starting-price-relative` | 100 |

### `poleHeightNormalization` methods

Only **causal** methods (no future data) are legal during a live run.
Methods that compute bounds over the whole series leak future prices
through the axis — see
[game-design.md](./game-design.md#why-full-series-normalization-leaks) for
a worked example.

| Method | Description | Live play? |
|---|---|---|
| `visible-window-min-max` | Min/max over only the bars currently on screen, **excluding anything behind the leading-edge fog** | ✅ default |
| `fixed-price-per-pixel` | Constant scale factor, no data-dependent bounds | ✅ |
| `starting-price-relative` | Divide every price by the first bar's close (reference always in the past) | ✅ |
| `log-price` | Apply `log10` before any of the above (pre-transform, not standalone) | ✅ |
| `whole-series-min-max` | Min/max over all bars, including unplayed ones | ❌ leaks the run's high/low |
| `closing-price-relative` | Divide by the *last* bar's close | ❌ reference is the final price — worst leak |
| `average-price-relative` | Divide by the series' mean close | ❌ mean includes future bars |
| `high-price-relative` / `low-price-relative` | Divide by the series' max/min close | ❌ reference may be a future bar |

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
`poleHeightNormalization` above, not separately configured) and the top
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
| `data.ticker` | Selected ticker/symbol, chosen from a dropdown of what the active source offers | first bundled ticker |
| `data.dateRange` | Optional sub-range of the selected ticker's series; unset plays the whole series | unset |

## Controls

Key bindings and mobile button layout are fixed rather than configurable
for now — see [controls.md](./controls.md). Rebindable controls are a
reasonable later addition but not a launch requirement for a two-button
game.
