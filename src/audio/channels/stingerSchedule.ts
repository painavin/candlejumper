/**
 * When a stinger's notes get scheduled — arithmetic only, no Tone.
 *
 * Split out for the same reason `mix.ts` and `voicing.ts` are: Tone.js needs a real
 * `AudioContext`, so `stingers.ts` can't be unit-tested, and the part that had the
 * bug is the part that can be.
 *
 * ## The bug this exists to prevent
 *
 * Stinger voices are **monophonic and reused** — one `PluckSynth` per theme, not one
 * per event — so every note ever played on a voice has to be scheduled at a time at
 * or after the last one already queued on it. Tone throws otherwise: *"The time must
 * be greater than or equal to the last scheduled time."*
 *
 * Scheduling from `Tone.now()` alone violates that as soon as two stingers share a
 * voice within one gesture's span, which normal play reaches easily:
 *
 *   - **Two exit presses on one bar.** Each emits its own `positionClosed`, both in
 *     the same tick, so both read the *same* `Tone.now()`. The first spreads its
 *     arpeggio over ~200ms; the second then asks for a time 200ms in the past.
 *   - Any two same-voice events in one tick — an entry plus a denial, a force-close
 *     plus a close.
 *
 * The fix is a per-voice cursor: a stinger starts at the later of "now" and "just
 * after whatever that voice is already committed to". Simultaneous events on one
 * voice then queue as distinct gestures instead of throwing, which is also the
 * better result — two exits *should* sound like two exits.
 */

/**
 * Minimum spacing between consecutive notes on one voice, in seconds.
 *
 * Two purposes. It keeps the schedule strictly increasing, which is what the
 * monophonic voices require. And it stops a recipe with a tiny `step` from stacking
 * notes so close they read as one attack.
 */
export const MIN_VOICE_GAP = 0.02

/**
 * How far a stinger may be pushed back before it's dropped instead, in seconds.
 *
 * A stinger is feedback *about an event*, and once it has slipped into the next bar
 * it has stopped being that — it reads as a stray noise attached to the wrong bar. At
 * the default 2 bars/sec a bar is 500ms, so this keeps a deferred cue inside the bar
 * that caused it.
 *
 * Sized with headroom over the longest shipped gesture (jolly's four-note profit
 * arpeggio spans 225ms) so that a *repeat* of any recipe still gets through, and only
 * a genuine pile-up beyond that is dropped. Under a flurry — flattening a five-unit
 * position, a burst of denied presses — dropping the tail is the honest choice over
 * playing a queue that outlasts what caused it.
 */
export const MAX_DEFER = 0.35

export interface StingerScheduleOptions {
  /** The audio clock's current time. */
  now: number
  /** Last time already scheduled on this voice, or undefined if it's idle. */
  lastScheduled: number | undefined
  noteCount: number
  /** The recipe's requested spacing between notes. */
  step: number
}

/**
 * Absolute times for a stinger's notes, or an empty array if it should be dropped.
 *
 * Guaranteed strictly increasing, and guaranteed to start at or after
 * `lastScheduled` — which together are exactly what the monophonic voices need.
 */
export function stingerTimes({
  now,
  lastScheduled,
  noteCount,
  step,
}: StingerScheduleOptions): number[] {
  if (noteCount <= 0 || !Number.isFinite(now)) return []

  const busyUntil = lastScheduled === undefined || !Number.isFinite(lastScheduled)
    ? now
    : lastScheduled + MIN_VOICE_GAP
  const start = Math.max(now, busyUntil)
  // Too late to be feedback about the event that caused it.
  if (start - now > MAX_DEFER) return []

  const spacing = Math.max(Number.isFinite(step) ? step : 0, MIN_VOICE_GAP)
  return Array.from({ length: noteCount }, (_, index) => start + index * spacing)
}
