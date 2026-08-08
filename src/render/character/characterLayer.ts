import { Container, Graphics, Text } from 'pixi.js'
import type { Character, RigShape } from '@content/characters/types.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { FrameState } from '@engine/output/index.js'
import { arc } from '@shared/math/index.js'
import type { Layout } from '../stage/layout.js'
import { unitToY } from '../stage/layout.js'
import { hudTextStyle } from '../hud/hudText.js'
import { gaitOf } from './gait.js'

/**
 * The character: a primitive rig animated by transform maths.
 *
 * Drawn live each frame rather than baked — the one exception to the bake-once
 * rule, because the animation *is* the transform maths. It's a handful of
 * primitives, so this is cheap.
 *
 * Three behaviours, all continuous functions of game state:
 *
 *   - **Waiting** (flat): grounded with a slow idle bob. Bars scroll past and the
 *     character ignores them.
 *   - **Active long**: bounces along the **closing line** — each bar's close, which
 *     is the price the game fills at. Bars float, so there's no solid surface
 *     underfoot; what it rides is the price it would trade at, which is the honest
 *     thing for it to be standing on.
 *   - **Active short**: the same bounce with a **sign flip on the vertical axis**,
 *     suspended beneath the line — so direction is readable at a glance without
 *     looking at the HUD. Free, not a second animation.
 *
 * **The hop is fixed-height with a variable landing.** An arc scaled to the height
 * difference would need the next bar's price before jumping, which is exactly the
 * future information the no-lookahead constraint forbids. The standard auto-runner
 * solution and the only causally legal one coincide.
 *
 * **Where and when it moves lives in `gait.ts`**, which is pure and tested. Everything
 * here is the rig: which shapes, what colour, how they squash and flap. The one thing
 * worth knowing from the other file is that the character is *not* pinned at
 * `characterX` — it rides the bar it stands on, and `characterX` is the line it arrives
 * at.
 */

export interface CharacterLayer {
  container: Container
  /** Afterimage behind the character. Added to the scene below `container`. */
  trail: Graphics
  draw(frame: FrameState, layout: Layout, elapsed: number): void
}

/** Ghosts stay countable: beyond this a large position becomes a badge, not a smear. */
const MAX_GHOSTS = 5

/**
 * Trail samples kept while in a position.
 *
 * The trail is **only** drawn while holding something, which makes it information
 * rather than decoration: "I am exposed right now" is legible from the character
 * alone, without reading the HUD. Short enough that it reads as motion blur instead
 * of a comet.
 */
const TRAIL_LENGTH = 7

export interface CharacterLayerOptions {
  character: Character
  /** Supplies the HUD outline colour for the unit-count badge. */
  theme: VisualTheme
  /** Reduced motion damps the bounce and the idle fidget. */
  reducedMotion: boolean
}

export function createCharacterLayer({
  character,
  theme,
  reducedMotion,
}: CharacterLayerOptions): CharacterLayer {
  const container = new Container()
  const ghostLayer = new Container()
  const rig = new Container()
  const badge = new Text({ text: '', style: hudTextStyle({ theme, size: 12 }) })
  badge.anchor.set(0.5, 0.5)
  container.addChild(ghostLayer, rig, badge)

  /**
   * The trail lives *outside* `container`, because `container` is the thing being
   * moved, scaled, and rotated each frame — a child would inherit all of that and
   * smear instead of trailing. Its own container in screen space is the only way the
   * afterimage stays where the character *was*.
   */
  const trailLayer = new Graphics()
  const trail: { x: number; y: number }[] = []

  /** Wing parts are tracked separately so the flap is a sine, not a keyframe. */
  const wings: Graphics[] = []
  const ghosts: Container[] = []
  let builtRadius = 0

  const buildRig = (target: Container, radius: number, collectWings: boolean): void => {
    target.removeChildren()
    if (collectWings) wings.length = 0

    for (const shape of character.rig) {
      const graphics = drawShape(shape, radius, character)
      graphics.position.set(shape.dx * radius, shape.dy * radius)
      if (shape.rotation) graphics.rotation = shape.rotation
      target.addChild(graphics)
      if (collectWings && shape.flaps) wings.push(graphics)
    }
  }

  return {
    container,
    trail: trailLayer,

    draw(frame, layout, elapsed) {
      const newest = frame.bars.find((visible) => visible.age === 0)
      if (!newest) {
        container.visible = false
        trailLayer.clear()
        return
      }
      container.visible = true

      const radius = Math.max(7, Math.min(layout.barWidth * 1.1, layout.chartHeight * 0.04))
      if (radius !== builtRadius) {
        builtRadius = radius
        buildRig(rig, radius, true)
        for (const ghost of ghosts) buildRig(ghost, radius, false)
      }

      const short = frame.hud.direction === 'short'
      const flat = frame.hud.direction === 'flat'
      const motion = character.motion
      const damp = reducedMotion ? 0.35 : 1

      if (flat) {
        // Grounded and ignoring the chart, with a small idle fidget so it reads as
        // alive rather than parked.
        const bob = Math.sin(elapsed * 2.2) * radius * 0.1 * damp
        container.position.set(layout.characterX, layout.groundY - radius + bob)
        container.scale.set(1, 1)
        container.rotation = 0
        ghostLayer.visible = false
        badge.visible = false
        flap(Math.sin(elapsed * 1.6) * 0.25 * motion.flapAmplitude * damp)
        // Flat means not exposed, so no trail — and the history is dropped rather
        // than frozen, so re-entering doesn't smear from where the last trade ended.
        trail.length = 0
        trailLayer.clear()
        return
      }

      const offset = short ? radius : -radius
      const gait = gaitOf({
        barPhase: frame.barPhase,
        previousUnit: frame.previousUnit,
        newestUnit: newest.unit,
      })
      // The arc lifts away from the line in the direction the character is on: a short
      // hangs beneath it, so "up" for a short is down the screen.
      const lift = gait.liftInBarWidths * layout.barWidth * damp * (short ? 1 : -1)

      container.position.set(
        // Riding the bar it stands on, by the same arithmetic `candle.ts` positions that
        // bar with — so the two cannot drift apart.
        layout.characterX - gait.barsBehind * layout.barWidth,
        unitToY(gait.unit, layout) + offset + lift
      )

      // Squash and stretch derived from the arc rather than keyframed, so it
      // responds continuously to speed. Per-character `squashFactor` is what makes
      // Bear land heavier than Robin without any new code.
      const stretch = 1 + arc(gait.hop) * motion.squashFactor * damp
      container.scale.set(1 / stretch, (short ? -1 : 1) * stretch)
      // Tilt into the direction of travel. Measured from the two perches rather than from
      // the position, which the arc dominates.
      const climb = unitToY(newest.unit, layout) - unitToY(frame.previousUnit ?? newest.unit, layout)
      container.rotation = climb * 0.0016 * motion.tiltResponse * damp * (short ? -1 : 1)

      flap(Math.sin((frame.barPhase + motion.flapPhaseOffset) * Math.PI * 2) * motion.flapAmplitude * damp)
      // Ghost stack: one translucent copy per open unit, so "I'm three deep" reads
      // at a glance and countably. Costs nothing per roster addition, since a ghost
      // is the same rig at reduced alpha.
      const units = frame.hud.unitCount
      const shown = Math.min(units, MAX_GHOSTS)
      ghostLayer.visible = shown > 1

      while (ghosts.length < MAX_GHOSTS) {
        const ghost = new Container()
        buildRig(ghost, radius, false)
        ghosts.push(ghost)
        ghostLayer.addChild(ghost)
      }
      ghosts.forEach((ghost, index) => {
        const rank = index + 1
        ghost.visible = rank < shown
        if (!ghost.visible) return
        ghost.position.set(-rank * radius * 1.2, 0)
        ghost.alpha = 0.48 - rank * 0.07
      })

      badge.visible = units > MAX_GHOSTS
      badge.text = `${units}u`
      badge.position.set(-radius * 6.6, 0)
      badge.scale.set(1, short ? -1 : 1)

      drawTrail(container.position.x, container.position.y, radius)
    },
  }

  function flap(angle: number): void {
    for (const wing of wings) wing.rotation = angle
  }

  function drawTrail(x: number, y: number, radius: number): void {
    trailLayer.clear()
    if (reducedMotion) return

    trail.push({ x, y })
    if (trail.length > TRAIL_LENGTH) trail.shift()

    // Oldest first, so newer samples draw over older ones and the gradient reads in
    // the right direction.
    trail.forEach((sample, index) => {
      const t = (index + 1) / trail.length
      trailLayer
        .circle(sample.x, sample.y, radius * 0.55 * t)
        .fill({ color: character.palette.body, alpha: 0.16 * t })
    })
  }
}

/**
 * One rig primitive, filled from the character's own palette.
 *
 * Exported so the stop marker can reuse it rather than growing a second rig renderer —
 * two of those would drift, and the point of a rig being data is that anything can draw
 * it. It takes a whole `Character` for the palette, which is why the marker's hedgehog
 * is a `Character` too despite never being playable.
 */
export function drawShape(shape: RigShape, radius: number, character: Character): Graphics {
  const graphics = new Graphics()
  const colour = character.palette[shape.slot]
  const w = shape.width * radius
  const h = shape.height * radius

  switch (shape.shape) {
    case 'ellipse':
      graphics.ellipse(0, 0, w / 2, h / 2).fill(colour)
      break
    case 'triangle':
      graphics.poly([-w / 2, h / 2, w / 2, 0, -w / 2, -h / 2]).fill(colour)
      break
    case 'arc':
      // A wing: a half-ellipse hinged at its inner edge, so rotation reads as a flap.
      graphics.ellipse(w / 2, 0, w / 2, h / 2).fill(colour)
      graphics.pivot.set(w / 2, 0)
      break
  }

  return graphics
}
