# Candle Jumper — Planning Docs

Candle Jumper is a Flappy Bird–style side scroller with a twist: the poles
are driven by real daily stock prices, and the only inputs are **buy** and
**sell**. There's no death condition — the game is a trading-habit trainer
disguised as an arcade runner. The player scales in and out of a position
while poles (price data) scroll past, and is scored on realized P&L, not
survival.

## Doc index

| Doc | Covers |
|---|---|
| [game-design.md](./game-design.md) | Core loop, state machine, signed positions, shorting, order intent, tick pipeline, pole geometry, scoring |
| [stops.md](./stops.md) | Stop strategies as plugins — interface, timing, indicator use, built-ins |
| [controls.md](./controls.md) | Input bindings, run lifecycle, mobile layout, pause |
| [visuals.md](./visuals.md) | Parallax background system and visual themes |
| [character.md](./character.md) | Character roster, selection, position-size visualization |
| [audio.md](./audio.md) | Music, sonification, sound effects, audio themes |
| [hud.md](./hud.md) | Auto-scaling Y-axis, top HUD, sub-pane layout, screen wireframes |
| [indicators.md](./indicators.md) | Shared plugin host and types, indicator contract, sandboxing, volume pane |
| [game-feel.md](./game-feel.md) | Juice, session structure, arcade scoring, lookahead composition |
| [procedural-assets.md](./procedural-assets.md) | Runtime generation of all art and audio — no asset files |
| [accessibility.md](./accessibility.md) | Colorblind-safe P&L, motion, readability |
| [config.md](./config.md) | Every configurable parameter, consolidated |
| [data-sources.md](./data-sources.md) | Bar schema, `PriceSeriesSource`, the 644 bundled datasets and their manifest, downloading a ticker |
| [tech-stack.md](./tech-stack.md) | Platform, library, persistence, and testing choices |
| [code-structure.md](./code-structure.md) | Folder layout, import rules, where each roadmap step's code lands |
| [roadmap.md](./roadmap.md) | Build order / milestones |
| [packaging.md](./packaging.md) | Tauri and Capacitor: what's configured, what isn't, and the CSP that matters |
| [implementation-details.md](./implementation-details.md) | Decisions made while building that the design docs don't cover |

## Status

**All eleven roadmap steps are implemented**, with one exception: the native
shells are configured but never built, because Tauri needs a Rust toolchain and
Capacitor needs the Android SDK. See [packaging.md](./packaging.md) for what's
still missing. The [root README](../README.md) covers running, building, and the
controls.

Decisions taken while building — including several the docs left open, and
three places the import-zone lint rules caught a real architecture violation —
are logged in [implementation-details.md](./implementation-details.md).
Where that log and a design doc disagree, the doc wins.

Things deliberately deferred are listed at the bottom of
[roadmap.md](./roadmap.md) so they read as choices rather than gaps.
