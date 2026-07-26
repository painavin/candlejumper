# Stop Strategies (Plugin-Based)

## Decision

Stops are **plugins**, not a fixed pair of built-in rules. A stop plugin is
handed the position state after each bar closes and returns the stop level
to enforce on the next bar. Trailing stop becomes just one implementation
of that interface, and players can add their own strategies exactly as they
add indicators ([indicators.md](./indicators.md)).

This replaces the earlier model of two hardcoded config values
(`initialStopLoss`, `trailingStop`) with one extensible mechanism.

## Why this is better than editable stop levels

The docs previously allowed stop levels to be adjusted mid-run as a
"deliberate exception" to config being fixed. That was a genuine design
problem: **moving a stop away from price to avoid being stopped out is the
canonical bad trading habit** — precisely the behaviour a discipline
trainer should make impossible, not offer as a feature.

The plugin model dissolves the problem rather than policing it. The player
commits to a *rule* before the run, and the rule then executes
deterministically bar after bar. There is **no mid-run stop editing UI at
all** — no keyboard binding, no HUD widget, no mobile surface, and no
"what happens to the ratchet after an edit" question. Committing to a rule
and living with it is the lesson.

## Interface

```ts
interface StopPlugin {
  id: string
  displayName: string
  params: ParamSpec[]        // same ParamSpec as indicators; drives the settings UI
  /**
   * Indicators this stop needs, derived from its own params — so an
   * `atrLength` param can size the ATR the stop asks for. Omit if none.
   */
  requires?(params: Record<string, number>): IndicatorRequest[]
  createInstance(params: Record<string, number>): StopInstance
}

interface IndicatorRequest {
  key: string                // local name this stop reads its values under
  indicatorId: string        // any id in the registry — built-in or user-loaded
  params: Record<string, number>
}

interface StopInstance {
  reset(): void
  /**
   * Called once after each bar closes, while a position is open.
   * Returns the absolute price level to enforce on the NEXT bar,
   * or null for "no stop active this bar".
   */
  onBar(
    bar: OhlcvBar,
    position: PositionState,
    indicators: IndicatorValues,
  ): number | null
}

/** This bar's indicator outputs, keyed by request key, then by output name. */
type IndicatorValues = Record<string, Record<string, number>>

interface PositionState {
  size: number             // signed: >0 long, <0 short
  avgCost: number
  barsHeld: number
  bestPrice: number        // most favourable close since entry (dir-aware)
  worstPrice: number
  entryBarIndex: number
}
```

`OhlcvBar` and `ParamSpec` are defined in
[indicators.md](./indicators.md#shared-types) — deliberately the same types,
since stop plugins and indicator plugins share a host.

## Using indicators inside a stop plugin

A stop that can't read an indicator is limited to arithmetic on entry price
and position state, which rules out most of the strategies worth writing —
an ATR/volatility stop, a chandelier stop, and a moving-average stop are all
just "compute an indicator, offset from it." So **any indicator in the
registry is available to any stop plugin**, built-in or user-supplied, in
either direction: a user's custom indicator can feed a built-in-style stop,
and a user's custom stop can consume the built-in Simple Moving Average.

Stops declare what they need rather than fetching it. The host then owns
instantiation and feeding order, which is what keeps the causality rules
below enforceable rather than left to each plugin author.

### The host owns the instances, and feeds them every bar

- A stop's `requires()` is resolved **once, at run start**, from the params
  the player committed. The host creates one indicator instance per request
  and stores it against that stop instance.
- **Stop-owned indicators are fed every bar from the first bar of the run,
  not just while a position is open.** This is the non-obvious rule: only
  the *stop's* `onBar` is gated on having a position. If its indicators were
  fed only during a position, a 14-bar ATR stop would restart warm-up on
  every entry and offer no level for the first 14 bars of each trade —
  precisely the bars where a new position is most exposed.
- Consequently, `StopInstance.reset()` on entry does **not** reset the
  stop's indicators. The host resets those only at run start or on a ticker
  change.

### Causality is unchanged

An indicator value for bar N is available at bar N's close, and the level a
stop returns at bar N is enforced against bar N+1
([above](#causality-and-timing)). So an indicator-derived stop is causal for
the same reason a price-derived one is — no new leak, and no new rule. The
host feeds a stop's indicators strictly in bar order, never ahead of the
played position, which is the same guarantee the displayed indicators get.

### Stop-owned instances are separate from displayed ones

If the player has SMA(20) on the chart *and* a stop asking for SMA(20), that
is **two independent instances** computing the same numbers. This looks
wasteful and is deliberate:

- **Toggling an indicator pane must never change risk management.** If they
  shared an instance, hiding an overlay would alter — or kill — the stop
  driving the player's exits. That's the fail-open-on-risk outcome this doc
  already calls the worst available.
- It keeps the **run fingerprint** honest
  ([game-feel.md](./game-feel.md#new-session-structure-the-highest-leverage-item-here)):
  `indicators.*` is excluded from the fingerprint as an analysis aid, while
  `stops.active` is included. A stop's indicator dependency travels inside
  its own params, so it lands in the fingerprint where it belongs — but only
  because the two don't share state.
- The cost is a few extra arithmetic ops per bar. Not worth coupling
  display to risk over.

A player who wants to *see* the indicator their stop uses adds it to
`indicators.active` separately. The duplicate instance is harmless.

`paneKind` and `fixedRange` are rendering hints and are ignored when an
indicator is consumed by a stop — an oscillator and an overlay are equally
usable as a number.

### Warm-up must produce `null`, never a `NaN` level

Indicators return `NaN` until warmed up
([indicators.md](./indicators.md#typescript-indicator-contract)). A stop that
passed that through as a price level would be **worse than having no stop**:
every comparison against `NaN` is false, so the level would silently never
trigger while the HUD displayed a stop as active.

Two rules, belt and braces:

- **Plugin contract**: a stop must return `null` while any indicator it
  depends on is still `NaN`. `null` already means "no stop this bar" and
  renders as no line, so the player sees the truth.
- **Engine guard**: `engine/stops/` treats any non-finite
  level as `null` regardless of what the plugin returned, and records it.
  A plugin returning `NaN` on more than a warm-up prefix is misbehaving and
  is subject to the same auto-disable-and-notify path as one that throws.

### A missing indicator fails the run before it starts

If a stop requests an `indicatorId` the registry can't resolve — a user
indicator that was unloaded, say — the run **refuses to start**, with a
message naming the stop and the missing indicator.

Deliberately not the auto-disable path: that exists for a plugin that dies
*mid-position*, where the run is already underway and the only options are
bad ones. An unresolvable dependency is knowable before the first bar, and
the player is choosing their risk rules at that moment. Starting a run whose
stop silently doesn't exist is the failure mode worth spending a blocking
error to avoid.

No dependency cycle is possible: indicators can't request stops, and stops
can't request other stops.

## Causality and timing

**A stop level computed at bar N's close is enforced against bar N+1's
close.** This is not a detail to leave to the implementer: computing a
level from bar N and also triggering it on bar N is retroactive, and would
let a stop fire on information from the same bar it was derived from.
Enforcing on the next bar keeps stops causal, matches the close-based
trigger rule in [game-design.md](./game-design.md#risk-management), and
slots cleanly into the tick pipeline there.

Consequence worth stating: a stop can never fire on the bar the position was
opened on. Entry at bar N means the first computed level applies at bar
N+1. That's correct, if slightly less protective than a real broker's
same-day stop.

## Multiple active stops

More than one stop plugin can be active at once. The engine enforces
**whichever level is hit first** — effectively the tightest binding
constraint, which mirrors how a real trader stacking a hard stop under a
trailing stop would expect it to behave. The stop-out record notes *which*
plugin fired, so the results screen and stop-compliance stats can attribute
it.

If every active plugin returns `null`, the position simply has no stop that
bar.

## No monotonic-tightening enforcement

A tempting safety rail is to forbid a plugin from ever widening the stop.
**Don't** — a legitimate volatility-based strategy (an ATR stop, say)
*should* widen when volatility rises, and forcing monotonicity would break
it. The discipline concern that motivated tighten-only is already handled by
the rule being committed pre-run rather than edited under pressure.

Instead of enforcing, **record**: track whether a run's stops widened and
by how much, and surface it in the run stats. Observation over prohibition —
a player can then see the behaviour of their own chosen rule.

## Advisory mode

Each active stop instance carries an **`advisory`** flag (default `false`).
An advisory stop computes and *displays* its level but never closes the
position — the player has to honour it themselves.

This is the genuinely useful version of a "manual stop." It creates the
training loop the compliance stat was always reaching for: with an enforcing
stop, the stat records what the *engine* did; with an advisory stop, it
records whether the **player** did what their own rule said. That's the
actual habit being trained.

- **Breach is a per-bar state, not a latch.** It's evaluated at step 5 of
  the tick pipeline like any other level check: a bar whose close is past
  the level puts the position *in breach*, and a bar closing back on the
  favourable side clears it. This comes up constantly, since a trailing level
  ratchets and price crossing back inside it is ordinary. The consequence
  worth stating: a player who ignores the signal and then recovers is no
  longer in breach and can start rebuilding their discipline streak
  ([game-feel.md](./game-feel.md#new-the-arcade-scoring-layer-the-discipline-streak))
  — the reset already happened at the breach and isn't re-applied. The
  compliance event still records the whole episode, including how many
  consecutive bars it lasted.
- Breaching an advisory level records a **compliance event** — "your rule
  said exit here, price is past it" — with how many bars the player stayed
  past it and what the P&L difference was versus exiting on the signal.
  That difference is the most direct feedback the game can give about
  hesitation.
- Advisory levels render as a **dashed** line on the chart, enforcing ones
  as solid ([hud.md](./hud.md#top-hud)), so there's never ambiguity about
  whether something will save you.
- Advisory and enforcing stops can be active simultaneously — e.g. an
  advisory tight trailing stop to practice reading exits, plus an enforcing
  wide disaster stop as a backstop.
- A natural progression for a player: start advisory to learn where the
  rule fires, then switch the same plugin to enforcing once they trust it.
- **Advisory mode is the only configuration the discipline streak can
  measure.** An enforcing level can't be ignored — the engine closes the
  position — so the streak is unlosable under enforcing stops and dormant
  with none active. That makes advisory mode the arcade layer's home rather
  than a training-wheels setting, and it's why the shipped default is one
  advisory stop
  ([game-feel.md](./game-feel.md#where-the-streak-has-tension--and-where-it-doesnt)).
  A breach reset lands **at the breach**, not at the eventual exit, so the
  compliance event this section already records drives both the stat and the
  meter.

**Not added: a "manual stop" plugin.** An empty `stops.active` list already
*is* manual mode — the player fully in charge, no levels computed. A
`manual` plugin would be a second way to express the same state, and two
representations of one thing invites "is `[]` different from `[manual]`?"
bugs for no gain. Advisory mode covers what a manual-stop plugin would
actually have been *for*: seeing a level without being governed by it.

## Player override

Stops never take away the player's ability to act:

- **Manual exits always win.** Inputs resolve at step 3 of the tick pipeline,
  stops at step 5 ([game-design.md](./game-design.md#tick-pipeline)), so an
  exit on the same bar a stop would fire executes on the player's terms and
  the stop finds nothing to close.
- **Flatten** (hold the exit key,
  [controls.md](./controls.md#flatten-close-everything)) closes everything
  in one action regardless of what any stop plugin thinks.
- Stops never block or swallow input, and no stop can prevent an exit.

The asymmetry is deliberate: a stop can force you *out*, but never keep you
*in*.

## Built-in stop plugins

Two ship initially, covering what the old config keys did:

| Plugin | Params | Behaviour |
|---|---|---|
| `fixed-percent` | `percent` (default 5%) | A level a fixed percent from average entry, recomputed as avg cost changes when scaling in. Direction-aware: below entry when long, above when short. |
| `trailing-percent` | `percent` (default 8%) | A level a fixed percent from `bestPrice`, ratcheting in the position's favour and never rewinding. Direction-aware. Looser default than the fixed stop, since it ratchets. |

**`trailing-percent` ships active, in advisory mode**, and is the only entry
in the default `stops.active` ([config.md](./config.md#stops)). Advisory
rather than enforcing so the player learns where their rule fires before it
starts closing positions for them, and because advisory is the only mode the
discipline streak can measure
([game-feel.md](./game-feel.md#where-the-streak-has-tension--and-where-it-doesnt)).
Clearing the list remains fully supported — the player is then in charge of
every exit, which was the previous default and is still the "full manual
discipline" risk profile in
[game-design.md](./game-design.md#risk-management).

Neither built-in declares a `requires()`, so both work before the indicator
registry exists — which is why they can land at
[roadmap.md](./roadmap.md) step 4 while indicators wait for step 8.

Natural later additions, none needing engine work: a time-based stop ("exit
after N bars") and a break-even stop ("move to entry once up X%") need only
`PositionState`. An **ATR/volatility stop** and a **chandelier stop** are
the first consumers of
[indicators in stops](#using-indicators-inside-a-stop-plugin) — they become
possible once the indicator registry lands, and are the reason that
mechanism exists.

## Sandboxing and hosting

Stop plugins run in the **same Web Worker sandbox** as indicator plugins
([indicators.md](./indicators.md#plugin-loading--sandboxing)) — one plugin
host, two plugin kinds. Same trust boundary, same contract validation, same
per-call time budget, same auto-disable on repeated failure.

A stop's **per-call time budget covers its indicator dependencies too** —
the host times the whole chain, since a stop starved by a slow indicator is
just as ineffective as a slow stop. A blown budget is attributed to the
stop, because the stop is what gets disabled and what the player has to be
told about.

One difference matters: **a misbehaving stop plugin has consequences a
misbehaving indicator doesn't** — an indicator that dies draws nothing,
whereas a stop that dies silently removes the player's risk protection
mid-position. So on auto-disable of a stop plugin, the engine must
**notify the player explicitly** rather than failing quiet, and record it in
the run stats. Failing open on risk management without telling anyone is
the worst possible outcome.

That asymmetry now reaches one level deeper: an indicator instance owned by
a stop is **not** subject to the quiet auto-disable a *displayed* indicator
gets. If it fails, the stop that depends on it is disabled and the player is
notified, exactly as if the stop itself had failed. The same indicator can
therefore be silently dropped from the chart and loudly fatal to a stop in
the same run — correct, because the consequences genuinely differ.

## Config

See [config.md](./config.md#stops) for `stops.active`, including the
per-instance `advisory` flag. Stops are configured pre-run like everything
else, and are **not** editable during a run.
