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
  player's eye is already there. It renders as a HUD overlay in the strip
  right of the character
  ([game-feel.md](./game-feel.md#new-composition--the-lookahead-problem)),
  on its own plate so it stays legible over whatever is behind it.
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
- **Active stop levels**, drawn as a **hedgehog riding the level** rather than
  a line across the chart. The marker sits in the empty strip right of the
  character, so the vertical gap between bird and hedgehog *is* the risk being
  carried — readable without reading a number, and it visibly closes as a
  trailing stop ratchets. A short dashed leader reaches a few bar widths to its
  left, which is the part of a full-width line worth keeping: comparing the
  newest candles against the level.

  **Enforcing draws solid; advisory draws as a ghost** — the same rig at low
  alpha ([stops.md](./stops.md#advisory-mode)). The player must never be unsure
  whether a level will actually save them, which is why the difference is fill
  versus outline rather than a shade. A breached advisory level *tints* rather
  than changing shape: recolouring says "attend to this", where a new silhouette
  would say "this is now enforcing", which would be a lie.

  The marker moves on two events only. A **ratchet** — the level moving in the
  position's favour, which is direction-aware, up for a long and down for a
  short — gets one hop. A **stop-out** gets a curl, spines tucking in. Neither
  fires per bar, because a trailing stop moves a little on most of them and a
  gesture per change is a twitch. Both are suppressed under `reducedMotion`,
  where the state still reads through colour.

  At most **two markers**, enforcing first: if only one fits it must never be
  the advisory one, since not seeing the level that will eject you is worse than
  not seeing one you were merely asked to respect.

  The level's **number is on the price axis**, as a tag at that height, because
  that is where every other price already lives and the axis already draws its
  gridlines the full width — so the tag restores the horizontal reference
  without a line. A gridline label yields when a tag would land on it: two
  prices overlapping on a 62px plate is an unreadable smear, and the one the
  player is actively watching wins.

  The **owning plugin is named in the streak plate**, which already reads
  `no stop rule` when dormant and so is the readout that answers "what is
  protecting me". Landscape only — the plate is measured from its text, and a
  plugin id on a 360px phone would push the meter off the edge
  ([stops.md](./stops.md#multiple-active-stops)).
- **Session info**: ticker/symbol, current in-series date, progress
  through the series, and the scroll speed in force. Speed is here because
  the player can change it mid-run
  ([controls.md](./controls.md#scroll-speed-while-playing)) and a control
  with no readout leaves them guessing what they're on. It's read off the
  frame rather than from config, or it would keep showing the speed the run
  started at. A transient toast was the alternative and is worse: you can't
  check your current speed by pressing nothing.

### Panels

Readouts sit on **bordered, translucent plates** rather than directly on the
scene, and are grouped into three:

| Plate | Contents | Why grouped |
|---|---|---|
| Primary (top left) | P&L headline over the position line | One reading — "what am I holding and what is it doing". Two plates would imply they answer different questions. |
| Streak | Multiplier, arcade score, pips | Measures rule compliance, not money, so it's deliberately not inside the P&L plate. |
| Context (top right) | Buying power, ticker/date/progress/speed | Read occasionally rather than continuously, so it lives at the opposite edge and stays out of the way. Speed joins the note row rather than getting a plate of its own — it's checked, not watched. |

The axis gutter and each indicator sub-pane get the same treatment, so the
whole HUD reads as one instrument cluster rather than the top band alone.

**The volume histogram is coloured bar by bar**, each one taking the same muted
colour as its own candle's high–low range. That's what turns the pane from a
shape into information: "heavy selling" and "heavy buying" are the same *height*
and a single-colour histogram can't tell them apart.

The fill is a **darker** version of that range colour, not the same value. The
range colour is tuned to read against the *sky*, which is what a candle sits on; a
histogram bar sits on a pane plate, and that plate is far closer in lightness —
`jolly`'s works out around 0.46 luma against a muted green range near 0.40, so the
bars came out barely distinguishable from their own background. The extra dimming
is applied for the histogram only: the wicks read correctly where they are, and
darkening them to fix the pane would break what already worked.

The mechanism keeps the split the rest of the chart uses — the engine reports a
**direction** per point and the renderer decides the colour, deriving it from
the *same* function that colours a candle's range. So a volume bar comes out the
exact shade of the candle above it by construction; matching two hard-coded
colours by hand would drift the first time either changed. `BarDirection` is
computed once, in playback, from the raw prices, and the candle body, the candle
range, and the volume bar all read that one field.

Only price-derived series get per-point directions. A moving average is a level
and has no direction to report, so it keeps its single player-chosen colour.

**Every pane carries its own scale band**, aligned with the price axis above
it and labelled in the pane's own units — three labels (top, middle, bottom),
which is the minimum that conveys a *scale* rather than just a ceiling. The
bounds used to be crammed into the pane title instead, which told you the range
without telling you where in it any given bar sat.

**Nothing below the ground line is world.** The ground fill stops where the
sub-panes begin rather than running to the bottom of the viewport. It used to
run the whole way, *behind* the translucent pane plates, so the grass showed
through and tinted the volume histogram green — which read as a deliberate
colour choice rather than a bug. Below the ground line is instrument territory;
a data pane must never sit on scenery.

Three properties this relies on:

- **Plates are measured from their contents, not fixed.** Which means all
  text and all font sizes must be settled *before* any box is measured.
  Laying out as we go would fit a plate to the previous frame's numbers,
  which shows up as a border that jitters by a character width whenever a
  value crosses a digit.
- **Consequence: `TOP_HUD_HEIGHT` and the HUD type sizes have to change
  together.** Growing a font grows the band, and the reserved height has to
  cover it.
- **Portrait reserves a *taller* band than landscape**, which looks backwards
  and isn't: at phone width the streak plate can't fit beside the primary one,
  so it wraps to a second row. Portrait economises on type size instead.
  Whether it wraps is decided by *measuring the fit*, not by branching on
  orientation — it's the window width that determines it, not which way the
  phone is turned.

Plates are translucent for the same reason the menus are: attract mode is
playing behind them, and hiding the thing you're advertising defeats the
point. Fill and border come from `accent.outline` and `accent.axisLine`, so a
plate matches the gridlines it sits above rather than introducing a third
greyscale. See [accessibility.md](./accessibility.md#readability) for why
outlined glyphs are the other half of this.

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
  ◄──────────── playfield (bars) ~75% ─────────────────────►  open 25%
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
- **The Y axis sits in the strip right of the character** in both
  orientations, which is fine since it's a HUD layer — but it means that strip
  can't be narrower than the axis labels need.

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
