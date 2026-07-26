# HUD & Chart Axes

## Goal

Everything that's always on screen and isn't part of the game world
itself: the price axis and the top status readout. Both need to keep
updating continuously as poles scroll, not just at trade events — a
static axis or a HUD that only refreshes on buy/sell would make the chart
read as broken.

## Y-axis (auto-scaling price axis)

- **Placement**: right edge — matches the convention of real charting
  tools/terminals, where the newest data enters on the right and the
  player's eye is already there. It renders as a HUD overlay *above* the
  leading-edge fog strip
  ([game-feel.md](./game-feel.md#new-composition--the-lookahead-problem)),
  so the axis stays fully legible even though the world behind it is
  obscured.
- **Recompute every tick**, not just on trade events: the visible min/max
  comes from whichever `poleHeightNormalization` method is currently
  active, over the currently visible window. The axis is literally the
  inverse of the active normalizer — not a separate system — so it always
  agrees with how poles are actually being drawn. See
  [game-design.md](./game-design.md#pole-generation--scroll) and
  [config.md](./config.md#scroll--poles).
- **Label semantics depend on the active normalization mode**:
  - Level-preserving modes (`visible-window-min-max`,
    `fixed-price-per-pixel`) → literal `$` price labels.
  - `starting-price-relative` → "% of reference" labels, since the values
    are ratios, not price levels.
  - `log-price` → raw `log10` magnitude.
  - Surface which one is active somewhere in the axis title/unit suffix
    so a player never misreads a `%` axis as a `$` axis.
- **Ease axis-bound changes**, don't snap every frame. This is
  **load-bearing, not cosmetic**: the default
  `visible-window-min-max` normalizer shifts its bounds as the window
  slides, so without easing every new extreme entering or leaving the
  window would snap the whole chart. See
  [game-design.md](./game-design.md#why-full-series-normalization-leaks).

## Top HUD

- **Score**: running realized P&L — the primary readout, from
  [game-design.md](./game-design.md#scoring--stats).
- **Position**: current size, average cost basis, and unrealized P&L
  (mark the current pole's price against avg cost) while Active.
- **Risk levels**: stop-loss/trailing-stop level, if enabled — shown both
  as a HUD number *and* as a horizontal line drawn directly on the chart
  at that price level, so the player can watch it approach rather than
  only read a number. See
  [game-design.md](./game-design.md#risk-management).
- **Session info**: ticker/symbol, date range, current in-series date.

## Volume & indicator sub-panes

Their content and normalization are defined in
[indicators.md](./indicators.md), which specifies a single sub-pane
mechanism serving both the volume on/off toggle and any oscillator-type
indicator. How they divide vertical space is specified in
[Sub-pane vertical layout](#sub-pane-vertical-layout) below.

## Sub-pane vertical layout

Volume and oscillator indicators each get their own sub-pane below the main
chart ([indicators.md](./indicators.md)). Vertical space is allocated
top-down so gameplay never gets squeezed by a stack of analytics:

1. **Top HUD** — fixed height.
2. **Mobile control strip** (mobile only) — reserved *before* sub-panes, so
   thumb buttons never overlap a pane. See
   [controls.md](./controls.md#mobile-layout-constraints).
3. Whatever height remains after those two is the **chart area**. It splits
   by a single rule: **sub-panes share 40% of it, divided equally among
   however many are enabled; the main chart keeps the other 60%.** With no
   sub-panes enabled, the main chart takes all 100%.

One rule rather than two avoids the "guaranteed minimum vs. percentage
budget" ambiguity — the main chart's 60% floor *is* the budget's complement,
so the two can't disagree.

- **Cap concurrent sub-panes at 3** (volume plus two oscillators). Beyond
  that each pane is too short to read anything from, so additional
  enabled oscillators queue rather than shrink the set further — surface
  this in the settings UI rather than silently ignoring a selection.
- On mobile, drop the cap to **1** sub-pane. There isn't the vertical room
  for more, and the alternative is three unreadable slivers.
- Panes share the main chart's X axis and scroll in lockstep with it —
  a pane that scrolls independently of the poles above it is worse than no
  pane.

## Sequencing note

Basic Y-axis and the P&L/position readout should land as early as roadmap
step 1/3 — the chart is close to unreadable without them, so treat these
as core-loop, not later polish. The stop-level chart line arrives with
step 4 (once stops exist); volume/indicator sub-panes come later, step 8.
