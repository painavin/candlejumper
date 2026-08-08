import type { VisualTheme } from '@content/visualThemes/types.js'
import type { PositionDirection, StopLine } from '@engine/output/index.js'
import type { Layout } from '../stage/layout.js'

/**
 * The arithmetic behind the stop markers, kept out of the layer that draws them.
 *
 * `stopLines.ts` needs a live renderer and so cannot be tested at all. Everything here
 * has a right and a wrong answer — which stops to show, where the marker sits, whether
 * a level ratcheted — so it lives on this side of the line, the same split as
 * `candle.ts` against `poleLayer.ts` and `axis.ts` against `axisLayer.ts`.
 *
 * That split is not theoretical for this layer: the foreground strip shipped anchored
 * to the wrong edge for months precisely because its one line of arithmetic lived in a
 * file no test could reach.
 */

/**
 * How many markers may be on screen at once.
 *
 * Two, because the documented reason to stack stops is a hard stop under a trailing
 * one, and a third marker at the same x would pile up into an unreadable smear. The
 * shipped default is a single advisory stop, so this bites rarely.
 */
export const MAX_MARKERS = 2

/**
 * Marker radius as a fraction of the player's.
 *
 * Smaller than the player on purpose. The player is the subject and the marker is a
 * reading off the instrument; equal sizes make the chart look like it has two
 * protagonists.
 */
const MARKER_SCALE = 0.7

/**
 * How far right of the character the marker sits, in its own radii.
 *
 * Enough clearance that the two never overlap when a stop level coincides with the
 * player's height, which happens whenever price approaches the stop — exactly the
 * moment the marker most needs to be legible.
 */
const MARKER_GAP = 1.9

/** Length of the dashed leader reaching left from the marker, in bar widths. */
const LEADER_BARS = 3

/**
 * Which stops get a marker, most important first.
 *
 * **Enforcing before advisory**, always. An enforcing stop is the one that will
 * actually close the position, so if only one can be shown it must never be the one
 * dropped — a player who cannot see the level that will eject them is worse off than
 * one who cannot see a level they were only asked to respect.
 *
 * Order within a group is left as the engine gave it, which is the order the stops were
 * configured. Stable, and not something to invent a rule for.
 */
export function visibleStops(lines: readonly StopLine[]): readonly StopLine[] {
  const enforcing = lines.filter((line) => !line.advisory)
  const advisory = lines.filter((line) => line.advisory)
  return [...enforcing, ...advisory].slice(0, MAX_MARKERS)
}

/** Marker radius in pixels, derived from the same layout terms the player uses. */
export function markerRadius(layout: Layout): number {
  const player = Math.max(7, Math.min(layout.barWidth * 1.1, layout.chartHeight * 0.04))
  return player * MARKER_SCALE
}

/**
 * Marker centre x.
 *
 * In the empty strip right of the character, which is the one region of the chart with
 * no bars in it — so a marker there occludes nothing, and the full-width line it
 * replaces is the thing that used to cross that emptiness for no reason.
 *
 * Clamped so it cannot slide under the price axis on a narrow viewport, where the strip
 * is only a few dozen pixels wide.
 */
export function markerX(layout: Layout, axisWidth: number): number {
  const radius = markerRadius(layout)
  const wanted = layout.characterX + radius * MARKER_GAP
  const rightmost = layout.width - axisWidth - radius * 1.15
  return Math.min(wanted, Math.max(layout.characterX, rightmost))
}

/**
 * Where the dashed leader starts, to the marker's left.
 *
 * A few bar widths only. The point is to let the newest candles be compared against the
 * level — which is the part of a full-width line worth keeping — without striping the
 * whole history to do it.
 */
export function leaderStartX(layout: Layout, axisWidth: number): number {
  const from = markerX(layout, axisWidth) - markerRadius(layout) - layout.barWidth * LEADER_BARS
  return Math.max(0, from)
}

/**
 * Did this level move in the position's favour since the last frame?
 *
 * A ratchet is the trailing stop's defining behaviour and the only level change worth
 * animating — it moves a little on most bars, so hopping per change would be a twitch
 * rather than a gesture.
 *
 * Direction-aware, because favour is signed: a long's stop ratchets **up** and a short's
 * ratchets **down**. Getting this backwards would celebrate the level drifting against
 * the player, which is the opposite of the lesson.
 *
 * `flat` never ratchets — there is no position for a level to protect, and the engine
 * reports no stop lines at all when flat.
 */
export function isRatchet(
  previous: number | undefined,
  level: number,
  direction: PositionDirection
): boolean {
  if (previous === undefined || !Number.isFinite(previous) || !Number.isFinite(level)) return false
  if (direction === 'long') return level > previous
  if (direction === 'short') return level < previous
  return false
}

/**
 * The colour a stop is drawn in — marker, leader and axis tag alike.
 *
 * One function rather than the rule written out in each place, because "the hedgehog
 * matches its price tag" is a promise that two copies of an expression cannot keep. The
 * marker is a tint over a greyscale rig and the tag is a plate fill, so they arrive at
 * the colour by different routes; the *value* has to come from one.
 *
 * A breached advisory level takes the accent. The player is past their own rule and this
 * is the only thing saying so — but it stays the same shape, because recolouring says
 * "attend to this" where a new silhouette would say "this is now enforcing", which is
 * a lie.
 *
 * Enforcing and advisory share a colour deliberately. That distinction is carried by
 * fill versus outline and solid versus ghost, which survives being 20px on a phone in
 * a way that two shades of the same hue does not.
 */
export function stopColour(line: StopLine, theme: VisualTheme): number {
  return line.breached ? theme.accent.accent : theme.accent.dim
}
