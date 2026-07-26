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
- Each buy/sell press moves a *configurable* amount of size — see
  `buyUnitSize` / `sellUnitSize` in [config.md](./config.md).
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

## Trade rules & edge cases

Explicit rules the engine needs from day one:

| Situation | Rule |
|---|---|
| `sell` while flat, shorting off | No-op. Give feedback (a soft "denied" cue) rather than silence, so the press doesn't read as a dropped input. |
| `sell` while flat, shorting on | Opens a short position. |
| Exit size larger than the open position | Clamp to flat. Never overshoot into an opposite-direction position. |
| Entry with insufficient remaining capital | Clamp to whatever buying power is left; if that's zero, no-op with the same "denied" feedback. |
| `buy` and `sell` on the same bar | Both apply, in press order. They partially or fully cancel, and each is recorded as a separate trade for stats — the player did two things and the stats should say so. |
| Stop triggers on the same bar as a manual exit | The manual exit wins if it was pressed first; otherwise the stop fires and the exit becomes a no-op against a flat position. |
| Data runs out with a position still open | Force-close at the final bar's close. Report it distinctly on the results screen ("closed at end of data"), since it's neither a player decision nor a stop — counting it as a normal exit would quietly distort win-rate stats. |

## Risk management

- `initialStopLoss`: a level set at position entry (and editable while the
  position is open) beyond which the engine force-closes.
- `trailingStop`: a level that ratchets in the position's favour as price
  moves that way, force-closing on a pullback from the best price reached.
- **Units: percent, not absolute price.** A percent stop is portable across
  tickers and across runs — "risk 2%" means the same thing on a $5 stock
  and a $500 stock, whereas "$3" is meaningless without knowing the price
  level. It's also what the player should be thinking in as a habit. A
  percent is measured from average entry price for `initialStopLoss`, and
  from the best price reached for `trailingStop`.
- **Trigger basis: the bar's close, not its intraday low.** The pole *is*
  the close, the axis is close-based, and the fill price is a close — so
  triggering on anything else means the stop fires at a price never drawn
  on screen, which reads as arbitrary. Documented tradeoff: this is less
  realistic than a real broker's stop (which fires intraday, and therefore
  more often), and it means a bar that dipped through the stop and
  recovered by the close won't trigger. Consistency with what the player
  can actually see wins here.
- **Direction inverts for shorts** — see [Shorting](#shorting). The
  stop-loss sits above average entry and the trailing stop ratchets
  downward. Same code path, sign-flipped.
- Both **auto-execute** the close: the game should apply consequences the
  same way a real broker's stop order would, reinforcing the habit rather
  than just displaying a suggestion.
- **Both are optional and off by default.** The player explicitly chooses
  to set a stop, and can leave either or both disabled. With a stop
  disabled, the engine never force-closes on that rule — the player is
  fully in charge of deciding when to exit. This lets the player choose
  their own risk profile: full manual discipline, or opt into an
  enforced rule to practice sticking to one.
- Stats should track how often the player's own manual exits beat, matched,
  or got bailed out by their configured stop — this only applies to stops
  that are actually enabled; with both disabled, stats simply track manual
  exits without any stop comparison.

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
- Pole height = price mapped to screen-space height. This needs a
  normalization strategy, selectable via `poleHeightNormalization` (see
  [config.md](./config.md) for the full method table).

  **Default: `visible-window-min-max`** — min/max over only the bars
  currently on screen. This is the leak-free choice: any method that
  computes bounds over the whole series would reveal future prices through
  the axis, defeating the no-lookahead constraint in
  [game-feel.md](./game-feel.md#new-composition--the-lookahead-problem).
  See [Why full-series normalization leaks](#why-full-series-normalization-leaks)
  below for a worked example.

  **Critical detail**: the window runs from the left edge to the
  character's position — the *traded* present — and must **exclude any
  bars sitting behind the leading-edge fog**. Those bars are technically
  on screen but haven't been played yet; letting them into the min/max
  would leak a screen-width of future prices, which is the exact bug this
  default exists to avoid.

  Methods legal during a live run (all causal — no future data):
  - **visible-window min/max** (default) — min/max over the visible,
    already-played bars only, as described above. Rescales as the window
    slides, so the axis easing in [hud.md](./hud.md) matters.
  - **fixed price-per-pixel** — a constant scale factor, no remapping and
    no data-dependent bounds at all.
  - **starting-price relative** — divide every price by the *first* bar's
    close. Safe because the reference is always already in the past;
    frames the run as "growth since the start of the series."
  - **log price** — apply `log10` to price before any of the above — a
    pre-transform, not a standalone method; tames series with a huge range
    (long history across splits, high-growth tickers). Inherits the
    causality of whatever method it composes with.

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

- Running realized P&L (primary score).
- Win/loss trade count, average win size, average loss size.
- Stop-rule compliance: fraction of exits that were manual vs stopped-out,
  and whether manual sells happened before or after the configured stop
  level would have triggered.
