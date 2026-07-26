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

## Input handling rules

- **One action per press**, no auto-repeat on hold. Holding a key must not
  drain buying power — position sizing should never be a function of how
  long a finger rested on a button.
- Presses resolve against the bar currently under the character (that's
  also the fill price, per
  [game-design.md](./game-design.md#trading-engine)). Multiple presses
  within one bar all apply, in order — see the edge-case table there.
- Denied actions (sell while flat with shorting off, entry with no buying
  power) get an explicit "denied" cue rather than silence, so a press never
  reads as a dropped input.

## Pause

Pause offers resume / restart / quit — **not** settings. Config is fixed
for the duration of a run (see [config.md](./config.md)), so changing it
means starting a new run. Adjusting stop levels on an open position stays
available during play, since that's a trading decision rather than a
settings change.
