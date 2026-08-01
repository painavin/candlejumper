# Controls & Input

## Bindings

Two *trading* actions, matching the original two-button concept. Everything else on the
keyboard moves no money.

| Action | Desktop | Mobile |
|---|---|---|
| Buy (enter/scale into long, reduce short) | `↑` or `W` | Thumb button, bottom **right** |
| Sell (exit/scale out, or enter short when `allowShorting` is on) | `↓` or `S` | Thumb button, bottom **left** |
| **Flatten** (close everything now) | **Hold** `↓`/`S` ~400ms | **Hold** the sell button |
| Pause | `Esc` or `P` | Pause icon, top corner |
| Slower / faster | `←`/`A` and `→`/`D` | — |

Up-is-buy is the mapping worth keeping deliberately: it matches the
character jumping *up* onto poles for a long, and going *down/under* for a
short (see
[game-design.md](./game-design.md#state-machine)), so the control
direction, the price direction, and the character's position all agree.
Arrow keys and WASD are both live so the player can use either hand.

Left and right fall out of the same logic: the vertical axis is the position, and the
horizontal axis is the one the chart travels along, so slower and faster read as pulling the
world toward you or pushing it away. Nothing on the horizontal axis was bound, so no
existing muscle memory moves.

Rejected: `B`/`S` mnemonic keys (clearer to learn, but awkward for
repeated scaling in, which is a core mechanic here), and `Space`/`Shift`
(fine for a primary action, but the secondary one is undiscoverable).

## Scroll speed while playing

`scrollSpeed` is the biggest difficulty lever there is — it's the reaction time available —
and it's also the accessibility control ([accessibility.md](./accessibility.md)). Reaching
it through the settings screen means abandoning the run, which is exactly the wrong cost for
the thing a player wants when a run gets away from them. So it's on the keyboard.

- **A ladder, not an increment**: 0.5, 1, 2, 3, 4, 5, 6, 8, 10 bars/sec. The settings slider
  moves in half-bar steps, which is nineteen presses end to end. The rungs are close
  together at the bottom because that's where the difference is: 0.5 → 1 halves the reaction
  time, while 8 → 10 is a refinement. A speed the slider produced off the ladder — 2.5, 7.5
  — moves to the next rung *in the direction asked for*.
- **The ends are the clamp**, matching `validateConfig`'s 0.5–10 exactly. A press at the
  limit does nothing rather than wrapping to the other extreme, and the keyboard is never a
  way to reach a speed a config file would be refused for.
- **Auto-repeat is allowed here**, unlike the trade keys: holding `→` to ramp up is the
  natural gesture and there's no economic consequence, because a held key settles at 10.
- **It works while trade input is blocked.** The block exists so a panicked double-tap
  during the stopped-out transient can't re-enter the position; slowing down is exactly what
  a player wants at that moment.
- **Ignored while paused**, because it would take effect invisibly on resume and the pause
  screen shows no speed.
- **The bar in progress is preserved.** Retiming keeps the *phase*, not the accumulator, so a
  bar 60% formed stays 60% formed. Keeping the accumulator would jerk the growing bar and
  the hop, and speeding up mid-bar could resolve a bar instantly — applying buffered presses
  to a bar they were never aimed at, which is the same corruption the stall rules exist to
  prevent.
- **It is not part of the run fingerprint**, so using it costs nothing on the record. See
  [game-feel.md](./game-feel.md) for why that key was removed rather than made stricter.
- **Run-scoped**: the change lasts the run and doesn't write back to settings.

The speed in force shows in the top HUD's context plate next to the ticker and date, read
off the frame rather than from config — otherwise the readout would keep displaying the
speed the run started at.

## Flatten (close everything)

Real trading platforms all have a decisive "close position" control, and
unit-by-unit exits take as many presses as entries did — so closing a full
5-unit position under pressure would otherwise be five presses.

- **Gesture: hold the exit key/button ~400ms.** No third input is needed, so
  the two-button design from the original concept survives, and it works
  identically with a mobile thumb button. The hold makes it deliberate
  rather than something you trigger by accident.
- **Closes every open unit as a single exit event**, not N events — one
  floating P&L number, one stinger, one streak tick.
- **Manual action always overrides an enforcing stop.** Flatten resolves at
  step 3 of the tick pipeline, before stops are evaluated at step 5
  ([game-design.md](./game-design.md#tick-pipeline)), so a player who
  flattens on the same bar a stop would have fired exits on their own terms
  and the stop finds nothing to close.
- Works from either direction — it closes a short as readily as a long.
- Flatten while already flat is a **silent no-op**, with no denied cue:
  "make sure I'm out" is a reasonable reflex and shouldn't be punished.

### Tap vs. hold disambiguation

Because hold now means something, the two gestures need an explicit rule:

- On key/touch **down**, start a timer. Do nothing yet.
- Released **before** the threshold → a normal single-unit exit press,
  applied to the bar it was released on.
- Threshold **reached while still held** → flatten fires immediately, and
  the eventual release is swallowed so it doesn't also register a tap.
- Rejected alternative: **double-tap**, which can't be distinguished from
  rapid scaling-out — "exit twice quickly" is a legitimate thing a player
  does, and the engine would have to guess.

Rejected alternative for the binding: a dedicated third key or FLAT button —
most discoverable, but it breaks the two-button premise and costs scarce
mobile screen space next to the existing thumb buttons.

## Mobile layout constraints

- Thumb buttons sit in the bottom corners, outside the chart's plotting
  area, so a thumb never covers poles the player is reading.
- They must clear the character's resting position (~70–80% right, per the
  [lookahead composition](./game-feel.md#new-composition--the-lookahead-problem)),
  and the volume/indicator sub-panes along the bottom
  ([hud.md](./hud.md#sub-pane-vertical-layout)) — reserve the button strip
  in layout before allocating sub-pane height, not after.
- Generous hit targets. Scaling in means repeated rapid presses, so these
  are held-and-tapped controls, not precision ones.
- **Shown on a coarse pointer only**, not below a width threshold: a small
  desktop window still has a mouse, and a tablet with a keyboard still has a
  touchscreen. On a desktop these would be clutter over the chart.
- **Press fires on `pointerdown`, not `click`.** A click fires on release, which
  would make every entry feel late — and the exit button needs the press/release
  pair regardless, to tell a tap from a flatten-hold.
- **A thumb sliding off the button cancels the hold** rather than completing it.
  The release then happens outside the element, so `pointerup` never arrives and
  the timer would otherwise flatten a position the player had let go of.

## Run lifecycle

"The run ends when data runs out or the player chooses to stop" needed
mapping to concrete inputs and outcomes. Full state flow:

```
   Settings ──start──► Playing ──data exhausted──► Results ──► Settings
                        │  ▲                          ▲
                   Esc/P│  │resume                    │
                        ▼  │                          │
                       Paused ──end run───────────────┘
                        │  │
                        │  └──restart──► Playing (same config, fresh run)
                        │
                        └──abandon──► Settings  (nothing recorded)
```

### Pause menu options and their effects

| Option | Position | Stats & personal best | Results screen |
|---|---|---|---|
| **Resume** | Untouched | — | — |
| **Restart** | Discarded | Nothing recorded — treated as if the run never happened | No |
| **End run** | Force-closed at the current bar's close | **Recorded**, with the run marked `ended-early`; eligible for personal best | Yes |
| **Abandon** | Discarded | Nothing recorded | No |

Two deliberate choices here:

- **"End run" and "abandon" are separate options**, because collapsing them
  forces a bad tradeoff: if quitting always scored, a player couldn't
  escape a misclicked run without polluting their history; if quitting never
  scored, they couldn't bank a good run early. Offering both makes the
  intent explicit at the moment of quitting.
- **`ended-early` is recorded as a flag on the run**, and early-ended runs
  are eligible for personal bests but visibly marked. They're not
  equivalent to completing the series — ending early after a lucky opening
  streak is a real strategy, and the flag keeps that visible rather than
  either banning it or hiding it.

**Data exhausted** force-closes any open position at the final bar's close
and goes straight to Results, per
[game-design.md](./game-design.md#trade-rules--edge-cases). That close is
reported distinctly so it doesn't distort win-rate stats.

Pause freezes the tick pipeline entirely — scroll, stop evaluation, and
audio all halt, and no bar advances. It is **not** a settings screen; see
[config.md](./config.md) for why config is fixed for a run's duration.

**Pause also happens automatically when the page is hidden** — tab switched,
phone locked, app backgrounded — since a time-based loop must not resolve the
bars owed for that gap
([game-design.md](./game-design.md#scroll-speed-timing-and-pole-geometry)).
Reusing the pause state rather than inventing a catch-up path means the
player sees what happened and resumes on purpose.

**Entering pause clears the input buffer.** Presses buffered during the bar
that was interrupted must not apply to the bar that resolves on resume —
that's the same mis-assignment bug as banking stalled bars, arriving through
a different door.

## Input handling rules

- **One action per press, no auto-repeat on hold.** Holding a key must not
  drain buying power by repeating an entry — position sizing should never be
  a function of how long a finger rested on a button. Holding the *exit* key
  is the one gesture with a meaning, and it fires exactly once (see
  [Flatten](#flatten-close-everything)). The speed keys are outside this rule
  because they move no money — see [above](#scroll-speed-while-playing).
- Presses are **buffered during a bar and applied at step 3 of the tick
  pipeline** ([game-design.md](./game-design.md#tick-pipeline)), in press
  order, at that bar's completed close. Multiple presses in one bar all
  apply.
- **Input is ignored during the `Stopped-out` transient and while paused.**
  Stopped-out lasts exactly one bar — long enough to read the feedback,
  short enough not to feel like a lockout — and presses during it are
  dropped rather than queued, so a panicked double-tap doesn't immediately
  re-enter a position the player was just stopped out of. The speed keys are
  exempt: they're not a position change, and the transient is a moment a player
  may well want to slow down for.
- Denied actions (sell while flat with shorting off, entry with no buying
  power) fire the `actionDenied` cue in
  [audio.md](./audio.md#channel-3--event-stingers-one-shots) and
  [character.md](./character.md) rather than failing silently, so a press
  never reads as a dropped input.

## Pause

`Esc` / `P` on desktop, pause icon on mobile. Options and their
consequences are specified in [Run lifecycle](#run-lifecycle) above.
Adjusting stop levels is **not** available — stops are pre-run rules that
recompute themselves each bar ([stops.md](./stops.md)), deliberately not
editable under pressure.
