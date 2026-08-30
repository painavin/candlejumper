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
  motion: { flapAmplitude, flapPhaseOffset, squashFactor, tiltResponse, limbDriver }
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
- **Limbs answer to one of two clocks**, chosen per character by
  `motion.limbDriver`. `bar` sweeps them through one sine per bar, which is
  what a wing does and why Robin uses it. `hop` drives them from the jump arc
  instead: still while riding a bar, extended at the apex, still again on
  landing. A frog's legs kick when it jumps and are tucked the rest of the
  time, and one sine per bar cannot express that — it would wave the legs
  through the three quarters of every bar the character spends standing on a
  closed bar. Under `hop` the driving curve is the *same* `arc(hop)` that
  lifts the character, so full extension coincides with peak height for free,
  and `flapPhaseOffset` is inert because an arc has no phase to slide.
  **Still cosmetic**: this picks what rotates a limb, never the gait, the
  hitbox, or the cadence.
- A limb's `rotation` is its **rest pose**, and the driver adds to it rather
  than replacing it. (It replaced it until the frog arrived, which was
  invisible while Robin's wing — starting at zero — was the only limb.)
- **Short positions** reuse the bounce behaviour with a **sign flip on the
  vertical axis**, since the character travels beneath the poles while
  short (see [game-design.md](./game-design.md#shorting)). Free, not a
  second animation.
- **Trading-event overlays** are optional short transform flourishes (a
  spin, a hop, a slump) on top of the base behaviour, keyed to the same
  **semantic position events** the audio stingers use
  ([audio.md](./audio.md#channel-3--event-stingers-one-shots)) —
  `positionOpened`, `positionClosed.profit`, `positionClosed.loss` — **not**
  to button names. When short, the closing action is `buy`, so a flourish
  bound to "sell" would fire on the wrong half of every short trade. A
  character that doesn't define one falls back to plain `bounce`.
- **`actionDenied`** — a small, distinctly non-committal motion (a brief
  head-shake or recoil) when a press can't be honoured. Pairs with the
  audio denied cue so a rejected press is legible even muted. Required.
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

## Roster

Rendered as geometric silhouettes per the committed art direction in
[procedural-assets.md](./procedural-assets.md) — these read as distinct
*shapes*, not as illustrated characters:

| Character | Concept | Rig sketch | Limbs |
|---|---|---|---|
| Robin (classic bird) | Nod to the Flappy Bird lineage; the default — most legible silhouette for the genre | Round body ellipse, triangle beak, arc wings | `bar` |
| Frog | The character the gait was already animating (see below) | Squat wide body, both eyes bulging above the body line, hind legs that kick | `hop` |
| Bull | Bullish market mascot | Blocky body, two forward-swept horn triangles, head dips on each bounce | — |
| Bear | Bearish counterpart to Bull | Heavier rounded body, small rounded ears, weightier squash | — |
| Kangaroo | Hops for a living; the one leaning, tailed outline | Low body, long tail triangle, small head held high, hind leg that kicks | `hop` |
| Rocket | Meme-stock nod; the one tall silhouette | Narrow fuselage, nose cone pointing **up**, two fins, exhaust that fires on the jump | `hop` |

### Silhouette is the scarce resource

Worth stating plainly, because it governs what should be added next: Bull and
Bear are both a round body with two things on top, differing only in whether
those things are triangles or ellipses. At phone size that is barely a
difference. Palette is decoration; **outline is identity**.

So the three added after the starter set were each chosen to break that mould
rather than to add a colour — the frog is wide and low, the rocket is tall and
thin, the kangaroo leans and has a tail. Apply the same test to the next one.

### Why the frog fits the mechanic

Read [gait.ts](../src/render/character/gait.ts) beside it. The character rides
the most recently closed bar, then **leaps exactly one bar width** onto the
next along a fixed-height arc — the arc cannot scale to the landing, because
that needs the next bar's price, which the no-lookahead rule forbids. Discrete
perches, a fixed jump, no hovering.

That is a frog on lilypads, described precisely. Robin is the genre nod, but a
bird flaps and hovers rather than hopping perch to perch, and the game has been
animating a frog under a bird's rig the whole time. It stays second in the
picker rather than becoming the default, since the default is a save-compatible
choice and not an aesthetic one.

### The rocket points up

The only rig that doesn't face the direction of travel, for two reasons and the
second is the better one: up is the joke, and **a short position flips the whole
rig on the vertical axis**, so shorting turns the rocket nose-down at no cost.
The sign flip that already exists does it — no second rig, no branch.

### Rejected: a candle mascot

Listed as a future candidate for a long time, on the strength of tying into the
project's own name. It should not be built. A character shaped like a bar,
moving among bars, breaks the one thing a silhouette here must never do.

Still open and still cheap: a Robot Trader is weak with only ellipse, triangle
and arc available (no rectangle primitive, so it comes out as another blob), but
an owl, a grasshopper or a dolphin would each bring an outline the roster
doesn't have.

### Palettes are measured, not picked

Body colours are checked in
[roster.test.ts](../src/content/characters/roster.test.ts), which is why one or
two of them are not the colour the animal actually is:

- **Pairwise hue separation ≥ 25°**, because body hue is what separates one
  entry from another in the picker. The kangaroo is purple rather than tan for
  exactly this reason — a naturalistic tan lands 12° from Robin's gold.
- **No new character may have worse sky contrast than the roster already
  does.** The frog's first green was a bright lime sitting 0.012 luma from
  Jolly's pale lower sky, i.e. invisible whenever price was low; the shipped
  green is the highest-luma green that clears every sky stop of all five themes
  by a real margin.

Deliberately *not* asserted: an absolute contrast floor. Robin's gold and
Bull's mint both sit within 0.08 luma of Jolly's pale sky, so any floor worth
having would fail two shipped characters — and asserting a rule the shipped
content breaks is worse than asserting nothing.

### The picker shows rigs, not swatches

The settings roster draws each character's actual shapes as inline SVG
([characterPreview.ts](../src/ui/characterPreview.ts)), because choosing by
colour swatch is choosing by the one property that isn't identity — and it is
the only thing that tells the green frog from the green bull.

SVG rather than a Pixi canvas per tile: `src/ui` may not import `@render` (see
`eslint.zones.js`), six renderers for twenty ellipses would be absurd, and this
way the preview is a pure function with tests. The cost is that it has to agree
with `drawShape` about what a rig means and nothing enforces that, so it is kept
small and literal. One shared viewBox across all six, so proportions stay
comparable rather than each rig being normalised to its own box. Static pose —
six looping animations in a settings panel is noise.

### A rig that is not a roster entry

`hedgehog` is a fourth rig and is **deliberately absent from `characters`**, the
array the settings screen offers. It is the stop marker — see
[hud.md](./hud.md#top-hud) — and a marker the player could choose to *be* would
be a confusing thing to ship.

It is worth knowing that the split is possible at all: a rig is data, so anything
can draw one. The marker reuses `drawShape` from the character layer rather than
growing a second rig renderer, which is why the hedgehog is a full `Character`
(it needs a palette) despite never being playable. Its `motion` block is inert —
the marker is driven by the stop level, not by a gait.

A hedgehog because a stop *is* a hedge, and because a spiky dome is the one
silhouette here that cannot be mistaken for the player at 20px.

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
