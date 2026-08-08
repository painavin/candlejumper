import { Container, Graphics, Text } from 'pixi.js'
import { hedgehog } from '@content/characters/index.js'
import type { VisualTheme } from '@content/visualThemes/types.js'
import type { FrameState, StopLine } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'
import { AXIS_WIDTH, unitToY } from '../stage/layout.js'
import { drawShape } from '../character/characterLayer.js'
import { hudDimTextStyle } from './hudText.js'
import {
  isRatchet,
  leaderStartX,
  markerRadius,
  markerX,
  stopColour,
  visibleStops,
} from './stopMarker.js'

/**
 * Stop levels, drawn as a **hedgehog riding the level** rather than a line across the
 * chart.
 *
 * A full-width rule was the first version and it striped the whole picture, including
 * the quarter of the chart right of the character where there are no bars at all. What
 * the line was *for* — watching a level approach, and comparing it against the candles —
 * survives here as a marker plus a short dashed leader; what it cost was everything else.
 *
 * A hedgehog because a stop is a hedge, and because a spiky dome cannot be mistaken for
 * the player at 20px on a phone. It rides in the empty strip right of the character, so
 * the vertical gap between bird and hedgehog *is* the risk being carried — no number
 * needed to read it, and the gap visibly closes as a trailing stop ratchets.
 *
 * **Enforcing draws solid; advisory draws as a ghost.** The player must never be unsure
 * whether a level will actually save them — that ambiguity is the one thing this layer
 * exists to prevent, and it is why the difference is fill versus outline rather than a
 * shade. See docs/hud.md#top-hud.
 *
 * The level's *number* is not here. It goes on the price axis, where every other price
 * already lives, so the marker carries identity and the axis carries value.
 */

export interface StopLinesLayer {
  container: Container
  draw(frame: FrameState, layout: Layout): void
}

/** Dash geometry for the leader, matching the axis gridlines' weight. */
const DASH = 7
const GAP = 5

/** Seconds a hop or a curl lasts. Long enough to notice, short enough not to nag. */
const GESTURE_SECONDS = 0.42

/** Peak hop height, in marker radii. */
const HOP_HEIGHT = 0.9

/** How much of its own height a curled hedgehog loses as the spines tuck in. */
const CURL_TUCK = 0.62

/**
 * One marker's worth of Pixi objects, pooled across frames.
 *
 * Rebuilt only when the radius changes — a rig is a dozen `Graphics` and rebuilding it
 * every frame is the trap that makes procedural rendering look expensive. The player's
 * own rig is rebuilt on the same rule.
 */
interface Marker {
  container: Container
  rig: Container
  label: Text
  builtRadius: number
  /** Level last seen, for ratchet detection. */
  previousLevel: number | undefined
  /** Seconds remaining of the current gesture, and which one it is. */
  gesture: 'hop' | 'curl' | 'none'
  gestureLeft: number
}

export function createStopLinesLayer(
  enabled: boolean,
  theme: VisualTheme,
  reducedMotion: boolean
): StopLinesLayer {
  const container = new Container()
  const leaders = new Graphics()
  container.addChild(leaders)

  const markers: Marker[] = []

  const build = (marker: Marker, radius: number): void => {
    marker.rig.removeChildren().forEach((child) => child.destroy({ children: true }))
    for (const shape of hedgehog.rig) {
      const graphics = drawShape(shape, radius, hedgehog)
      graphics.position.set(shape.dx * radius, shape.dy * radius)
      marker.rig.addChild(graphics)
    }
    marker.builtRadius = radius
  }

  /**
   * Advisory renders as a ghost: the *same* rig at low alpha, never a different shape.
   *
   * A silhouette change would say "this is a different kind of level", when the only
   * difference is whether it acts on its own. Alpha says "present but insubstantial",
   * which is exactly what an advisory stop is.
   *
   * Set per frame rather than at build time, because a marker *slot* can change kind:
   * remove an enforcing stop and the advisory one moves up into slot 0, reusing the
   * pooled rig. Baking this into the build would have left it solid.
   */
  const GHOST_ALPHA = 0.42

  return {
    container,

    draw(frame, layout) {
      leaders.clear()
      container.visible = enabled
      if (!enabled) return

      const shown = visibleStops(frame.stopLines)
      const radius = markerRadius(layout)
      const x = markerX(layout, AXIS_WIDTH)
      const leaderFrom = leaderStartX(layout, AXIS_WIDTH)
      // Seconds since the last frame is not passed to this layer, and adding it would
      // change the signature for one animation. The gesture is short and the tick is
      // fixed-ish, so counting frames at an assumed 60Hz is close enough for a hop.
      const dt = 1 / 60

      shown.forEach((line: StopLine, index) => {
        let marker = markers[index]
        if (!marker) {
          const markerContainer = new Container()
          const rig = new Container()
          const label = new Text({ text: '', style: hudDimTextStyle(theme, 11) })
          label.anchor.set(0, 0.5)
          markerContainer.addChild(rig)
          container.addChild(markerContainer, label)
          marker = {
            container: markerContainer,
            rig,
            label,
            builtRadius: 0,
            previousLevel: undefined,
            gesture: 'none',
            gestureLeft: 0,
          }
          markers.push(marker)
        }

        if (marker.builtRadius !== radius) build(marker, radius)
        marker.rig.alpha = line.advisory ? GHOST_ALPHA : 1

        /**
         * A stop-out is the hedgehog's whole reason to exist, so it outranks a ratchet.
         *
         * Checked before the ratchet so the two cannot fire together and cancel: being
         * ejected and the level having improved in the same bar is possible, and the
         * ejection is the one worth showing.
         */
        if (frame.hud.stoppedOutThisBar) {
          marker.gesture = 'curl'
          marker.gestureLeft = GESTURE_SECONDS
        } else if (isRatchet(marker.previousLevel, line.level, frame.hud.direction)) {
          marker.gesture = 'hop'
          marker.gestureLeft = GESTURE_SECONDS
        }
        marker.previousLevel = line.level

        if (marker.gestureLeft > 0) marker.gestureLeft = Math.max(0, marker.gestureLeft - dt)
        // Under reduced motion the gestures are recorded but never drawn: the state still
        // shows through colour, and a hop is exactly the kind of unrequested movement the
        // setting exists to suppress.
        const phase = reducedMotion ? 0 : 1 - marker.gestureLeft / GESTURE_SECONDS
        const active = marker.gestureLeft > 0 && !reducedMotion

        const y = unitToY(line.unit, layout)
        // A single arc up and back down. `sin` rather than a parabola because it leaves
        // and lands at zero velocity, which reads as a hop rather than a bounce.
        const lift = active && marker.gesture === 'hop' ? Math.sin(phase * Math.PI) * radius * HOP_HEIGHT : 0
        marker.container.position.set(x, y - lift)

        // Curling squashes the rig toward its base: spines tuck, the silhouette rounds.
        const curl = active && marker.gesture === 'curl' ? Math.sin(phase * Math.PI) : 0
        marker.rig.scale.set(1 + curl * 0.14, 1 - curl * CURL_TUCK)

        /**
         * The rig is greyscale, so the tint *is* the colour — the same value the price
         * tag on the axis is filled with, from `stopColour`, so the two cannot drift.
         *
         * Tint multiplies, which is what makes this work: a white body comes out as
         * exactly the tag's colour, and the spines and the eye keep their relative
         * darkness for free on any theme.
         */
        const colour = stopColour(line, theme)
        marker.rig.tint = colour

        // The dashed leader: a few bar widths only, so the newest candles can be compared
        // against the level without striping the history to do it.
        for (let dash = leaderFrom; dash < x - radius; dash += DASH + GAP) {
          const width = Math.min(DASH, x - radius - dash)
          if (width <= 0) break
          leaders
            .rect(dash, y - 0.75, width, 1.5)
            .fill({ color: colour, alpha: 0.8 })
        }

        // Only the advisory marker is labelled, and only with that one word — the number
        // is on the axis and the plugin's name is in the top HUD.
        marker.label.text = line.advisory ? 'advisory' : ''
        marker.label.visible = line.advisory
        marker.label.position.set(x + radius * 1.5, y - lift)
        marker.container.visible = true
      })

      for (let i = shown.length; i < markers.length; i++) {
        const marker = markers[i]
        if (!marker) continue
        marker.container.visible = false
        marker.label.visible = false
        // Forget the level, so re-opening a position does not read as a ratchet.
        marker.previousLevel = undefined
        marker.gestureLeft = 0
      }
    },
  }
}
