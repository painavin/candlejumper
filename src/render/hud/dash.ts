/**
 * Breaking a polyline into dash segments.
 *
 * Its own module, and pure, because the arithmetic is the part that can be wrong: the
 * first version computed the *gap* step as `off - phase` instead of `period - phase`,
 * which goes negative the moment a dash ends mid-segment — walking backwards forever
 * and hanging the frame. A pixel-space walk over a Pixi `Graphics` cannot be asserted
 * on; a list of segments can.
 */

export interface Point {
  x: number
  y: number
}

export interface DashPattern {
  /** Drawn length, in pixels. */
  on: number
  /** Skipped length, in pixels. */
  off: number
}

export interface DashSegment {
  from: Point
  to: Point
}

/**
 * Walk `points` in order, returning the parts that should be drawn.
 *
 * Phase is carried **across** points rather than restarted at each one, so the rhythm
 * stays even where bars are narrow — restarting per segment would put a dash on every
 * single bar and make the line look solid at the exact zoom where dashing matters.
 *
 * Fewer than two points yields nothing: a dash needs a direction, and a single point
 * has none.
 */
export function dashSegments(
  points: readonly Point[],
  pattern: DashPattern
): DashSegment[] {
  const period = pattern.on + pattern.off
  if (points.length < 2 || pattern.on <= 0 || period <= 0) return []

  const segments: DashSegment[] = []
  let carried = 0

  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1] as Point
    const to = points[index] as Point
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    // Coincident points contribute no length and must not advance the phase, or a
    // repeated value would shift the rhythm without drawing anything.
    if (length === 0) continue

    let travelled = 0
    while (travelled < length) {
      const phase = (carried + travelled) % period
      const drawing = phase < pattern.on
      // The remaining length of the *current* part of the pattern. For a gap that is
      // `period - phase`, not `off - phase` — the phase is measured from the start of
      // the period, not from the start of the gap.
      const remaining = drawing ? pattern.on - phase : period - phase
      const step = Math.min(length - travelled, remaining)
      if (drawing) {
        const start = travelled / length
        const end = (travelled + step) / length
        segments.push({
          from: { x: from.x + dx * start, y: from.y + dy * start },
          to: { x: from.x + dx * end, y: from.y + dy * end },
        })
      }
      travelled += step
    }
    carried = (carried + length) % period
  }

  return segments
}
