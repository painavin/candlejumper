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
  comes from whichever `normalizationMode` is currently
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
  - Independently of all three: when `priceTransform` is `log10`, labels show
    the raw `log10` magnitude. The transform composes with any mode rather
    than being one ([config.md](./config.md#scroll--poles)), so it modifies
    the label unit whichever mode is active.
  - Surface which combination is active in the axis title/unit suffix
    so a player never misreads a `%` axis as a `$` axis.
- **Ease axis-bound changes**, don't snap every frame. This is
  **load-bearing, not cosmetic**: the default
  `visible-window-min-max` normalizer shifts its bounds as the window
  slides, so without easing every new extreme entering or leaving the
  window would snap the whole chart. See
  [game-design.md](./game-design.md#why-full-series-normalization-leaks).

## Top HUD

- **Score**: running realized P&L in both currency and percent return — the
  primary readout, from
  [game-design.md](./game-design.md#scoring--stats).
- **Position**: current signed size, average cost basis, unrealized P&L
  (mark the current pole's price against avg cost), and **open unit count**
  while Active. Direction is shown explicitly (LONG / SHORT), not just by
  sign. Unit count matters because it's exactly how many exit presses remain
  to flat ([game-design.md](./game-design.md#order-intent-matrix)).
- **Buying power remaining**, since entries clamp against it and a silent
  clamp is confusing without a visible cause.
- **Streak meter**: the discipline-streak gauge from
  [game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-the-discipline-streak)
  — **five pips**, filling one per compliant close event and emptying on a
  reset. It measures rule compliance, not profitability, so it has three
  display states and the difference between them matters:
  - **Live** (an advisory stop is active) — pips fill and empty as normal.
  - **Automated** (only enforcing stops active) — the streak can't be lost,
    so label it as automated rather than drawing a permanently full gauge. A
    full bar the player didn't earn is worse than no bar.
  - **Dormant** (no stop active) — no rule to measure; show it greyed with
    the multiplier pinned at ×1, so the absence reads as a consequence of the
    player's own config rather than a bug.

  This needs **reserved space from step 3**, even though the gauge itself
  goes live at step 4 with stops — the mobile layout is tight enough that
  finding room afterwards would mean re-laying-out the whole bar. On mobile
  it collapses to a compact multiplier chip (`×3`) with a thin progress
  underline rather than a full-width gauge.
- **Arcade score** beside raw P&L, never instead of it
  ([game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-the-discipline-streak)).
  Raw realized P&L stays the primary readout.
- **Active stop levels**, for each active stop plugin — shown both as a HUD
  number *and* as a horizontal line on the chart at that price, so the
  player can watch it approach rather than only read a number.
  **Enforcing stops draw solid; advisory stops draw dashed**
  ([stops.md](./stops.md#advisory-mode)) — the player must never be unsure
  whether a line will actually save them. Label lines with the owning
  plugin when more than one is active
  ([stops.md](./stops.md#multiple-active-stops)).
- **Session info**: ticker/symbol, current in-series date, and progress
  through the series.

## Screen layout

Composed wireframes for both orientations, resolving the layout conflicts
that the individual specs above couldn't reveal on their own. This is the
artifact [roadmap.md](./roadmap.md) step 0a calls for.

### Landscape / desktop

```
┌──────────────────────────────────────────────────────────────────┐
│ P&L +$1,240 (+12.4%)   LONG 8.4sh @ 218.30  ▲+$92   BP $2,000   │ top HUD
│ ×3 ▓▓▓░░ 4,180  stop 214.10 (trailing-5%)  AAPL  2025-03-14 ⅓   │
├──────────────────────────────────────────────────────────┬───────┤
│                                              ▐▌          │  ░░▒▓ │
│                    ▐▌            ▐▌  ▐▌      ▐▌ 🐦       │  ░░▒▓ │─ 240
│         ▐▌      ▐▌ ▐▌   ▐▌    ▐▌ ▐▌  ▐▌   ▐▌ ▐▌ ▐▌       │  ░░▒▓ │
│  ▐▌  ▐▌ ▐▌ ▐▌   ▐▌ ▐▌   ▐▌ ▐▌ ▐▌ ▐▌  ▐▌   ▐▌ ▐▌ ▐▌       │  ░░▒▓ │─ 220
│- - - - - - - - - - - - - - - - - - - - - - - - - - - - - │- - - -│  stop line
│  ▐▌  ▐▌ ▐▌ ▐▌   ▐▌ ▐▌   ▐▌ ▐▌ ▐▌ ▐▌  ▐▌   ▐▌ ▐▌ ▐▌       │  ░░▒▓ │─ 200
│▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│▀▀▀▀▀▀▀│  main chart 60%
├──────────────────────────────────────────────────────────┼───────┤
│ ▁▃▂▅▃▁▂▄▆▃▂▁▃▅▂▁▄▃▂▅▃▁▂▄▃▂▁▃▄▂▁▃▅▄▂▁▂▃▅▃▂▁▃▄▂▁▃▂▄▃      │  ░░▒▓ │  volume 40%
└──────────────────────────────────────────────────────────┴───────┘
  ◄──────────── playfield (poles) ~75% ────────────────────►  fog 25%
                                                              + Y axis
```

### Portrait / mobile

The tight case. Resolutions forced by composing it:

```
┌───────────────────────────────┐
│ +$1,240 (+12.4%)     ×3 ▓▓▓░░ │ top HUD — 2 lines max,
│ LONG 8.4sh @218.30  stop 214  │ streak as a chip
├────────────────────────┬──────┤
│              ▐▌        │ ░░▒▓ │
│      ▐▌  ▐▌  ▐▌ 🐦     │ ░░▒▓ │─ 240
│  ▐▌  ▐▌  ▐▌  ▐▌ ▐▌     │ ░░▒▓ │
│- - - - - - - - - - - - │- - - │─ 220  stop
│  ▐▌  ▐▌  ▐▌  ▐▌ ▐▌     │ ░░▒▓ │
│▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│▀▀▀▀▀▀│  main chart
├────────────────────────┼──────┤
│ ▁▃▂▅▃▁▂▄▆▃▂▁▃▅▂▁▄▃▂▅   │ ░░▒▓ │  max 1 sub-pane
├───────────────────────────────┤
│                               │
│   ┌────────┐     ┌────────┐   │  control strip —
│   │  SELL  │     │  BUY   │   │  reserved BEFORE
│   └────────┘     └────────┘   │  sub-panes
└───────────────────────────────┘
```

Conflicts the wireframe surfaced, and their resolutions:

- **`visibleBarCount: 60` is a landscape number.** At portrait width, 60
  poles are ~4px wide and unreadable. Portrait must reduce it (~25–30) —
  which means `visibleBarCount` needs an orientation-aware default rather
  than a single value, and the normalizer window changes with it. It is
  resolved **once at run start and frozen**, so rotating mid-run re-lays out
  pixel geometry without rescaling the chart or moving the run to a different
  personal-best bucket ([config.md](./config.md#scroll--poles)).
- **The top HUD needs two lines in portrait**, and there isn't room for
  buying power plus session info plus the streak gauge and the arcade score.
  Streak collapses to a chip; buying power, arcade score, and full session
  info move to the pause screen. Raw P&L never moves — it's the primary
  readout in every orientation.
- **The control strip must be allocated before sub-panes**, as
  [controls.md](./controls.md#mobile-layout-constraints) already required —
  the wireframe confirms that with 1 sub-pane and a thumb strip, the main
  chart is close to its floor.
- **The Y axis overlays the fog strip** in both orientations, which is fine
  since it's a HUD layer — but it means the fog strip can't be narrower than
  the axis labels need.

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
