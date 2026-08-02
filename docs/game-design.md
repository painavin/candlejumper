# Game Design

## Core concept

An endless side scroller. A day's price data scrolls past at a configurable
speed, drawn as a **floating candle**: a coloured body spanning the open to
the close, with the high–low range behind it. There is no fail/death
condition tied to platforming — the run ends only when the price data runs
out or the player chooses to stop. The goal is to train pattern recognition
and trading discipline; the game keeps score via realized P&L and trading
stats, not lives.

Bars float rather than standing on the ground, which they did in the first
version. A column rising from a baseline can only express **one** number, so
it drew the close and silently discarded the open, high, and low — three
quarters of every bar, all of it already in the data. A trainer whose chart
can't show a bar's range is teaching from a chart the player will never see
again the moment they open a real terminal. See
[Candle geometry](#candle-geometry).

## State machine

Three states:

- **Waiting** — no open position (size == 0). Bars still scroll past, but
  the character stays grounded and ignores them.
- **Active** — position open (size != 0). Character auto-bounces along the
  **closing line** — each bar's close: **above it when long, suspended
  beneath it when short**, so position direction is readable at a glance
  without looking at the HUD. Because bars float there is no solid surface
  underfoot; the character rides the price it actually fills at, which is
  the only line it could stand on without lying about something.
  Buy presses move size up, sell presses move it down.
- **Stopped-out** — a transient state entered when a configured stop
  loss / trailing stop triggers. The engine auto-closes the full position
  (same code path as a manual close), then returns to Waiting. This should
  look and sound distinct from a manual exit (see [audio.md](./audio.md))
  so the player feels the difference between a deliberate exit and a
  triggered one.

Transitions: `Waiting --buy--> Active` (long), `Waiting --sell--> Active`
(short, only when `allowShorting` is on), `Active --size reaches 0-->
Waiting`, `Active --stop triggered--> Stopped-out --> Waiting`. Scaling
in/out while already Active doesn't change state, only size and cost basis.

## Trading engine

- **Capital**: the player starts each run with a **cash balance** (default
  $10,000, configurable). Buy presses deploy cash; position size is
  therefore bounded by available buying power rather than unlimited.
  `cashBalance` moves with realized P&L — profits raise it, losses lower it —
  but buying power is capped at `startingCapital` so profits never compound.
  The formula and why it has both halves are in
  [Short account model](#short-account-model); it applies to long-only runs
  just as much.
- **Fill price**: a buy or sell executes at the **close of the pole the
  character is currently standing on**. That price is already visible on
  screen when the player presses, so a fill is never a gotcha, and the
  original "sell price minus buy price" arithmetic holds exactly.
  (Considered and rejected: filling at the *next* bar's close, which is
  more realistic — a real order can't fill at a price you've already
  seen — but puts the fill price on a bar that hasn't been played yet and
  delays feedback.)
- **Position size is signed**: positive = long, negative = short, zero =
  flat. See [Shorting](#shorting) below — the engine handles both
  directions from day one even though the default game mode is long-only.
- **The unit of position size is fractional shares**, but presses are
  counted in **units**. Each entry press adds one unit; each exit press
  removes one. The engine tracks both `shares` (signed, fractional) and
  `unitCount` (how many entry presses are currently open), and an exit
  closes `shares / unitCount` — i.e. an equal share of what remains.
  - With 5 units open, successive exits close 1/5, then 1/4 of the
    remainder, then 1/3, 1/2, and 1/1 — **reaching exactly flat on the
    fifth press.**
  - This is deliberate. A naive "close 25% of the remaining position"
    decays geometrically and *never* closes: 4 presses leaves 31.6%, and
    reaching a `1e-6` flat threshold takes 49 presses. Unit-symmetric
    exits make N entries take exactly N exits.
  - It also makes the ghost stack in
    [character.md](./character.md#position-size-visualization) literal —
    one ghost per open unit, added and removed one per press.
  - **Units need not be equal in size**, and the invariant doesn't require
    it. An entry clamped by remaining buying power (see the edge-case table)
    deploys less cash but still counts as one unit, so N presses still take N
    presses to unwind — exits divide *shares*, not cash. That matters when
    `entrySize` doesn't divide `startingCapital` evenly: at 30%, three full
    entries leave 10%, and a fourth clamped entry is a legitimate runt unit
    rather than a denial that strands capital. `unitCount` is therefore
    bounded by buying power, not by a fixed `startingCapital / entrySize`
    ceiling — that formula happens to give 5 at the 20% default, but it isn't
    a rule.
  - **Guard against dust units**: if remaining buying power is below 1% of
    `entrySize`, deny the press with the `actionDenied` cue rather than
    opening a unit worth pennies. Without it, a player at full deployment can
    inflate `unitCount` with meaningless presses and dilute every subsequent
    exit.
  - The ghost stack caps its *rendered* ghosts at ~5 and switches to a
    numeric badge beyond that
    ([character.md](./character.md#position-size-visualization)), so it stays
    readable however many units are open.
- Fractional shares avoid a whole class of rounding problems — with whole
  shares, a fixed cash amount buys a different quantity at every price
  level.
- **Flat threshold**: any absolute position size below `1e-6` shares is
  treated as exactly flat and snapped to zero, with `unitCount` forced to
  0. Unit-symmetric exits should land on zero exactly, so this is a
  floating-point guard rather than the primary mechanism.
- Prices and cash are carried as full-precision floats and only rounded for
  *display*, never in the P&L path — rounding in the arithmetic makes the
  engine's unit tests unstable and lets errors accumulate over a 480-bar
  run.
- **Flatten** closes every open unit at once in a single action — see
  [controls.md](./controls.md#flatten-close-everything). It's one exit
  event for stats purposes, not N.

### Order intent matrix

What each press does depends on current state and direction. Entries are
sized in cash; exits are sized in **units**, closing an equal share of
what's open. That asymmetry is deliberate — "deploy $2,000" is the natural
way to express an entry, and unit-counted exits guarantee that N entries
take exactly N exits to unwind.

| State | `buy` | `sell` |
|---|---|---|
| **Flat** | **Entry (long)** — deploy `entrySize` cash at fill price; `shares = cash / price`; `unitCount = 1` | **Entry (short)** if `allowShorting`, sized the same way; otherwise **no-op** with denied cue |
| **Long** | **Add** — deploy another `entrySize` cash, clamped to remaining buying power; `unitCount++`; blends `avgCost` | **Reduce** — close `shares / unitCount`; `unitCount--`; realizes P&L |
| **Short** | **Reduce (cover)** — close `shares / unitCount`; `unitCount--`; **note it's governed by the exit rule, not `entrySize`**, because it's an exit | **Add** — short another `entrySize` of notional, clamped to short capacity; `unitCount++`; blends `avgCost` |

Plus, from either direction: **flatten** (hold the exit key) closes all
units at once — see [controls.md](./controls.md#flatten-close-everything).

The one counterintuitive cell is `buy` on a short: it's an *exit*, so it
reduces by one unit rather than deploying `entrySize`. Config keys are named
for the direction of their effect on position size (grow vs. shrink), not
for the button pressed — that naming is deliberate, to keep this from
becoming a recurring bug.

Neither action ever flips through zero in one press — see
[Shorting](#shorting).

### Scoring and cost basis

- **Score is reported two ways**: currency P&L *and* percent return on
  starting capital. Percent is what makes personal bests comparable
  across tickers trading at wildly different price levels — a $5 stock
  and a $500 stock produce incomparable dollar P&L for the same skill.
  `arcadeScore` ([game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-the-discipline-streak))
  sits beside these as a third number, never replacing them: it's realized
  P&L weighted by the discipline multiplier, and percent return remains the
  personal-best key.
- **Cost basis**: default is **weighted-average cost**. Each entry blends
  into a single average price weighted by size; each exit realizes P&L
  against that average, then reduces size toward zero.
  - On increasing the position:
    `avgCost' = (avgCost * size + price * addedSize) / (size + addedSize)`
  - On reducing it: `realizedPnL += closedSize * (exitPrice - avgCost)`,
    where `closedSize` carries the position's sign — so a short closed
    below its average entry yields a positive result without a separate
    formula.
- **Cost basis method**: `weighted-average` is the default and the one to
  build. FIFO lot tracking is more "realistic" but needs a lot ledger for
  a difference players are unlikely to perceive in a trainer; it stays a
  config option in [config.md](./config.md), unimplemented until someone
  wants it.

## Shorting

`allowShorting` (config, **off by default**) — but the engine carries
signed position size from day one regardless, so enabling it later is a
UI and rules change rather than an engine rewrite. Retrofitting sign into
a scalar position touches cost basis, P&L, stops, and rendering all at
once, which is exactly the kind of change worth not doing twice.

- **Entry**: with shorting off, `sell` while flat is a no-op. With it on,
  `sell` while flat opens a short — symmetric with `buy` opening a long,
  so no third input or mode toggle is needed. The two-button design from
  the original concept survives intact.
- **Direction is exclusive**: pressing `buy` on a short position reduces it
  toward zero and stops there; it never flips through zero into a long in
  one press. Flipping requires closing to flat, then entering again — a
  deliberate two-step, which matches how the state machine reads and
  avoids an accidental reversal on a mistimed press.
- **Stops invert**: for a short, the stop-loss level sits *above* the
  average entry, and a trailing stop ratchets *down* as price falls. Same
  code with a sign flip, not a second implementation.
- **Visual**: the character bounces beneath the poles while short (see the
  state machine above), and the ghost stack in
  [character.md](./character.md#position-size-visualization) trails the
  same way.

### Short account model

**Cash-collateralized, no leverage.** Deliberately the simplest model that
is still coherent:

- Short notional is capped at `startingCapital` — the same ceiling the long
  side has, so neither direction can take a larger position than the other.
- **Short-sale proceeds are locked as collateral, not credited to buying
  power.** Shorting $2,000 of stock does not give the player $2,000 more to
  deploy. Without this rule, proceeds would fund further positions and the
  player could compound leverage indefinitely.
- Buying power available for new entries is
  `min(cashBalance, startingCapital) − (long notional at cost) − (short
  notional at cost)`, floored at zero.

  Both halves of that `min` are load-bearing, and this is the general
  formula — it governs long-only runs too, not just shorts:
  - **Capping at `startingCapital` stops profits compounding.** `entrySize`
    stays a fixed fraction of the starting balance, so a full deployment is
    always the same number of units regardless of how well the run is going.
    That's what keeps unit counts, the ghost stack, and scores comparable
    between runs.
  - **Taking `cashBalance` when it's lower stops the player trading money
    they've already lost.** Without it, someone down $9,000 of $10,000 would
    still have full $10,000 capacity and could deploy five units of capital
    that no longer exists — and percent return could pass −100%, which is
    nonsense in a cash account with no leverage. With it, losses cost
    capacity: after that drawdown, `entrySize` at 20% affords no further
    entries and the dust guard denies the press.
- **No margin interest, no maintenance margin, no forced liquidation.**
  A trainer teaching entry/exit discipline gains nothing from modelling
  margin calls, and a forced-liquidation path would be a second,
  competing involuntary-exit mechanism alongside stops
  ([stops.md](./stops.md)) — two systems that close positions against the
  player's will is one too many for teaching a clear lesson.

Unrealized losses on a short can therefore exceed the collateral without
triggering anything; the position simply shows a large negative unrealized
P&L until closed or stopped out. That's a deliberate simplification, not an
oversight.

## Tick pipeline

Every bar advances through the same ordered pipeline. Specifying this is
what makes same-bar interactions deterministic rather than emergent:

1. **Bar N's growth animation completes** — the bar reaches its close
   height (see [Pole generation](#pole-generation--scroll)).
2. **Collect inputs** buffered during bar N, in press order.
3. **Apply orders** in press order at bar N's close as the fill price, each
   subject to the order-intent matrix and the edge-case rules below.
4. **Recompute cost basis, position, buying power, and realized P&L.**
5. **Evaluate stop levels** — the levels computed at bar N−1's close (see
   [stops.md](./stops.md#causality-and-timing)) against bar N's close.
   Trigger an auto-close if breached.
6. **Ask each active stop plugin for the level to enforce on bar N+1**,
   passing the now-updated position state.
7. **Update HUD, streak, audio, and stats.**
8. **Advance**: spawn bar N+1 and begin its growth animation.

Two consequences worth making explicit:

- **Inputs are applied before stops are evaluated** (step 3 before step 5).
  If the player manually exits on the same bar a stop would have fired, the
  manual exit wins and the stop finds a flat position — which is the
  behaviour the edge-case table below describes, and the reason the ordering
  is fixed rather than incidental.
- **A press during bar N's growth animation still fills at bar N's
  completed close**, because inputs are buffered and applied at step 3,
  after step 1. The player is committing before seeing the final height,
  which is intentional: it's the same commitment a real trader makes
  intra-day, and the alternative (blocking input during growth) would drop
  presses. Keep the growth animation short (a fraction of a bar's duration)
  so the commitment window stays small.

## Trade rules & edge cases

Explicit rules the engine needs from day one:

| Situation | Rule |
|---|---|
| `sell` while flat, shorting off | No-op. Fire the `actionDenied` cue rather than silence, so the press doesn't read as a dropped input. |
| `sell` while flat, shorting on | Opens a short position. |
| Exit press while flat | No-op with denied cue. |
| Flatten while flat | No-op, no cue — holding the exit key with nothing open is harmless, and a denial here would punish a reasonable "make sure I'm out" reflex. |
| Entry with insufficient remaining capital | Clamp to whatever buying power is left; the clamped entry still counts as one unit. If remaining buying power is below 1% of `entrySize`, no-op with the denied cue instead of opening a dust unit. |
| Entry at full deployment | Same as above — there is no separate max-unit rule; buying power is the only ceiling. |
| `buy` and `sell` on the same bar | Both apply, in press order. They partially or fully cancel, and each is recorded separately for stats — the player did two things and the stats should say so. |
| Stop triggers on the same bar as a manual exit | Inputs are applied before stops are evaluated (see [Tick pipeline](#tick-pipeline)), so a manual exit that reached flat wins and the stop finds nothing to close. **Manual action always overrides an enforcing stop**, including flatten. |
| An advisory stop's level is breached | Nothing is closed; the breach is recorded as a compliance event ([stops.md](./stops.md#advisory-mode)). |
| Data runs out with a position still open | Force-close at the final bar's close. Report it distinctly on the results screen ("closed at end of data"), since it's neither a player decision nor a stop — counting it as a normal exit would quietly distort win-rate stats. |

## Risk management

Stops are **plugins**, not fixed built-in rules — the full interface,
timing, and built-in strategies live in [stops.md](./stops.md). A stop
plugin receives position state after each bar closes and returns the level
to enforce on the next bar; the trailing stop is one implementation, and
players can add their own the same way they add indicators.

The rules the engine enforces regardless of which plugin is active:

- **Trigger basis: the bar's close, not its intraday low.** The pole *is*
  the close, the axis is close-based, and the fill price is a close — so
  triggering on anything else means the stop fires at a price never drawn
  on screen, which reads as arbitrary. Documented tradeoff: this is less
  realistic than a real broker's stop (which fires intraday, and therefore
  more often), and a bar that dipped through the stop and recovered by the
  close won't trigger. Consistency with what the player can actually see
  wins here.
- **Direction inverts for shorts** — see [Shorting](#shorting). A stop sits
  above average entry when short and ratchets downward. Same code path,
  sign-flipped, and the plugin sees signed size so it can handle both.
- **Stops auto-execute the close**: the game applies consequences the way a
  real broker's stop order would, reinforcing the habit rather than
  displaying a suggestion.
- **A triggered stop closes the entire position**, not a fraction — partial
  stop-outs would blur the "you got taken out" signal the Stopped-out state
  exists to deliver.
- **No stop plugin active is a valid configuration** — the player is then
  fully in charge of exits, which supports the "full manual discipline" risk
  profile. It is no longer the *default*, though: one advisory
  `trailing-percent` ships active
  ([config.md](./config.md#stops)), because a trainer with no risk rule
  out of the box is a strange default and the discipline streak has nothing
  to measure without one
  ([game-feel.md](./game-feel.md#where-the-streak-has-tension--and-where-it-doesnt)).
- **Stops are fixed for a run, never edited mid-position** — the player
  commits to a rule and lives with it. See
  [stops.md](./stops.md#why-this-is-better-than-editable-stop-levels) for
  why this is a deliberate improvement over an editable level rather than a
  missing feature.
- Stats track how often the player's own manual exits beat, matched, or got
  bailed out by the active stop; with no stop active, stats simply track
  manual exits without any comparison.

## Pole generation & scroll

- One pole per day of price data, in chronological order.
- **Unplayed poles are never rendered at all.** A pole is only spawned once
  it reaches the character's x-position (the traded "now"); the strip to the
  right of the character contains background layers, but no poles.
  This makes the no-lookahead constraint
  ([game-feel.md](./game-feel.md#new-composition--the-lookahead-problem))
  *structural* rather than something enforced by an opacity gradient — there
  is nothing to leak, so there's nothing to verify visually or to accidentally
  regress. It also avoids rendering ~15 poles per frame that are meant to be
  invisible. A leading-edge fog was drawn over that strip originally; it has
  been removed, because it was hiding nothing and hazed the scene behind it
  for no gain.
- **New bars "form" rather than pop in.** A bar appearing complete directly
  under the character would read as a rendering glitch, so instead the newest
  bar **opens as a flat mark at its open price and extends toward its close**
  over a fraction of a bar's duration, the way a real bar forms during a
  trading day. The character rides it up or down. This turns an unavoidable
  artifact of not rendering the future into something that reads as
  intentional — and incidentally teaches that the current bar is still
  forming, which is true.

  The close, high, and low are all interpolated away from the open by the
  *same* factor. That's what keeps the range enclosing the body at every
  intermediate frame: price ordering (`low ≤ open,close ≤ high`) survives a
  shared interpolation factor, so a body can never poke out of its own wick
  partway through a bar. Interpolating them independently, or animating the
  body but not the range, breaks it.
- Consequence worth noting: the current (rightmost, under-character) bar is
  the only one still changing. Fills execute at its close
  (see [Trading engine](#trading-engine)), so the fill price is where the
  bar has *finished* extending to — the growth animation is presentation,
  not a moving target the player is trading against.
- Candle heights = prices mapped to screen-space height, via **two
  independent config fields** — `priceTransform` (`none` | `log10`) applied
  first, then `normalizationMode` (see [config.md](./config.md) for the full
  table). All four of a bar's prices go through the same pipeline, so the
  body and the range can't disagree about the scale.

  They're separate because the log transform *composes* with a mode rather
  than replacing one; "log price, then visible-window min/max" is a valid
  setting a single enum couldn't express.

  **Default: `priceTransform: none` + `normalizationMode:
  visible-window-min-max`** — min/max over only the bars currently on
  screen. This is the leak-free choice: any mode that computes bounds over
  the whole series would reveal future prices through the axis, defeating
  the no-lookahead constraint in
  [game-feel.md](./game-feel.md#new-composition--the-lookahead-problem).
  See [Why full-series normalization leaks](#why-full-series-normalization-leaks)
  below for a worked example.

  **Critical detail**: the window runs from the left edge to the
  character's position — the *traded* present — and must **exclude any
  bars right of the character**. Those bars are technically within the
  viewport but haven't been played yet; letting them into the min/max
  would leak a screen-width of future prices, which is the exact bug this
  default exists to avoid.

  **Second critical detail: the window's bounds span the visible lows and
  highs, not the closes.** Since bars draw their full range, bounds that only
  know about closes don't push a wick off-screen where someone would notice —
  the unit conversion clamps, so every high above the window's highest close
  flattens into a line along the chart ceiling and reads as a rendering
  artefact rather than as data. Widening the bounds to the range is what makes
  the range drawable at all. It zooms the chart out slightly compared to a
  close-only window; the axis is the inverse of the same eased bounds, so its
  labels follow automatically rather than needing a matching change.

  This is not a lookahead concession. A played bar's high and low are as much
  in the past as its close.

  Modes legal during a live run (all causal — no future data):
  - **visible-window min/max** (default) — min/max over the visible,
    already-played bars only, as described above. Rescales as the window
    slides, so the axis easing in [hud.md](./hud.md) matters.
  - **fixed price-per-pixel** — a constant scale factor, no remapping and
    no data-dependent bounds at all.
  - **starting-price relative** — divide every price by the *first* bar's
    close. Safe because the reference is always already in the past;
    frames the run as "growth since the start of the series."

  `priceTransform: log10` is causal in its own right — a per-bar function
  with no dependence on other bars — so it's legal with any of the above and
  inherits that mode's legality.

  **Excluded from live play — these leak the future** (see
  [Why full-series normalization leaks](#why-full-series-normalization-leaks)):
  - **whole-series min/max** — axis bounds come from all bars including
    unplayed ones, revealing the run's eventual high and low.
  - **closing-price relative** — divides by the *last* bar's close, so the
    reference point literally is the final price of the run. Worst
    offender: the player can read "we're at 64% of where this ends up"
    directly off the axis.
  - **average-price relative**, **high/low-price relative** — reference
    values (series mean, max, min) may all come from future bars.
  - These could be revived in a **post-run review/replay mode**, where the
    outcome is already known and rescaling to the full series is genuinely
    useful. Not built now; noted so the design isn't lost.

  Also considered and rejected outright: z-score / mean-centering
  normalization produces negative values and would need an extra shift
  step before it's usable as a screen height. Day-over-day return
  normalization (percent or log change bar-to-bar) computes a *return*
  series, not a price *level* — a fundamentally different pole concept
  ("how big was today's move" vs. "where is the price"), worth considering
  as a distinct alternate game mode later. Fixed-size brick/box resampling
  (Renko/point-and-figure style) resamples the whole series into a
  different bar structure and would break the one-pole-per-trading-day
  design.
- Scroll speed is independent of trading state and fully configurable.

### Scroll speed, timing, and pole geometry

- **`scrollSpeed` is measured in bars per second**, not pixels per second.
  Bars/second is the meaningful unit for a trading trainer ("how many
  trading days pass per second"), it's resolution-independent, and the
  auto-bounce cadence falls straight out of it — one bounce per bar. Pixel
  velocity is then derived from bar width, not configured directly.
  Default 2 bars/sec; usable range roughly 0.5–10.
- **Everything is time-based, never frame-based.** All motion advances from
  elapsed wall-clock time, so the game runs at identical speed on a 60Hz
  laptop and a 120Hz phone. Getting this right in the first render loop is
  cheap; discovering it later means auditing every animation.
- **But elapsed time must never be allowed to bank bars.** A time-based loop
  that faithfully resolves every owed bar after a stall is a silent P&L
  corruption: background a tab for 10 seconds at 2 bars/sec and 20 bars
  resolve in one frame, applying buffered presses to bars they were never
  aimed at. Three rules, covering three different sizes of failure:
  - **At most one bar tick per frame.** Safe unconditionally — `scrollSpeed`
    tops out at 10 bars/sec against a ≥60Hz display, so no legitimate
    configuration owes two bars in one frame.
  - **Clamp the accumulator to one bar's duration.** A GC hitch or a window
    resize then slows the scroll imperceptibly instead of banking bars.
  - **Auto-pause when the page is hidden** (`visibilitychange`) — tab
    switched, phone locked, app backgrounded. This routes into the existing
    Paused state ([controls.md](./controls.md#run-lifecycle)) rather than
    inventing a recovery path, so the player sees "Paused" and resumes
    deliberately instead of losing time silently.
- **Visible bar count is the layout primitive**: target ~60 bars on screen
  at once. That's enough history to read a trend without poles becoming
  unreadably thin on a phone.
- **"Playfield width" means the pole region only** — from the left edge to
  the character's x-position (~70–80% of the viewport), *not* the full
  viewport. Bar width is `playfieldWidth / visibleBarCount`. This matters
  because unplayed poles are never rendered (above), so the strip right
  of the character never contains poles; measuring bar width against the
  full viewport would silently shrink the actual visible history by 20–30%
  and make `visibleBarCount` a lie.
- So the same config works across every screen size and aspect ratio rather
  than hardcoding pixel widths.
- Poles are drawn adjacent with a small fixed gap as a fraction of bar
  width (~15%), which keeps them visually distinct without a separate
  spacing config to tune.
- The `visible-window-min-max` normalizer's window is exactly those
  `visibleBarCount` played bars — so `visibleBarCount` also determines how
  reactive the axis is. Fewer visible bars means a twitchier axis.

### Why full-series normalization leaks

Kept as rationale, since the excluded methods look harmless at a glance
and the mistake is easy to reintroduce.

Take a year of AAPL: 250 bars, price travels from $150 up to $250. The
player is 30 bars in, current price $160.

**With `whole-series-min-max`** the axis is locked to `[150, 250]` for the
entire run, because those bounds were computed from all 250 bars up front:

```
$250 ┤                      ← axis top: the year's high, already revealed
     │
     │
$160 ┤ ▐▌▐▌▐▌  🐦            ← everything played so far sits down here
$150 ┤▐▌▐▌▐▌▐▌              ← axis bottom: the year's low, already revealed
     └────────────────────
```

The player hasn't seen a single future bar — unplayed bars aren't drawn at
all — but the axis has told them the answer: this stock reaches $250
(+56%) at some point, and never drops below $150. Optimal play becomes
"buy and hold, treat every dip as free money." No pattern recognition
required, so the training value is gone.

**`closing-price-relative` is worse.** It divides every price by the
*last* bar's close, so the reference line *is* the final price of the run.
At bar 30 the pole renders at `160/250 = 64%` of reference height — the
player reads "we're at 64% of where this ends up" straight off the axis.
A direct readout of the answer.

**With the `visible-window-min-max` default**, the axis covers only the
bars actually on screen, say `[155, 168]`:

```
$168 ┤    ▐▌   🐦           ← axis top: highest bar VISIBLE now
     │ ▐▌ ▐▌▐▌
$155 ┤▐▌▐▌▐▌▐▌              ← axis bottom: lowest bar VISIBLE now
     └────────────────────
```

Nothing about the future is knowable. The cost is that bounds shift as the
window slides, which makes the axis easing in [hud.md](./hud.md)
load-bearing rather than cosmetic — without it, every new extreme snaps
the whole chart.

## Candle geometry

Each bar is two rectangles sharing a centre line:

- the **body**, spanning open to close, in the direction colour at full strength
- the **high–low range** behind it, in a desaturated and dimmed version of that
  same colour

```
   candlestick            bollinger bar
        │  high                 ▒   ← muted direction colour
      ┌─┴─┐ close             ███   ← full-strength
      │   │                   ███      (open → close)
      └─┬─┘ open              ███
        │  low                  ▒
```

**One number is the entire difference between the two standard chart types**,
which is why it's a single parameter and not two drawing routines — the range's
width as a fraction of the body's:

| Value  | Result                                                             |
| ------ | ------------------------------------------------------------------ |
| ~0.15  | a **candlestick** — narrow wick, wide body                         |
| `1`    | a **Bollinger bar** — one uniform column, open→close section picked out in the direction colour |

Anything between is a legitimate hybrid, so it's a continuum rather than an
enum with two members.

**One setting feeds it: `visuals.barStyle`**, either `bollinger` (the default)
or `candlestick`, and it applies in every mood.

There were briefly two. The visual theme carried its own `wickWidthFraction` as
a house style, read whenever `barStyle` was `theme` — but both shipped moods
asked for `1`, so that path only ever produced the default. A control whose
setting made no difference, plus a themeable number nothing else read, is worse
than a single value: it's two places for the same decision to drift apart. The
width now comes from the setting alone, resolved by one lookup.

Chart type is a **reading preference, not a difficulty setting** — both styles
draw all four prices — so it's excluded from the run fingerprint. Nobody's
personal-best history is orphaned by preferring one.

Three rules the geometry has to keep:

- **The range always encloses the body**, including at every intermediate
  frame of the forming animation. Enforced structurally, not by inputs
  happening to be well-behaved: both rectangles get the same minimum drawn
  height, and the body is then clamped into the range. Two independent
  height floors is enough on its own to break it — a doji body floored to 2px
  inside a range floored to 1px sits outside its own high and low.
- **Direction comes from the prices, not from the heights.** At the edge of
  the chart the unit conversion clamps, so a genuinely rising bar whose open
  and close both sit above the bounds would compare *equal* in height space
  and be miscoloured as unchanged.
- **A doji still draws.** Zero pixels is indistinguishable from missing data,
  and "opened and closed at the same price" is information. It gets the
  minimum height, centred on the price it printed, in the theme's own colour —
  there is no direction to report.

### Colour

**Body colour comes from `visuals.pnlPalette`, not from the visual theme.**
The same setting the HUD and the exit particles read. A red/green chart is
*the* canonical colourblind hazard, and a player who selected blue/orange
selected it for the bars most of all. Colour is never the only cue regardless:
the body's position relative to the range says the same thing.

**The range is a muted version of the body's colour, not a shared neutral.**
It started as a neutral, on the reasoning that direction is the body's job and a
coloured range would say the same thing twice. That holds for a *candlestick*,
where the range is a thin wick. It fails at Bollinger width, where the range
**is** most of the column: the neutral then occupies the majority of every bar,
and the coloured section reads as a sticker applied to a dark bar rather than as
the bar's own direction. The thing the eye lands on first ends up being the part
carrying no information.

So the range takes the direction colour, muted two ways — **and it needs both**:

- **Desaturated**, by mixing toward `palette.candleRange`. This is where a mood
  keeps control of how dark and how muted its bars come out.
- **Dimmed**, to a guaranteed minimum lightness below the body. Not redundant,
  though it looks it: `serious`'s neutral is a *light* steel blue, so mixing its
  red body toward it barely changes the lightness at all and the two sections
  would have differed only in saturation. A saturation-only difference is the
  weakest cue available and the first one lost to any colour-vision difference.

Always dimmer, never lighter, so the rule reads the same in every theme rather
than flipping depending on which side of the body colour a mood's neutral
happens to fall.

## Jump mechanic

- **Automatic bounce, no timing skill.** While Active, the character
  bounces bar-to-bar on a cadence derived from scroll speed — one bounce
  per bar, and the player never has to time a jump manually. All skill
  expression is in the buy/sell/sizing/stop decisions, not platforming.
- **Fixed-height hop, variable landing.** Every hop uses the same arc
  height; the character lands on wherever the new bar's **close** happens to
  be. This isn't just an aesthetic pick — an arc that *scales* to the height
  difference would require knowing the next bar's price before jumping,
  which is exactly the future information the no-lookahead constraint
  forbids. The standard auto-runner solution and the only causally legal
  one happen to coincide.
- The landing therefore reads as a *consequence* rather than a plan, which
  suits the game: the player finds out where price went by watching where
  the character lands.
- **It stands on closed bars, and rides them.** The hop begins the instant the
  forming bar closes, so the character never commits to a bar still being
  drawn — a bar's close is what the game fills at, and a bar that hasn't
  closed has no close to stand on. Between hops the character travels
  *with* the bar it's on, leftward at the scroll speed, and each hop is a
  leap of exactly one bar width back toward the now-line.

  It used to be pinned at that line and hop during the growth window
  instead, which was wrong twice over for the same reason. It committed to
  an unfinished bar, and because it held one screen position while the
  world moved it appeared to slide: for three quarters of every bar it hung
  motionless while the bar it had just landed on slid out from under it. A
  fixed point against a moving world *is* a slide. So `characterX` is now
  the line the character arrives at, not where it lives — see
  `render/character/gait.ts`, where the timing lives as a pure function.

## Scoring & stats

### What counts as one "trade"

Scaling in and out makes this genuinely ambiguous — three buys, two partial
exits, and a final close is either *one* trade or *six* events, and the
streak mechanic in [game-feel.md](./game-feel.md) gives completely different
results depending on which is meant. Two distinct units, used for different
purposes:

- **Campaign** — one flat-to-flat cycle, from the first entry that leaves
  flat to the exit that returns to flat. **This is the unit for win/loss
  stats**: win rate, average win, average loss, biggest win/loss. It's the
  right unit because it's the unit the player actually *decided* — "was this
  position a good idea" is a question about the whole campaign, not about
  each press within it.
- **Close event** — any individual size reduction that realizes P&L. **This
  is the unit for streak ticks** ([game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-the-discipline-streak)),
  because the streak wants moment-to-moment feedback and a campaign can last
  a hundred bars.

A campaign's win/loss is the sign of its **summed realized P&L** across all
its close events, not the sign of its final close.

Consequence to note: partial exits mean a campaign can contain both winning
and losing close events. Streak therefore fluctuates *within* a campaign
while win rate updates only when it ends — intended, since they're measuring
different things (execution vs. judgement).

### Tracked stats

- Running realized P&L (primary score), in currency and percent return.
- **Discipline streak and `arcadeScore`** — longest compliant run of close
  events, final multiplier, and the number of advisory breaches that reset it
  ([game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-the-discipline-streak)).
  The reset count is the same signal as the advisory-compliance stat below,
  reported as an arcade number rather than a coaching one.
- Campaign count, win rate, average win, average loss, biggest win/loss.
- Stop-rule compliance: fraction of campaigns ended manually vs. by an
  enforcing stop plugin, and whether manual exits happened before or after
  the active level would have triggered.
- **Advisory-stop compliance** ([stops.md](./stops.md#advisory-mode)): for
  display-only stops, how often the player exited on their own signal, how
  many bars they lingered past a breached level, and the P&L difference
  versus having exited on the signal. This is the sharpest feedback the game
  offers about hesitation — with an enforcing stop the engine acts, so the
  stat only measures automation; with an advisory stop it measures the
  player.
- Whether any active stop widened during the run and by how much
  ([stops.md](./stops.md#no-monotonic-tightening-enforcement)).
- Flatten usage — how often a campaign ended in a decisive close-everything
  rather than a staged exit. Neither is better, but the ratio says something
  about how the player handles pressure.
- Campaigns force-closed at end of data, reported separately so they don't
  distort win rate.
