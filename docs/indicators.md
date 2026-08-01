# Indicators & Plugin Architecture

## Goal

Let players overlay technical indicators on the chart, and — beyond a
small built-in set — load their own custom indicator code. This is our
own plugin architecture, designed for Candle Jumper specifically; it
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
  min/max/step/unit rather than leaving validation to the plugin. `min` and `max`
  are *required* for `int`/`float`/`percent` and enforced by the plugin validator,
  which is what lets the control trust them without inventing defaults.
- **Numeric params render as typed fields, not sliders.** These are exact
  quantities — a length of 200, a factor of 2.5 — and dragging across a 2–200 range
  is a pixel-hunt that lands wherever the pointer happened to be. The sliders worth
  keeping are volume and scroll speed, where the number is meaningless and the feel
  is the point.

  A text field can hold something invalid, which a slider can't, so three rules
  apply. It **commits on blur or Enter, never per keystroke** — with `min: 2`,
  clamping as you type turns `20` into `2` the moment the first key lands, and that
  single rule is what makes a bounded field usable. Out-of-range values **clamp**,
  which is deliberately the opposite of the persistence rule in
  [config.md](./config.md#persistence): that reads *stored* data where an impossible
  value is evidence of corruption, whereas a person typing 500 into a field capped
  at 200 is expressing intent. Unparseable input **reverts** to the previous value.
- **`labelParams` narrows an instance label.** Appending every param stops scaling
  around four: a five-param indicator labels itself `GBAP 20 3 7 2 5`, which is a
  row of digits rather than a legend. Naming the one or two a player distinguishes
  instances by keeps the legend readable while the settings row still shows all of
  them. Unset means all, so `MACD 12 26 9` is unaffected.

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
  /** Which params appear in the legend label. Unset means all of them. */
  labelParams?: string[]
  /** Other indicators this one is built from. Omit if none. */
  requires?(params: Record<string, number>): IndicatorRequest[]
  /** How each output is drawn, by default — the player can override both fields. */
  outputStyles?: Record<
    string,
    { draw?: 'none' | 'line' | 'dots' | 'dash'; colour?: number; offsetPx?: number }
  >
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
   *
   * `indicators` holds this bar's values from whatever `requires()` asked
   * for, keyed by request key then output name. Empty for an indicator
   * that requires nothing, which can simply omit the parameter.
   */
  onBar(
    bar: OhlcvBar,
    isLastBar: boolean,
    indicators: Record<string, Record<string, number>>
  ): Record<string, number>
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
- **Each instance carries a base colour**, and each of its *outputs* resolves a
  colour of its own from it. Per instance rather than derived from list position:
  otherwise removing one indicator recolours every line below it, and a player who
  learned "the teal one is the 200" has to relearn it. A new instance is assigned
  the first unused palette colour — deterministic, wrapping when there are more
  instances than colours, and reusing a freed colour rather than marching on.

  Colour is chosen **per output**, from a named list plus a free picker. This is a
  revision of an earlier decision to offer a fixed list only, and of a later one to
  offer a single picker per instance. The original reasoning still holds: an
  arbitrary hex lets a player choose something that vanishes into the sky, or a red
  that reads as a losing bar. What neither earlier design survived is an indicator
  with several outputs at once — one control for a five-output composite can't say
  which of them it is colouring, and the settings row then describes a chart the
  player isn't looking at.

  The names come first, in a select, because each is sayable — a swatch alone
  conveys nothing to a screen reader, and "the third orange square" isn't a choice a
  colourblind player can make. "Custom…" reveals the picker for what eight names
  can't express, and stores the colour it was already showing, so opening it never
  changes the chart on its own. `describeColourRisk` reports the two original
  failure modes rather than preventing them, per output: a warning respects a
  deliberate choice where a refusal wouldn't, and it's measured against the P&L pair
  the player has actually selected.

  **Two presets fail that check.** `Sky` is byte-identical to `blue-orange`'s up
  colour and `Orange` to its down colour, so both warn when the colourblind-safe
  palette is selected — which is the setting where mistaking a line for a bar
  matters most. The test that was meant to catch this skipped exact matches before
  measuring distance, so it passed while asserting the opposite. Now asserted as a
  known defect; fixing it means changing two shipped colours.
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
"whatever the plugin suggests".

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

## Composing indicators

An indicator may be built from other indicators, declared exactly the way a stop
declares them:

```ts
requires(params) {
  return [
    { key: 'breakout', indicatorId: 'breakout', params: { length: params.breakoutLength } },
    { key: 'atr',      indicatorId: 'atr',      params: { length: params.atrLength } },
  ]
}
```

The host resolves that once, before the first bar, and hands the values to `onBar` as
its third argument. The alternative was inlining each part — fewer lines for the first
composite, then a second and third copy of the same formula for every later one, each
free to be subtly wrong on its own. Sharing bar-level maths is already the precedent
here, and an ATR that disagrees with the ATR a stop is using would be the worst kind of
bug: invisible, and about risk.

Four rules make it safe:

- **Depth-first, within the same bar.** Every dependency sees a bar before the
  indicator that asked for it, so a composite reads *this* bar's values rather than
  last bar's. An off-by-one bar in a breakout signal is not a rounding error; it's a
  different signal.
- **Nobody shares an instance.** Each request gets its own, the same rule a
  stop-owned indicator already follows — otherwise toggling a chart overlay could move
  a live stop level.
- **Cycles are refused at resolution time**, naming the whole path. This is the one
  hazard the feature introduces: while only stops could declare `requires()`, the graph
  was acyclic by construction. Two branches may both use `atr`; a single *path* may not
  revisit an id. Chains deeper than eight are refused too — a cost worth rejecting where
  the message can name the chain rather than at frame time where it just feels slow.
- **A warming dependency propagates as `NaN`, never as a number.** A composite that
  substitutes zero for an input that isn't ready reports a signal it hasn't measured.

Only the root's outputs are drawn. A composite's inputs are its own business, and
drawing them would put lines on the chart the player never asked for — including,
for a price-scale overlay, an ATR sitting flat near zero underneath the bars.

**Not yet true for sandboxed plugins.** A composite loaded from a file has its
`requires()` reported in its descriptor but not resolved, so it receives empty values
and — following the rule above — draws nothing. This is the same gap sandboxed *stops*
have, and the reason both are gaps is that resolution has to happen where the registry
lives. Built-in composites go through the in-process host and are unaffected.

## Drawing several outputs of one instance

An instance's outputs are not all the same kind of thing, so each one carries a draw
style — the plugin's suggestion, which the player can override:

```ts
outputStyles: {
  breakout: { draw: 'dots', colour: 0x4fd6c8, offsetPx: 10 },
  retrace:  { draw: 'dash' },
  stop:     { draw: 'dots' },
}
```

`draw` is one of:

| Mode | Reads as | For |
|---|---|---|
| `line` | joins consecutive values | a continuous level. The default |
| `dash` | a broken line | a level that's context rather than something acted on |
| `dots` | one mark per bar that has a value | an event on a scattered handful of bars |
| `none` | computed, not drawn | an output that exists for a *stop* to consume |

A sparse output drawn as a line would join four marks out of two hundred bars with
three long diagonals across unrelated price action, reading as a trend nothing
measured. The legend swatch follows the same style — a bar, two short bars, or a mark —
so the one place a player looks to decode the chart doesn't imply every output is a
line.

`offsetPx` lifts a mark clear of the candle, and is **only** for marks that flag a bar
rather than name a price. A breakout mark is drawn at the bar's high because that's out
of the way, so its exact y is arbitrary and moving it costs nothing; a stop level drawn
a few pixels up would be a lie about where the stop is. Pixels rather than price, since
a price offset would buy different clearance on every ticker.

### The player has the final say

Every field above is a **default**. The settings row lists one line per output —
`stop | [Dots ▾] | [Teal ▾]` — writing overrides into
`indicators.active[].outputs` ([config.md](./config.md#indicators--volume)). Three
rules keep that honest:

- **Overrides are sparse.** An entry appears only where the player changed something, so
  a plugin that later improves its own defaults improves them for everyone who never
  touched that output.
- **`none` is the hide control.** There's deliberately no separate visibility flag: "not
  drawn" is a drawing style, and a second mechanism for one state is how the two end up
  contradicting each other. A hidden output is dropped from the legend too, and from a
  pane's own min/max — an invisible outlier stretching the scale would squash everything
  else into a band.
- **Colour resolves override → plugin → instance.** The plugin sets a colour only where
  the output's meaning fixes it; anything it leaves alone inherits the instance's base
  colour, which is what stops a five-output composite ignoring the player's choice
  entirely. Resolution happens once, in `plugins/host/indicatorFeed.ts`, because a
  second resolution is how a line and its legend entry come out different colours.

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

## Built-in indicators

The set that ships. It started as exactly one — a moving average, to prove the contract
end to end before investing in content — and each addition since has been made to
unlock something rather than to lengthen a catalogue:

| Indicator | Pane | Outputs | Built for |
|---|---|---|---|
| Simple Moving Average | overlay | `sma` | proving the contract end to end |
| Average True Range | oscillator | `atr` | the first indicator with a *second* customer: an ATR stop and a chandelier stop both need it, so it unlocks two stop strategies rather than one line |
| Price Breakout | overlay | `level`, `signal` | the input to a family of breakout signals; usable alone, since the level is the resistance a trader is watching |
| Gap-up Breakout ATR Pullback | overlay | `breakout`, `gapup`, `retrace`, `stop`, `retraceHit` | the first *composite* — five params, four sparse-or-continuous outputs, and built from two other indicators |

Notes on the last two, since they're the ones with decisions in them:

- **Breakout measures closing prices, not highs.** A single intrabar spike prints a
  high nobody traded at for more than a moment; a high-based window puts the level
  somewhere the market never accepted and then refuses to signal until price exceeds
  it. Warm-up matters here more than usual: without it, bar one is trivially the
  highest close so far and every early bar marks a breakout.
- **The composite's gap rule reads the bars' own timestamps.** A gap can only form
  while the market is shut, so a bar is gappable only when it's separated from the
  previous one by an overnight-or-longer break (twelve hours to five days). One rule,
  three right answers: daily bars always qualify, intraday bars qualify only for the
  first bar of a session — which is exactly where an intraday gap lives — and weekly or
  monthly bars never do, because the difference between two monthly closes is a
  quarter's return, not a gap.
- **It deviates from the strategy it was ported from, deliberately.** The original ran
  two trades in parallel with a second retrace/stop pair at a wider ATR factor; one
  signal a player can read beats two that differ by a multiplier they can't see, and the
  second pair's interactions with the first were bookkeeping rather than strategy.
  Scanner-only outputs (volatility ratio, position risk) are dropped too — nothing here
  sorts anything. `retraceHit` is *kept*, and is the signal the indicator is named for:
  the bar whose low first reaches the tolerated level is the entry it exists to find.

More indicators (banded overlays, bounded oscillators, multi-output indicators like a
convergence/divergence-style pair with a histogram) are natural next additions — each is
just a new plugin against the contract above, no engine changes required. Prioritize by
what players actually ask for once the core game is playable, rather than front-loading
a large catalogue before the mechanics are proven.

## Config

See [config.md](./config.md#indicators--volume) for `indicators.active` and
`volume.enabled`.

There is deliberately no `indicators.plugins.loaded` list. It was specified once
as "file path on desktop, imported blob on mobile" and was never implementable: a
browser cannot re-read a file the player picked last week, and mobile has no
stable path either. Imported plugins persist as **source text** under their own
storage key, so a list of references in the config would only ever have been a
second, always-stale record of the same thing.

## Sequencing note

Build after the core loop, HUD ([hud.md](./hud.md)), visuals, and audio
are solid — same additive/no-engine-coupling argument as those systems.
The initial Simple Moving Average only needs close price, but this system
has one hard prerequisite the others don't: the bundled price data must
carry full OHLCV per bar, not just close, since the volume pane and most
indicators that follow will need it — see the note in
[data-sources.md](./data-sources.md). Confirm that shape before building
this, not after.
