# Character Selection

## Goal

Let the player pick who's jumping. This is **purely cosmetic** — every
character shares identical hitbox, physics, and bounce cadence, so the
choice never affects gameplay or scoring. Keeps the trading-skill signal
clean: character choice is self-expression, not a difficulty lever.

## Roster shape

Characters are **primitive rigs animated by math**, not spritesheets —
see [procedural-assets.md](./procedural-assets.md#character-generation).
A character is a small tree of shapes plus the constants that drive its
motion:

```
Character {
  id, displayName
  rig: [ { shape: 'ellipse'|'triangle'|'arc', offset, size, paletteSlot, ... }, ... ]
  motion: { flapAmplitude, flapPhaseOffset, squashFactor, tiltResponse, ... }
  palette: { body, accent, detail }
}
```

Animation states are **functions of continuous game state**, not frame
sequences:

- **`idle`** (Waiting) and **`bounce`** (Active) are required behaviours,
  driven by bounce phase and vertical velocity.
- **Squash-and-stretch** is derived from vertical speed rather than baked
  into frames — which is genuinely better than a spritesheet here, since it
  responds continuously instead of snapping between poses.
- **Short positions** reuse the bounce behaviour with a **sign flip on the
  vertical axis**, since the character travels beneath the poles while
  short (see [game-design.md](./game-design.md#shorting)). Free, not a
  second animation.
- **`buyFlourish` / `sellProfit` / `sellLoss`** are optional short
  transform overlays (a spin, a hop, a slump) on top of the base
  behaviour. A character that doesn't define one falls back to plain
  `bounce`.
- **`stoppedOut`** must be defined for **every** character, no fallback —
  it's the one state that must always read as visually distinct, matching
  the distinct stop-out audio cue in [audio.md](./audio.md).

Selection/rendering code always asks "what does the *currently selected*
character supply for state X" — it never branches on character id, so
adding a new character is a new rig definition, not an engine change.

The rig is drawn live each frame rather than baked to a texture (the one
exception to the bake-once rule in
[procedural-assets.md](./procedural-assets.md#the-core-rule-generate-once-not-per-frame)),
because the animation *is* the transform math. It's a handful of
primitives, so this is cheap.

## Position size visualization

Position size is variable (scaling in/out is a headline mechanic), so it
needs a representation in the world and not just a HUD number.

**Ghost stack**: a trail of translucent copies of the character behind the
main sprite, one per unit of position. Reads instantly and *countably* —
the player can see "I'm three deep" at a glance — and it visibly grows
with each buy press, which is exactly the feedback scaling in needs.

- Requires no per-character art: ghosts re-render the selected character's
  existing rig at reduced alpha and offset, so this costs nothing per
  roster addition.
- Cap the rendered ghosts (~5) and switch to a numeric badge beyond that,
  so a large position doesn't turn into an unreadable smear across the
  chart.
- While short, the stack trails beneath the poles alongside the character
  (see [game-design.md](./game-design.md#shorting)).

Rejected: scaling the character with size (distorts the sprite and
occludes poles at large sizes) and an intensity aura (non-distorting but
conveys magnitude vaguely rather than countably — and "how many units am I
in" is a number the player needs exactly).

## Initial roster (starter set, easy to expand later)

Rendered as geometric silhouettes per the committed art direction in
[procedural-assets.md](./procedural-assets.md) — these read as distinct
*shapes*, not as illustrated characters:

| Character | Concept | Rig sketch |
|---|---|---|
| Robin (classic bird) | Nod to the Flappy Bird lineage; the default — most legible silhouette for the genre | Round body ellipse, triangle beak, arc wings that flap on bounce phase |
| Bull | Bullish market mascot | Blocky body, two forward-swept horn triangles, head dips on each bounce |
| Bear | Bearish counterpart to Bull | Heavier rounded body, small rounded ears, weightier squash |

Good candidates for later, all cheap now that characters are rig
definitions rather than art: a Rocket (meme-stock nod), a Candle mascot
(ties into the project's own name), a Robot Trader. Keep the starter roster
small; expand once the three above feel right.

## Relationship to visual themes

Deliberately **decoupled from `visuals.theme`** (see
[visuals.md](./visuals.md#visual-themes)) — the roster is one universal
set, not re-parameterized per theme. Rationale: it lets a player keep a
favourite character across whichever mood they pick, and keeps character
identity stable. Characters carry their own `palette`, so they stay
readable against any theme's background.

(The original reason was avoiding an asset combinatorial explosion; with
procedural rigs that's no longer a cost, but keeping character identity
independent of world mood is still the better design.)

## Config

- `character.selected` — the chosen roster id. Default `robin`. See
  [config.md](./config.md).

## Sequencing note

The core loop needs *some* character rendering from roadmap step 1–2
onward (even a placeholder shape) — don't block that on this doc. Build the
real rigs alongside step 6 (visuals/parallax), once the state machine and
its behaviour hooks (`idle`, `bounce`, `stoppedOut` at minimum) are stable.

Honest cost of the procedural approach: character personality lives in
numeric constants tuned in code rather than in an art tool, and
expressiveness is bounded by what primitives convey. Budget iteration time
for making the bounce *feel* right — that tuning replaces the animation
work you'd otherwise have done in an art pipeline, it doesn't eliminate it.
