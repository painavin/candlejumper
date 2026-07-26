/**
 * Mixing arithmetic — no Tone, so it can be tested.
 *
 * `audioSystem.ts` needs a real `AudioContext` and can't be unit-tested at all, so
 * the one rule here that has a right and a wrong answer lives on this side of the
 * line. Same split as `channels/voicing.ts`.
 */

/**
 * Linear 0..1 slider → linear gain.
 *
 * **Muted is exactly zero**, not a very small number. A mute that leaves −60dB of
 * signal is audible in a quiet room and is the kind of thing someone reports as "the
 * mute button doesn't work".
 *
 * Close to an identity otherwise, on purpose: the sliders are already linear gain.
 * An earlier version round-tripped through `gainToDb`/`dbToGain`, which cancelled out
 * and only obscured what the value meant.
 */
export function toGain(volume: number, muted: boolean): number {
  if (muted || !Number.isFinite(volume) || volume <= 0) return 0
  return Math.min(1, volume)
}
