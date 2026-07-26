# Game Design

## Core concept

An endless side scroller. Poles scroll past at a configurable speed, each
pole's height derived from a day's closing price. There is no fail/death
condition tied to platforming — the run ends only when the price data runs
out or the player chooses to stop. The goal is to train pattern recognition
and trading discipline; the game keeps score via realized P&L and trading
stats, not lives.

## State machine

Three states:

- **Waiting** — no open position (size == 0). Poles still scroll past, but
  the character stays grounded and ignores them.
- **Active** — position open (size != 0). Character auto-bounces along the
  poles: **on top of them when long, suspended beneath them when short**,
  so position direction is readable at a glance without looking at the HUD.
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
- **Fill price**: a buy or sell executes at the **close of the pole the
  character is currently standing on**. That price is already visible on
  screen when the player presses, so a fill is never a gotcha, and the
  original "sell price minus buy price" arithmetic holds exactly.
  (Considered and rejected: filling at the *next* bar's close, which is
  more realistic — a real order can't fill at a price you've already
  seen — but puts the fill price behind the leading-edge fog and delays
  feedback.)
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
    one ghost per open unit, added and removed one per press — and
    `unitCount` is naturally capped at
    `startingCapital / entrySize` (5 at the default), matching the
    ghost cap.
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
  `startingCapital − (long notional at cost) − (short notional at cost)`,
  floored at zero.
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
| Entry with insufficient remaining capital | Clamp to whatever buying power is left; if that's zero, no-op with the denied cue. |
| Entry at max units | Same as above — `unitCount` is capped by `startingCapital / entrySize`. |
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
- **No stop plugin active is a valid, default configuration.** The player is
  then fully in charge of exits, which supports the "full manual
  discipline" risk profile.
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
  right of the character contains background layers and fog, but no poles.
  This makes the no-lookahead constraint
  ([game-feel.md](./game-feel.md#new-composition--the-lookahead-problem))
  *structural* rather than something enforced by fog opacity — there is
  nothing to leak, so there's nothing to verify visually or to accidentally
  regress by tweaking a gradient. It also avoids rendering ~15 poles per
  frame that are meant to be invisible. The fog therefore becomes purely
  atmospheric.
- **New bars "form" rather than pop in.** A pole spawning at full height
  directly under the character would read as a rendering glitch, so instead
  the newest bar **grows from the ground up to its close height** over a
  fraction of a bar's duration, the way a real bar forms during a trading
  day. The character rides it up or down. This turns an unavoidable
  artifact of not rendering the future into something that reads as
  intentional — and incidentally teaches that the current bar is still
  forming, which is true.
- Consequence worth noting: the current (rightmost, under-character) bar is
  the only one whose height is still changing. Fills execute at its close
  (see [Trading engine](#trading-engine)), so the fill price is the height
  the bar has *finished* growing to — the growth animation is presentation,
  not a moving target the player is trading against.
- Pole height = price mapped to screen-space height, via **two independent
  config fields** — `priceTransform` (`none` | `log10`) applied first, then
  `normalizationMode` (see [config.md](./config.md) for the full table).
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
  bars sitting behind the leading-edge fog**. Those bars are technically
  on screen but haven't been played yet; letting them into the min/max
  would leak a screen-width of future prices, which is the exact bug this
  default exists to avoid.

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
- **Visible bar count is the layout primitive**: target ~60 bars on screen
  at once. That's enough history to read a trend without poles becoming
  unreadably thin on a phone.
- **"Playfield width" means the pole region only** — from the left edge to
  the character's x-position (~70–80% of the viewport), *not* the full
  viewport. Bar width is `playfieldWidth / visibleBarCount`. This matters
  because unplayed poles are never rendered (above), so the fog strip right
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

The player hasn't seen a single future bar — the leading-edge fog is doing
its job — but the axis has told them the answer: this stock reaches $250
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

## Jump mechanic

- **Automatic bounce, no timing skill.** While Active, the character
  bounces pole-to-pole on a cadence derived from scroll speed — one bounce
  per bar, and the player never has to time a jump manually. All skill
  expression is in the buy/sell/sizing/stop decisions, not platforming.
- **Fixed-height hop, variable landing.** Every hop uses the same arc
  height; the character lands wherever the new bar's top happens to be.
  This isn't just an aesthetic pick — an arc that *scales* to the height
  difference would require knowing the next bar's price before jumping,
  which is exactly the future information the no-lookahead constraint
  forbids. The standard auto-runner solution and the only causally legal
  one happen to coincide.
- The landing therefore reads as a *consequence* rather than a plan, which
  suits the game: the player finds out where price went by watching where
  the character lands.

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
  is the unit for streak ticks** ([game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-streaks--multipliers)),
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
