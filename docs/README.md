# Candle Runner — Planning Docs

Candle Runner is a Flappy Bird–style side scroller with a twist: the poles
are driven by real daily stock prices, and the only inputs are **buy** and
**sell**. There's no death condition — the game is a trading-habit trainer
disguised as an arcade runner. The player scales in and out of a position
while poles (price data) scroll past, and is scored on realized P&L, not
survival.

## Doc index

| Doc | Covers |
|---|---|
| [game-design.md](./game-design.md) | Core loop, state machine, trading engine, shorting, risk management, pole geometry, scoring |
| [controls.md](./controls.md) | Input bindings, mobile layout, pause |
| [visuals.md](./visuals.md) | Parallax background system and visual themes |
| [character.md](./character.md) | Character roster, selection, position-size visualization |
| [audio.md](./audio.md) | Music, sonification, sound effects, audio themes |
| [hud.md](./hud.md) | Auto-scaling Y-axis, top HUD, sub-pane layout |
| [indicators.md](./indicators.md) | Indicator plugin architecture, sandboxing, volume pane |
| [game-feel.md](./game-feel.md) | Juice, session structure, arcade scoring, lookahead composition |
| [procedural-assets.md](./procedural-assets.md) | Runtime generation of all art and audio — no asset files |
| [accessibility.md](./accessibility.md) | Colorblind-safe P&L, motion, readability |
| [config.md](./config.md) | Every configurable parameter, consolidated |
| [data-sources.md](./data-sources.md) | Price data sourcing and the `PriceSeriesSource` interface |
| [tech-stack.md](./tech-stack.md) | Platform, library, persistence, and testing choices |
| [roadmap.md](./roadmap.md) | Build order / milestones |
| [review-findings.md](./review-findings.md) | Implementation readiness review — blocking gaps and notable issues |

## Status

Design phase complete — all open questions resolved. No code written yet.
Start at [roadmap.md](./roadmap.md) step 0 (scaffolding); each step links
to the doc carrying its decisions and rationale.

Things deliberately deferred are listed at the bottom of
[roadmap.md](./roadmap.md) so they read as choices rather than gaps.
