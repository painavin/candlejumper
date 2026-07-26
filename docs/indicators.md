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

## TypeScript indicator contract

```ts
interface IndicatorPlugin {
  id: string
  displayName: string
  paneKind: 'overlay' | 'oscillator'
  outputs: string[]              // named output series, e.g. ['macd', 'signal', 'histogram']
  params: ParamSpec[]            // e.g. length, deviationFactor — surfaced in the settings UI
  createInstance(params: Record<string, number>): IndicatorInstance
}

interface IndicatorInstance {
  reset(): void
  onBar(bar: OhlcvBar, isLastBar: boolean): Record<string, number>
}
```

Built-ins and user plugins are both just objects matching
`IndicatorPlugin`. There is no separate "official indicator" code path.

## Overlay vs. oscillator — and normalization

This classification is what determines how an indicator's output gets
mapped to screen height, mirroring the normalization work already done for
poles (see [game-design.md](./game-design.md#pole-generation--scroll)):

- **Overlay** — shares the price scale with poles. Its raw price-level
  output must go through the *exact same* `poleHeightNormalization`
  transform currently active for bars — including, for the `*-relative`
  methods, the same reference point (last close, first close, etc.).
  Skipping this would make an overlay line drift out of alignment with the
  poles it's supposed to sit on. Examples: moving averages, Bollinger/
  Donchian/Keltner/regression channels, pivots, chandelier stop.
- **Oscillator** — has its own scale, rendered in its own sub-pane below
  the main scroll area, with its **own independent normalization** —
  default visible-window min/max, or a fixed range when the indicator
  defines one (e.g. RSI is always 0–100). Same causality rule as poles:
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
- Validate the loaded module's exported shape against the
  `IndicatorPlugin` contract before use.
- Wrap every `onBar` call in a try/catch plus a per-call time budget;
  auto-disable (don't crash the run) a plugin that throws repeatedly or
  blows its budget.
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
