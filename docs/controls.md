# Controls & Input

## Bindings

Two actions, matching the original two-button concept.

| Action | Desktop | Mobile |
|---|---|---|
| Buy (enter/scale into long, reduce short) | `↑` or `W` | Thumb button, bottom **right** |
| Sell (exit/scale out, or enter short when `allowShorting` is on) | `↓` or `S` | Thumb button, bottom **left** |
| Pause | `Esc` or `P` | Pause icon, top corner |

Up-is-buy is the mapping worth keeping deliberately: it matches the
character jumping *up* onto poles for a long, and going *down/under* for a
short (see
[game-design.md](./game-design.md#state-machine)), so the control
direction, the price direction, and the character's position all agree.
Arrow keys and WASD are both live so the player can use either hand.

Rejected: `B`/`S` mnemonic keys (clearer to learn, but awkward for
repeated scaling in, which is a core mechanic here), and `Space`/`Shift`
(fine for a primary action, but the secondary one is undiscoverable).

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

## Input handling rules

- **One action per press**, no auto-repeat on hold. Holding a key must not
  drain buying power — position sizing should never be a function of how
  long a finger rested on a button.
- Presses are **buffered during a bar and applied at step 3 of the tick
  pipeline** ([game-design.md](./game-design.md#tick-pipeline)), in press
  order, at that bar's completed close. Multiple presses in one bar all
  apply.
- **Input is ignored during the `Stopped-out` transient and while paused.**
  Stopped-out lasts exactly one bar — long enough to read the feedback,
  short enough not to feel like a lockout — and presses during it are
  dropped rather than queued, so a panicked double-tap doesn't immediately
  re-enter a position the player was just stopped out of.
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
