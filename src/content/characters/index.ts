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
 * the frog is wide and low, the rocket is tall and thin, the squirrel carries its mass
 * above the body.
 *
 * And every part of a rig must **touch** another part. Appendages used to be placed by
 * `dy` as though a body's top edge were flat, which floats them where the ellipse curves
 * away — Bull's horns read as a bow tie and Robin's beak hung off its face. `roster.test.ts`
 * asserts connectivity now, so that class of mistake cannot ship again.
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
    // Pulled in from 0.86. The beak's base sat at x 0.66 while the body ends at 0.5, so it
    // hovered 0.16 radii off the face — the same floating-appendage bug as Bull's horns,
    // in the default character, and visible in the first render of the roster.
    { shape: 'triangle', dx: 0.62, dy: 0.04, width: 0.4, height: 0.26, slot: 'accent', rotation: 0 },
    // Nudged in from 0.34,-0.22, where part of the eye sat outside the body and so put
    // near-black against the sky — the same fault that cost the frog its eyes, just
    // smaller. Visually indistinguishable; measurably enclosed.
    { shape: 'ellipse', dx: 0.3, dy: -0.18, width: 0.2, height: 0.2, slot: 'detail' },
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
    /**
     * A **haunch**, not a leg triangle.
     *
     * The first version pointed two big triangles back and down, and rendered they read
     * as fins — a wide green thing with a tail. One triangle cannot bend, and a frog's
     * leg is all bend: haunch up and back, foot forward. So the haunch is an ellipse
     * behind the body, drawn first so the body covers its root and only the bump over the
     * back shows, and the foot is a small triangle beneath it.
     */
    { shape: 'ellipse', dx: -0.34, dy: 0.14, width: 0.52, height: 0.5, slot: 'accent' },
    { shape: 'ellipse', dx: 0, dy: 0.18, width: 1.2, height: 0.62, slot: 'body' },
    // The hind foot, and the only animated part: it extends back on the jump and tucks
    // under the haunch while riding. Small, so it cannot be mistaken for a tail.
    { shape: 'triangle', dx: -0.3, dy: 0.38, width: 0.42, height: 0.22, slot: 'accent', rotation: 2.7, flaps: true },
    { shape: 'triangle', dx: 0.46, dy: 0.32, width: 0.3, height: 0.18, slot: 'accent', rotation: 0.15 },
    /**
     * Both eyes, bulging clear of the body's top edge — the rest of the roster shows one
     * eye in profile, but a frog's two are the silhouette, and rendered they are the thing
     * that makes it read as a frog at all.
     *
     * **Each eye is a body-coloured dome with the dark pupil inside it**, and that split
     * is the whole point. A single dark eye crossing the outline puts near-black against
     * the *sky*, and only the body colour is measured against skies: at luma 0.115 the
     * pupil was within 0.04 of the top of Serious, Neon and Vapour and the bottom of
     * Cobalt, so on four of the five themes the bulges dissolved and the frog lost its
     * eyes. The dome inherits the body's guaranteed contrast, and the pupil never touches
     * sky because it sits inside the dome.
     */
    { shape: 'ellipse', dx: 0.12, dy: -0.24, width: 0.3, height: 0.3, slot: 'body' },
    { shape: 'ellipse', dx: 0.13, dy: -0.25, width: 0.15, height: 0.15, slot: 'detail' },
    { shape: 'ellipse', dx: 0.38, dy: -0.17, width: 0.28, height: 0.28, slot: 'body' },
    { shape: 'ellipse', dx: 0.39, dy: -0.18, width: 0.14, height: 0.14, slot: 'detail' },
  ],
  motion: {
    // Positive here: the foot extends by rotating *back* past horizontal from its tucked
    // pose, and the sign is what picks the direction. `flapPhaseOffset` is inert under
    // `hop`.
    flapAmplitude: 0.6,
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
    // Horns pulled inward from ±0.52 to where the body's shoulder is still high enough to
    // meet them. They used to float 0.6 radii clear of the body and read as a bow tie —
    // an ellipse curves away fast, and `dy` alone cannot see that. `roster.test.ts`
    // asserts every part touches another so this cannot come back.
    { shape: 'triangle', dx: 0.34, dy: -0.52, width: 0.4, height: 0.5, slot: 'accent', rotation: -0.5 },
    { shape: 'triangle', dx: 0.02, dy: -0.56, width: 0.34, height: 0.46, slot: 'accent', rotation: -0.2 },
    // Nudged in from 0.4,-0.16: nine of its sample points sat outside the body, putting
    // near-black against the sky. 0.057 radii of movement, measurably enclosed.
    { shape: 'ellipse', dx: 0.36, dy: -0.12, width: 0.18, height: 0.18, slot: 'detail' },
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
    // Same fix as Bull's horns, and closer together is also what a bear's ears actually
    // are. At ±0.42 the body's surface was at −0.304 and the ear's underside at −0.44.
    { shape: 'ellipse', dx: -0.31, dy: -0.5, width: 0.32, height: 0.32, slot: 'accent' },
    { shape: 'ellipse', dx: 0.31, dy: -0.5, width: 0.32, height: 0.32, slot: 'accent' },
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
    // Apex up, and **narrowed and lowered** so its base is flush with the fuselage. At
    // half-width 0.25 based at y −0.47 the corners hung 0.18 radii clear of a body whose
    // surface there is only −0.29, which read as an unseated cone. Half-width 0.22 based
    // at −0.38 sits on the hull.
    { shape: 'triangle', dx: 0, dy: -0.6, width: 0.5, height: 0.44, slot: 'accent', rotation: -1.5708 },
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
 * The third distinct outline: **mass above the body**, which nothing else here has.
 *
 * This slot was a kangaroo first, and rendered it read as a purple bird — a blob with a
 * thin tail out the back, a small round head and two wedges too small to be ears. A
 * kangaroo's read depends on proportion detail that three primitives at 46px do not
 * carry.
 *
 * A squirrel carries at that size because its identifying feature is enormous and
 * singular: a bushy tail arcing up over the back. Every other rig in the roster keeps its
 * silhouette at or below the body line, so height *behind* the body is an outline nobody
 * else can be confused with — which is the whole selection criterion here.
 *
 * The tail takes the `body` slot rather than the torso, because the tail is the larger
 * area and the one that has to survive being seen against a sky.
 */
export const squirrel: Character = {
  id: 'squirrel',
  displayName: 'Squirrel',
  rig: [
    // The tail: one tall ellipse leaned over the back. Drawn first, so the torso covers
    // its root and it reads as attached rather than as a balloon on a string.
    { shape: 'ellipse', dx: -0.42, dy: -0.22, width: 0.46, height: 0.98, slot: 'body', rotation: -0.5 },
    { shape: 'ellipse', dx: 0.04, dy: 0.22, width: 0.82, height: 0.72, slot: 'accent' },
    { shape: 'ellipse', dx: 0.42, dy: -0.16, width: 0.44, height: 0.42, slot: 'accent' },
    // Ear, seated into the head rather than perched above it.
    { shape: 'triangle', dx: 0.42, dy: -0.42, width: 0.26, height: 0.22, slot: 'body', rotation: -1.5708 },
    // Hind foot, tucked while riding and kicking back at the apex of a jump.
    { shape: 'triangle', dx: -0.02, dy: 0.5, width: 0.4, height: 0.2, slot: 'body', rotation: 2.8, flaps: true },
    { shape: 'ellipse', dx: 0.54, dy: -0.2, width: 0.15, height: 0.15, slot: 'detail' },
  ],
  motion: {
    flapAmplitude: 0.55,
    flapPhaseOffset: 0,
    squashFactor: 0.26,
    tiltResponse: 0.3,
    limbDriver: 'hop',
  },
  /**
   * Purple, which is not what a squirrel looks like, and that is the trade.
   *
   * A naturalistic red-brown lands within 20° of Robin's gold and within 30° of Bear's
   * coral, and body hue is what separates one entry from another in the picker. Grey was
   * the other honest option and collides with the Rocket. The art direction here is
   * geometric silhouettes rather than illustration, so the outline carries the animal and
   * the colour is free to do the job the outline cannot.
   *
   * `body` is the *lighter* value here, unlike the rest of the roster, because it is the
   * tail — a bushy tail catching light over a darker torso, and the tail is what needs
   * the contrast against a sky.
   */
  palette: { body: 0xb07cc9, accent: 0x7a4f96, detail: 0x241030 },
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
    // Snout and eye, forward — it faces the oncoming price. The snout is at 0.62 rather
    // than 0.82 because at 0.82 its base sat beyond the body's edge and it floated, the
    // same bug the roster's connectivity test caught in Robin's beak and Bull's horns.
    { shape: 'triangle', dx: 0.62, dy: 0.1, width: 0.34, height: 0.24, slot: 'body', rotation: 0 },
    // Enclosed, for the same reason as every other eye here — and it matters more for the
    // marker, whose rig is tinted with the stop colour rather than drawn in its own palette.
    { shape: 'ellipse', dx: 0.4, dy: -0.09, width: 0.16, height: 0.16, slot: 'detail' },
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
export const characters: readonly Character[] = [robin, frog, bull, bear, squirrel, rocket]

export function character(id: string): Character {
  return characters.find((entry) => entry.id === id) ?? robin
}
