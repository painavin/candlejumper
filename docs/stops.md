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
  createInstance(params: Record<string, number>): StopInstance
}

interface StopInstance {
  reset(): void
  /**
   * Called once after each bar closes, while a position is open.
   * Returns the absolute price level to enforce on the NEXT bar,
   * or null for "no stop active this bar".
   */
  onBar(bar: OhlcvBar, position: PositionState): number | null
}

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
| `fixed-percent` | `percent` | A level a fixed percent from average entry, recomputed as avg cost changes when scaling in. Direction-aware: below entry when long, above when short. |
| `trailing-percent` | `percent` | A level a fixed percent from `bestPrice`, ratcheting in the position's favour and never rewinding. Direction-aware. |

Both are **off by default** — a run with no stop plugin active means the
player is fully in charge of exits, which was already the intended default
in [game-design.md](./game-design.md#risk-management).

Natural later additions, all costing no engine work: ATR/volatility stop,
time-based stop ("exit after N bars"), break-even stop ("move to entry once
up X%"), chandelier stop.

## Sandboxing and hosting

Stop plugins run in the **same Web Worker sandbox** as indicator plugins
([indicators.md](./indicators.md#plugin-loading--sandboxing)) — one plugin
host, two plugin kinds. Same trust boundary, same contract validation, same
per-call time budget, same auto-disable on repeated failure.

One difference matters: **a misbehaving stop plugin has consequences a
misbehaving indicator doesn't** — an indicator that dies draws nothing,
whereas a stop that dies silently removes the player's risk protection
mid-position. So on auto-disable of a stop plugin, the engine must
**notify the player explicitly** rather than failing quiet, and record it in
the run stats. Failing open on risk management without telling anyone is
the worst possible outcome.

## Config

See [config.md](./config.md#stops) for `stops.active`, including the
per-instance `advisory` flag. Stops are configured pre-run like everything
else, and are **not** editable during a run.
