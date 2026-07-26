# Indicators & Plugin Architecture

## Goal

Let players overlay technical indicators on the chart, and — beyond a
small built-in set — load their own custom indicator code. This is our
own plugin architecture, designed for Candle Runner specifically; it
isn't a port of, or a dependency on, any external library. Built-ins and
user plugins conform to the exact same contract, so there's no
special-casing between "official" and "user" indicators once loaded.

## Design approach: incremental, per-bar computation

Indicators compute one new value each time a new bar (pole) scrolls in,
not a full recompute of the whole series every frame. This keeps cost
bounded as a run gets longer, and matches how the game already consumes
data — one bar at a time, in order, as poles enter from the right. Each
indicator instance is stateful across bars, exposes a `reset()` for reuse
(e.g. switching ticker mid-session), and can emit more than one named
output per bar — needed for indicators that produce several related
series from one calculation (a band indicator's upper/middle/lower lines,
for example).

## Shared types

These are used by indicator plugins, stop plugins
([stops.md](./stops.md)), and the data layer
([data-sources.md](./data-sources.md)) alike — one definition, not three.

```ts
/** One trading day. Field names match the bundled data schema exactly. */
interface OhlcvBar {
  o: number       // open
  h: number       // high
  l: number       // low
  c: number       // close
  v: number       // volume
  t: number       // epoch SECONDS (not ms), UTC, market-open aligned
}

/** Declares one tunable parameter; drives the settings UI automatically. */
interface ParamSpec {
  key: string
  displayName: string
  type: 'int' | 'float' | 'percent' | 'bool' | 'enum'
  default: number | boolean | string
  min?: number            // required for int/float/percent
  max?: number
  step?: number
  options?: string[]      // required for enum
  unit?: string           // e.g. 'bars', '%', '$' — display suffix only
}
```

Notes that matter for implementation:

- **`t` is in seconds, not milliseconds** — the bundled files use epoch
  seconds, so anything handing these to `new Date()` must multiply by 1000.
  This is exactly the kind of unit mismatch that produces dates in 1970 and
  costs an afternoon.
- Bars use **single-letter keys** because that's the shape of the bundled
  data; the engine consumes them as-is rather than remapping to verbose
  names, so there's one representation end to end.
- `ParamSpec` is intentionally sufficient to **render a settings control
  without any per-plugin UI code** — that's the whole point of declaring
  min/max/step/unit rather than leaving validation to the plugin.

## TypeScript indicator contract

```ts
interface IndicatorPlugin {
  id: string
  displayName: string
  /** Short form for chart legends, e.g. 'SMA'. Falls back to displayName. */
  abbreviation?: string
  paneKind: 'overlay' | 'oscillator'
  outputs: string[]              // named output series, e.g. ['macd', 'signal', 'histogram']
  params: ParamSpec[]
  /** Fixed y-range for oscillator panes that have one (e.g. [0, 100] for RSI). */
  fixedRange?: [number, number]
  createInstance(params: Record<string, number>): IndicatorInstance
}

interface IndicatorInstance {
  reset(): void
  /**
   * Called once per bar, in order. Returns one value per declared output.
   * Return NaN for bars where the indicator isn't yet warmed up
   * (e.g. an SMA(20) before 20 bars exist) — the renderer skips NaN
   * rather than drawing a line to zero.
   */
  onBar(bar: OhlcvBar, isLastBar: boolean): Record<string, number>
}
```

Built-ins and user plugins are both just objects matching
`IndicatorPlugin`. There is no separate "official indicator" code path.

The **warm-up convention matters**: without an explicit "no value yet"
signal, a moving average's first bars either draw a line from zero or
require every renderer to special-case startup. `NaN` gives one rule
everywhere.

## Several instances of one indicator

`indicators.active` is a list of **instances**, not a set of enabled types, so
SMA 20, SMA 50, and SMA 200 are three entries with the same `typeId` and
different `params`. Each gets its own `createInstance` call and its own
accumulator, which is what makes them warm up on their own schedules — a
shared accumulator would warm all three at the shortest length and quietly
emit a wrong long average for the first bars.

Three things this needs beyond the list itself:

- **Instance ids are the smallest unused integer per type** (`sma-1`, `sma-2`,
  …). Deterministic because `Math.random()` is banned repo-wide, and reusing a
  freed number keeps ids stable across an add/remove/add cycle so the same
  configuration always produces the same ids.
- **Every instance names itself from its own params**, via `instanceLabel` —
  `SMA 20`, not `Simple Moving Average`. That's what `abbreviation` is for: a
  legend reading "Simple Moving Average 20 / Simple Moving Average 50 / Simple
  Moving Average 200" is unreadable at the size a legend has to be. Every
  declared param is appended in declaration order, so MACD(12, 26, 9) labels
  itself without knowing the function exists.
- **Each instance carries its own line colour**, chosen by the player from the
  fixed palette in `shared/palette/`. Per instance rather than derived from list
  position: otherwise removing one indicator recolours every line below it, and a
  player who learned "the amber one is the 200" has to relearn it. A new instance
  is assigned the first unused palette colour — deterministic, wrapping when
  there are more instances than colours, and reusing a freed colour rather than
  marching on.

  The palette is **fixed rather than a free colour picker**. An arbitrary hex
  value lets a player choose something that vanishes into the sky, or a red that
  reads as a losing bar — the two things a chart overlay must never do. Every
  entry is named, because a swatch alone conveys nothing to a screen reader and
  "the third orange square" isn't a choice a colourblind player can make.
- **The chart draws a legend once more than one overlay is active.** Three
  overlays in three colours are otherwise indistinguishable, and three unlabelled
  lines is worse than one labelled line — which makes the legend part of the
  feature rather than a polish item. A single overlay draws no legend: it names
  itself well enough in settings, and a one-row legend is clutter.

`instanceLabel` lives in `shared/contracts/` and is the *same* function the
legend, the pane titles, and the settings rows all call. It takes a
`LabelledIndicator` — names plus param specs — rather than a whole plugin,
because `ui/` only ever holds a descriptor and may not reach `plugins/`. If
these ever disagreed, a settings row and a chart line would name the same
series two different ways.

## Managing them in settings

**The settings screen has one collapsible section per plugin kind**, each owning that
kind end to end: Stop rules holds the configured stops *and* the button to import more,
Indicators holds the configured instances *and* the button to import more.

That replaced a single "Plugins" section that held the import buttons for both kinds
while the stop rules lived in their own card and the indicators in a third place.
Splitting by **kind** rather than by "is it a plugin" means there's one place to go per
question — "what are my stops", "what's on my chart" — instead of two halves of each
answer in different sections. It also means adding a third plugin kind adds one section
rather than editing two.

Both are collapsed, matching Advanced, but **each summary carries a state line** so the
collapsed form still answers its own question: `Stop rules — Trailing percent
(advisory)`, `Indicators — 3`. That's load-bearing for stops in particular, which used
to be permanently visible — a risk rule you can't see without clicking is worse than
one you can.

Inside, the indicator section lists **what you have added**, not what exists to add: one
collapsed row per configured instance, and a single picker to add another. An earlier
version gave every available indicator a permanent block with its own Add button, which
meant the section grew with the size of the plugin registry even when nothing was
configured — a sixth indicator type cost screen space before anyone used it. A type now
costs nothing until it's in play.

Each row's summary carries the colour swatch, the instance label, and where it's drawn,
which is enough to confirm a setup without expanding anything.

### The player chooses the pane

`paneKind` on the plugin is a **default, not a verdict**. Any instance can be moved
onto the main chart or into its own pane, which is legitimate precisely because the
contract already calls `paneKind` a rendering hint — the same indicator is consumed as
bare numbers by stop plugins, so it never depended on having a pane at all. Unset means
"whatever the plugin suggests", the same shape as `visuals.barStyle: 'theme'`.

The override is **presentation only**: the arithmetic, the warm-up, and the label are
identical either way. Otherwise "where do I draw this" would quietly become "what does
this compute".

One thing it can't change is the *scale*. An overlay is drawn on the price axis, so an
indicator whose values aren't prices — an RSI's 0–100 against a $250 chart — sits
squashed against the bottom. That's a real result rather than a bug, so the settings
screen warns instead of refusing: ATR is in price units and overlays perfectly
sensibly, and forbidding the case would cost that.

**Panes are capped** at three on a desktop and one in portrait, and the volume pane
takes one of them. Configuring more is allowed but the extras aren't drawn, so the
settings screen says so — a control that accepts input and discards it silently is
worse than one that refuses. The count uses the *resolved* pane kind, so moving an
indicator onto the main chart clears the warning, which makes it one of the ways to
fix it rather than a dead end.

## Two consumers: the chart, and stop plugins

An indicator is not only something to draw. **Any indicator in the registry
can also be consumed by a stop plugin** to compute its stop level — that's
how an ATR or chandelier stop gets written, and it works in both directions:
a user's custom indicator can feed a stop, and a user's custom stop can
consume the built-in Simple Moving Average. The contract above is unchanged;
a stop declares what it needs via `requires()` and the host does the
wiring. Full rules — including who owns the instance, why stop-owned
instances are deliberately *not* shared with displayed ones, and why `NaN`
warm-up must become `null` rather than a stop level — are in
[stops.md](./stops.md#using-indicators-inside-a-stop-plugin).

Two consequences for anything implementing this contract:

- **An indicator must be usable with no pane at all.** `paneKind` and
  `fixedRange` are rendering hints; a stop consuming an oscillator ignores
  both. Nothing in an indicator's computation may depend on being displayed.
- **The host, not the renderer, drives `onBar`.** Displayed indicators and
  stop-owned indicators are fed by the same per-bar mechanism in the same
  order, so a stop's values and the chart's values can never disagree about
  what bar N was.

## Overlay vs. oscillator — and normalization

This classification is what determines how an indicator's output gets
mapped to screen height, mirroring the normalization work already done for
poles (see [game-design.md](./game-design.md#pole-generation--scroll)):

- **Overlay** — shares the price scale with poles. Its raw price-level
  output must go through the *exact same* `priceTransform` +
  `normalizationMode` pipeline currently active for bars — including, for
  the relative modes, the same reference point. Skipping this would make an
  overlay line drift out of alignment with the poles it's supposed to sit
  on. Examples: moving averages, Bollinger/Donchian/Keltner/regression
  channels, pivots, chandelier stop.
- **Oscillator** — has its own scale, rendered in its own sub-pane below
  the main scroll area, with its **own independent normalization** —
  default visible-window min/max, or the plugin's declared `fixedRange`
  when it has one (e.g. `[0, 100]` for RSI). Same causality rule as poles:
  bounds come only from bars already played, never the full series (see
  [game-design.md](./game-design.md#why-full-series-normalization-leaks)).
  Examples: RSI, MACD, stochastics, CCI, Aroon, volatility measures,
  volume-based oscillators.
- Multi-output indicators (Bollinger's three bands, MACD's three lines)
  render every named output together, in whichever pane their `paneKind`
  specifies.

## Volume pane — built on the same mechanism

The "show volume on/off at the bottom" request is structurally identical
to an oscillator sub-pane: a histogram, its own scale, independently
normalized from whatever's on the price scale above it. Rather than a
bespoke volume system, volume is just a permanently-available oscillator
pane (always in the registry, can't be removed, only toggled) using the
same sub-pane renderer every other oscillator indicator uses. One renderer
serves both.

## Plugin loading & sandboxing

This host serves **both** indicator plugins and stop plugins
([stops.md](./stops.md)) — one plugin system, two contracts. Everything
below applies to both kinds.

This is the part that needs real care, because of the platform choices
already made in [tech-stack.md](./tech-stack.md): Tauri (desktop) and
Capacitor (mobile) both give the web view a bridge to native
capabilities (filesystem, shell, device APIs). A plugin system that lets
players load their own code must guarantee that code can **never** reach
that bridge, regardless of what the plugin author intended — treat this as
a hard requirement, not a nice-to-have, precisely because this app has
native capabilities a plain browser tab wouldn't.

- Run plugin code inside a **Web Worker** (no DOM, no bridge, no network,
  no filesystem) that receives bar data via `postMessage` and returns
  numeric outputs the same way. The worker is the entire trust boundary.
- Validate the loaded module's exported shape against the relevant contract
  before use, including that every declared `ParamSpec` is well-formed.
- Wrap every `onBar` call in a try/catch plus a per-call time budget;
  auto-disable (don't crash the run) a plugin that throws repeatedly or
  blows its budget.
- **Auto-disabling a *stop* plugin must notify the player explicitly**,
  unlike an indicator. A dead indicator just draws nothing; a dead stop
  silently removes risk protection mid-position. See
  [stops.md](./stops.md#sandboxing-and-hosting) — failing open on risk
  management without telling anyone is the worst available outcome.
- Loading surface: desktop (Tauri) can watch a real plugins folder on
  disk, read from the trusted host process, then handed into the worker
  sandbox. Mobile (Capacitor) more likely needs an in-app file-import
  flow, since arbitrary filesystem browsing is more restricted there.

## Initial built-in indicator

Ship with exactly one built-in to start, proving the contract end-to-end
before investing in more content:

| Indicator | Pane | Outputs |
|---|---|---|
| Simple Moving Average | overlay | 1 (single line — average close over the last `length` bars) |

More indicators (banded overlays, bounded oscillators, multi-output
indicators like a convergence/divergence-style pair with a histogram) are
natural next additions — each is just a new plugin against the contract
above, no engine changes required. Which ones to build next is left open;
prioritize by what players actually ask for once the core game is
playable, rather than front-loading a large indicator catalog before the
mechanics are proven.

One exception to "prioritize by demand": **ATR is the first indicator with a
second customer.** An ATR/volatility stop and a chandelier stop both need it
([stops.md](./stops.md#built-in-stop-plugins)), so building ATR unlocks two
stop strategies rather than one chart line. Worth knowing when picking the
second indicator, though still not a reason to build it before the mechanics
are proven.

## Config

See [config.md](./config.md#indicators--volume) for `indicators.active`,
`indicators.plugins.loaded`, and `volume.enabled`.

## Sequencing note

Build after the core loop, HUD ([hud.md](./hud.md)), visuals, and audio
are solid — same additive/no-engine-coupling argument as those systems.
The initial Simple Moving Average only needs close price, but this system
has one hard prerequisite the others don't: the bundled price data must
carry full OHLCV per bar, not just close, since the volume pane and most
indicators that follow will need it — see the note in
[data-sources.md](./data-sources.md). Confirm that shape before building
this, not after.
