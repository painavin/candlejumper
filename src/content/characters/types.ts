/**
 * Characters are **primitive rigs animated by math**, not spritesheets.
 *
 * A character is a small tree of shapes plus the constants that drive its motion.
 * Animation states are functions of continuous game state rather than frame
 * sequences, which is genuinely better here than a spritesheet: squash responds
 * continuously to vertical speed instead of snapping between poses, and the short
 * position is a sign flip on the vertical axis rather than a second animation.
 *
 * Selection code always asks "what does the *currently selected* character supply
 * for state X" and never branches on id, so adding a character is a new rig
 * definition rather than an engine change.
 *
 * Deliberately decoupled from `visuals.theme`: one universal roster, so a player
 * keeps a favourite character across whichever mood they pick. Characters carry
 * their own palette so they stay readable against any background.
 */

export type ShapeKind = 'ellipse' | 'triangle' | 'arc'

export interface RigShape {
  shape: ShapeKind
  /** Offset from the rig origin, in body radii. */
  dx: number
  dy: number
  /** Size in body radii. */
  width: number
  height: number
  /** Which palette entry to fill with. */
  slot: 'body' | 'accent' | 'detail'
  /** Radians. */
  rotation?: number
  /**
   * Parts flagged as wings take the flap offset, so limb motion is a sine of
   * bounce phase rather than a keyframe.
   */
  flaps?: boolean
}

export interface CharacterMotion {
  /** Radians of wing/limb travel. */
  flapAmplitude: number
  flapPhaseOffset: number
  /** How strongly vertical speed squashes the body. */
  squashFactor: number
  /** How far the body tilts into the direction of travel. */
  tiltResponse: number
  /**
   * What drives the parts flagged `flaps` — the bar, or the jump.
   *
   * `bar` sweeps limbs through one sine per bar, so they move continuously whether or
   * not the character is mid-air. That is what a wing does, and it is why Robin uses it.
   *
   * `hop` drives them from the arc instead: still while riding a bar, extended at the
   * apex, still again on landing. A frog's legs kick when it jumps and are tucked the
   * rest of the time, and one sine per bar cannot express that — it would wave the legs
   * through the three quarters of every bar the character spends standing still.
   *
   * `flapPhaseOffset` is ignored under `hop`; the arc has no phase to slide, which is
   * the point of it.
   *
   * Both are **cosmetic only**. This picks what rotates a limb, never the gait, the
   * hitbox, or the bounce cadence — those stay identical across the roster.
   */
  limbDriver: 'bar' | 'hop'
}

export interface Character {
  id: string
  displayName: string
  rig: RigShape[]
  motion: CharacterMotion
  palette: { body: number; accent: number; detail: number }
}
