import type { Character } from './types.js'

/**
 * The roster, rendered as geometric silhouettes per the committed art direction — these
 * read as distinct *shapes*, not as illustrated characters.
 *
 * Character choice is **purely cosmetic**: identical hitbox, physics, and bounce
 * cadence, so it never affects gameplay or scoring. That keeps the trading-skill
 * signal clean — self-expression, not a difficulty lever. `limbDriver` is inside that
 * promise: it picks what rotates a limb, not how far or how fast the character jumps.
 *
 * **Silhouette is identity, and it is the scarce resource here.** Bull and Bear are both
 * a round body with two things on top and differ only in whether those things are
 * triangles or ellipses, which at phone size is barely a difference at all. Everything
 * added since has been chosen to break that outline rather than to add another colour:
 * the frog is wide and low, the rocket is tall and thin, the kangaroo leans and has a
 * tail.
 *
 * Body colours are checked against every theme's sky in `roster.test.ts`, which is why
 * one or two of them are not the colour the animal actually is.
 */

export const robin: Character = {
  id: 'robin',
  displayName: 'Robin',
  // A nod to the Flappy Bird lineage, and the most legible silhouette for the
  // genre — which is why it's the default.
  rig: [
    { shape: 'ellipse', dx: 0, dy: 0, width: 1, height: 0.88, slot: 'body' },
    { shape: 'arc', dx: -0.32, dy: 0.05, width: 0.62, height: 0.42, slot: 'accent', flaps: true },
    { shape: 'triangle', dx: 0.86, dy: 0.04, width: 0.4, height: 0.26, slot: 'accent', rotation: 0 },
    { shape: 'ellipse', dx: 0.34, dy: -0.22, width: 0.2, height: 0.2, slot: 'detail' },
  ],
  motion: {
    flapAmplitude: 0.9,
    flapPhaseOffset: 0,
    squashFactor: 0.14,
    tiltResponse: 0.22,
    limbDriver: 'bar',
  },
  palette: { body: 0xf2c14e, accent: 0xe08b2f, detail: 0x2b2410 },
}

/**
 * The character the game's motion was always animating.
 *
 * Worth reading `gait.ts` next to this rig: the character rides the most recently
 * closed bar, then **leaps exactly one bar width** onto the next one along a
 * fixed-height arc. Discrete perches, a fixed jump, no hovering. That is a frog on
 * lilypads described precisely — Robin is the Flappy Bird lineage nod, but a bird flaps
 * and hovers rather than hopping perch to perch.
 *
 * Which is why this is the one rig using `limbDriver: 'hop'`. Legs that swept once per
 * bar would wave through the three quarters of it the frog spends sitting still; driven
 * by the arc they tuck on the perch and kick at the apex.
 *
 * Squat and wide, with the eyes above the body line — the roster's other three are all
 * a round body with things on top of it, so breaking that outline is most of what makes
 * this legible at 20px. `dy` on the body compensates for the low profile: without it a
 * flat body would float higher above the price line than Robin's does, since the rig
 * origin sits one radius up regardless of what is drawn there.
 */
export const frog: Character = {
  id: 'frog',
  displayName: 'Frog',
  rig: [
    // Far leg first, so the body draws over it and the two legs read as depth rather
    // than as one thick limb.
    { shape: 'triangle', dx: -0.4, dy: 0.12, width: 0.5, height: 0.28, slot: 'accent', rotation: 3.6, flaps: true },
    { shape: 'ellipse', dx: 0, dy: 0.18, width: 1.2, height: 0.62, slot: 'body' },
    { shape: 'triangle', dx: -0.3, dy: 0.34, width: 0.58, height: 0.3, slot: 'accent', rotation: 3.6, flaps: true },
    { shape: 'triangle', dx: 0.5, dy: 0.36, width: 0.3, height: 0.18, slot: 'accent', rotation: 0 },
    // Both eyes, bulging clear of the body's top edge. The rest of the roster shows one
    // eye in profile; a frog's two are the silhouette, so they are worth the exception.
    { shape: 'ellipse', dx: 0.16, dy: -0.26, width: 0.3, height: 0.3, slot: 'detail' },
    { shape: 'ellipse', dx: 0.46, dy: -0.22, width: 0.28, height: 0.28, slot: 'detail' },
  ],
  motion: {
    // Negative: the legs extend by rotating *back* toward horizontal from a tucked pose,
    // and the sign is what picks the direction. `flapPhaseOffset` is inert under `hop`.
    flapAmplitude: -0.75,
    flapPhaseOffset: 0,
    // The heaviest squash in the roster. Frogs compress flat and extend hugely, and this
    // is the one knob that expresses that inside a shared arc.
    squashFactor: 0.32,
    tiltResponse: 0.18,
    limbDriver: 'hop',
  },
  /**
   * A darker green than instinct suggests, and measured rather than picked: anything
   * lighter loses its footing against Jolly's pale lower sky, whose luma is 0.72. This
   * body sits at 0.58, which is the highest value that still clears every sky stop of
   * all five themes by a real margin. It is also well clear of Bull's mint in hue, which
   * matters because the roster picker is the one place two greens sit side by side.
   */
  palette: { body: 0x78b824, accent: 0x4e7a18, detail: 0x14260a },
}

export const bull: Character = {
  id: 'bull',
  displayName: 'Bull',
  rig: [
    { shape: 'ellipse', dx: 0, dy: 0.05, width: 1.05, height: 0.8, slot: 'body' },
    { shape: 'triangle', dx: 0.52, dy: -0.6, width: 0.4, height: 0.5, slot: 'accent', rotation: -0.5 },
    { shape: 'triangle', dx: 0.1, dy: -0.66, width: 0.34, height: 0.46, slot: 'accent', rotation: -0.2 },
    { shape: 'ellipse', dx: 0.4, dy: -0.16, width: 0.18, height: 0.18, slot: 'detail' },
  ],
  // Head dips on each bounce: a heavier tilt response rather than new animation.
  motion: {
    flapAmplitude: 0.28,
    flapPhaseOffset: 0.4,
    squashFactor: 0.1,
    tiltResponse: 0.4,
    // Inert: no part of this rig is flagged as a limb, so nothing consumes it. Declared
    // anyway, because leaving it out would make the field optional for everyone.
    limbDriver: 'bar',
  },
  palette: { body: 0x4ddb7a, accent: 0x2f9a55, detail: 0x10240f },
}

export const bear: Character = {
  id: 'bear',
  displayName: 'Bear',
  rig: [
    { shape: 'ellipse', dx: 0, dy: 0.02, width: 1.12, height: 0.98, slot: 'body' },
    { shape: 'ellipse', dx: -0.42, dy: -0.6, width: 0.32, height: 0.32, slot: 'accent' },
    { shape: 'ellipse', dx: 0.42, dy: -0.6, width: 0.32, height: 0.32, slot: 'accent' },
    { shape: 'ellipse', dx: 0.36, dy: -0.1, width: 0.2, height: 0.2, slot: 'detail' },
  ],
  // Weightier squash, so it lands differently from Robin without new code.
  motion: {
    flapAmplitude: 0.2,
    flapPhaseOffset: 0.7,
    squashFactor: 0.22,
    tiltResponse: 0.16,
    limbDriver: 'bar',
  },
  palette: { body: 0xff6b6b, accent: 0xc44a4a, detail: 0x2b1010 },
}

/**
 * The one deliberately tall silhouette, and the meme-stock nod.
 *
 * It points **up rather than forward**, which is the only rig here that does. Two
 * reasons, and the second is the better one: up is the joke, and a short position flips
 * the whole rig on the vertical axis, so shorting turns the rocket nose-down for free.
 * No second rig, no branch — the sign flip that already exists does it.
 *
 * The exhaust is the limb, driven by the hop, so the rocket visibly *fires* when it
 * jumps and is cold while it rides a bar. Rotation is the only transform a limb gets,
 * so what this actually produces is a jet that wobbles under thrust; that reads as
 * turbulence, where flapping the rigid fins would just look broken.
 */
export const rocket: Character = {
  id: 'rocket',
  displayName: 'Rocket',
  rig: [
    { shape: 'triangle', dx: -0.34, dy: 0.4, width: 0.42, height: 0.34, slot: 'accent', rotation: 3.5 },
    { shape: 'triangle', dx: 0.34, dy: 0.4, width: 0.42, height: 0.34, slot: 'accent', rotation: -0.35 },
    { shape: 'ellipse', dx: 0, dy: 0.05, width: 0.62, height: 1.15, slot: 'body' },
    // Apex rotated to point up. The nose is the whole silhouette, so it is generous.
    { shape: 'triangle', dx: 0, dy: -0.72, width: 0.5, height: 0.5, slot: 'accent', rotation: -1.5708 },
    // Apex down, reaching almost to the price line — so it looks like it is standing on
    // its own exhaust rather than hovering above the bar.
    { shape: 'triangle', dx: 0, dy: 0.78, width: 0.34, height: 0.44, slot: 'detail', rotation: 1.5708, flaps: true },
    { shape: 'ellipse', dx: 0, dy: -0.22, width: 0.26, height: 0.26, slot: 'detail' },
  ],
  motion: {
    flapAmplitude: 0.4,
    flapPhaseOffset: 0,
    // Lightest squash here: a metal tube should not deform on landing.
    squashFactor: 0.06,
    tiltResponse: 0.3,
    limbDriver: 'hop',
  },
  // Near-white, which is the highest-contrast body in the roster against every theme —
  // the tall thin silhouette has the least area to be seen by, so it gets the most
  // separation. The orange is shared between the porthole and the flame.
  palette: { body: 0xe6ecf2, accent: 0x8b98a8, detail: 0xff8b3d },
}

/**
 * The third distinct outline: mass low and back, a long tail, a small head held high.
 *
 * Chosen for the same reason as the frog. Bull and Bear are both a round body with two
 * things on top and differ only in whether those things are triangles or ellipses, so
 * they read almost identically at phone size. A leaning, tailed silhouette does not
 * collide with anything already here.
 *
 * Hops for a living, so its leg answers to the jump like the frog's.
 */
export const kangaroo: Character = {
  id: 'kangaroo',
  displayName: 'Kangaroo',
  rig: [
    // The tail, first so the body draws over its root.
    { shape: 'triangle', dx: -0.72, dy: 0.3, width: 0.8, height: 0.3, slot: 'accent', rotation: 3.25 },
    { shape: 'ellipse', dx: -0.05, dy: 0.05, width: 1, height: 0.82, slot: 'body' },
    { shape: 'triangle', dx: 0.38, dy: -0.76, width: 0.22, height: 0.34, slot: 'accent', rotation: -1.45 },
    { shape: 'triangle', dx: 0.56, dy: -0.78, width: 0.22, height: 0.32, slot: 'accent', rotation: -1.25 },
    { shape: 'ellipse', dx: 0.46, dy: -0.42, width: 0.44, height: 0.4, slot: 'body' },
    { shape: 'triangle', dx: -0.05, dy: 0.42, width: 0.62, height: 0.34, slot: 'accent', rotation: 3.55, flaps: true },
    { shape: 'ellipse', dx: 0.6, dy: -0.44, width: 0.16, height: 0.16, slot: 'detail' },
  ],
  motion: {
    flapAmplitude: -0.7,
    flapPhaseOffset: 0,
    squashFactor: 0.24,
    tiltResponse: 0.34,
    limbDriver: 'hop',
  },
  /**
   * Purple, which is not what a kangaroo looks like, and that is the trade.
   *
   * A naturalistic tan lands within 20° of Robin's gold, and body hue is what separates
   * one entry from another in the picker. The art direction here is geometric
   * silhouettes rather than illustration, so the outline carries the animal and the
   * colour is free to do the job the outline cannot.
   */
  palette: { body: 0xb07cc9, accent: 0x7a4f96, detail: 0x2a1830 },
}

/**
 * The stop marker, and **deliberately not in the roster below.**
 *
 * A hedgehog because a stop *is* a hedge, and because a spiky dome is the one
 * silhouette here that cannot be mistaken for the player at 20px on a phone — which
 * is the whole job. It rides the stop level rather than the ground, so the vertical
 * gap between the player and it is the risk being carried, readable without reading a
 * number.
 *
 * Kept out of `characters` on purpose: that array is what the settings screen offers,
 * and a marker the player could choose to *be* would be a confusing thing to ship. It
 * is a rig, not a roster entry, so it reuses `drawShape` and nothing else.
 *
 * The spines fan across the top rather than radiating evenly — a real hedgehog's
 * profile, and it keeps the underside flat so the shape sits on a level convincingly.
 */
export const hedgehog: Character = {
  id: 'hedgehog',
  displayName: 'Hedgehog',
  rig: [
    { shape: 'ellipse', dx: 0, dy: 0, width: 1, height: 0.78, slot: 'body' },
    // Five spines, leaning progressively back. `flaps` is left off: this rig has no
    // bounce phase driving it, so a flap offset would be motion from nowhere.
    { shape: 'triangle', dx: -0.5, dy: -0.42, width: 0.3, height: 0.42, slot: 'accent', rotation: -0.5 },
    { shape: 'triangle', dx: -0.24, dy: -0.56, width: 0.3, height: 0.5, slot: 'accent', rotation: -0.26 },
    { shape: 'triangle', dx: 0.02, dy: -0.6, width: 0.3, height: 0.54, slot: 'accent', rotation: 0 },
    { shape: 'triangle', dx: 0.28, dy: -0.54, width: 0.3, height: 0.48, slot: 'accent', rotation: 0.26 },
    { shape: 'triangle', dx: 0.52, dy: -0.4, width: 0.28, height: 0.4, slot: 'accent', rotation: 0.5 },
    // Snout and eye, forward — it faces the oncoming price.
    { shape: 'triangle', dx: 0.82, dy: 0.1, width: 0.34, height: 0.24, slot: 'body', rotation: 0 },
    { shape: 'ellipse', dx: 0.44, dy: -0.12, width: 0.16, height: 0.16, slot: 'detail' },
  ],
  // Unused by the marker, which is driven by the stop level rather than a gait, but
  // the shape of `Character` requires it and a sensible set costs nothing.
  motion: {
    flapAmplitude: 0,
    flapPhaseOffset: 0,
    squashFactor: 0.1,
    tiltResponse: 0.12,
    limbDriver: 'bar',
  },
  /**
   * **Greyscale on purpose — this rig is tinted, not coloured.**
   *
   * The marker has to be the same colour as its price tag on the axis, and tint is
   * multiplicative: a white body tinted with the tag colour comes out as exactly that
   * colour, where a brown one would come out muddy. Expressing the parts as *shades*
   * rather than hues also means the relationships survive any tint — the spines stay
   * about two thirds of the body's brightness and the eye stays dark, on a light theme
   * and a dark one alike, with no per-theme palette to maintain.
   *
   * The alternative was rebuilding a dozen `Graphics` whenever the colour changed. A
   * breach toggles rarely, but price oscillating around an advisory level would have
   * done it every bar for nothing.
   */
  palette: { body: 0xffffff, accent: 0xa8a8a8, detail: 0x2a2a2a },
}

/**
 * The roster, in the order the settings picker offers it.
 *
 * Robin stays first because it is the default (`character.selected`), and the frog sits
 * next to it because it is the entry that matches what the gait actually does. The rest
 * follow the order they were added.
 */
export const characters: readonly Character[] = [robin, frog, bull, bear, kangaroo, rocket]

export function character(id: string): Character {
  return characters.find((entry) => entry.id === id) ?? robin
}
