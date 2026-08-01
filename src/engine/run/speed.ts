/**
 * The speeds a player can step through mid-run, and how a press moves between them.
 *
 * Separate from `runClock.ts`, which owns what a speed *does*. This file owns which
 * speeds exist, and it's pure so the stepping rule can be tested without a clock.
 *
 * ## Why a ladder rather than a fixed increment
 *
 * The settings slider moves in half-bar steps across 0.5 to 10, which is nineteen
 * presses end to end — fine for a slider you drag, useless for a key you tap while
 * trading. The rungs are close together at the bottom and far apart at the top because
 * that's where the difference is: 0.5 to 1 halves the reaction time available, while 8 to
 * 10 is a refinement. Even spacing would spend most of its rungs where they change least.
 *
 * The range matches `validateConfig`'s 0.5–10 exactly. A speed outside it would be
 * refused if it came from a config file, and the keyboard must not be a way in.
 */

/** Bars per second, ascending. The ends are the clamp. */
export const SPEED_STEPS: readonly number[] = [0.5, 1, 2, 3, 4, 5, 6, 8, 10]

export type SpeedDirection = 'faster' | 'slower'

/**
 * The next speed up or down from `current`.
 *
 * `current` need not be on the ladder: the settings slider reaches 2.5 and 7.5, and
 * config files can hold anything in range. An off-ladder speed moves to the nearest rung
 * **in the direction asked for**, which is what makes the first press feel like a step
 * rather than a jump backwards. Already at an end, it stays there — a press at the limit
 * does nothing rather than wrapping around to the other extreme.
 */
export function steppedSpeed(current: number, direction: SpeedDirection): number {
  const first = SPEED_STEPS[0] ?? 1
  const last = SPEED_STEPS[SPEED_STEPS.length - 1] ?? first
  if (!Number.isFinite(current)) return first

  if (direction === 'faster') {
    return SPEED_STEPS.find((step) => step > current + EPSILON) ?? last
  }
  const below = SPEED_STEPS.filter((step) => step < current - EPSILON)
  return below[below.length - 1] ?? first
}

/**
 * Tolerance for "already on this rung".
 *
 * Without it, a `current` of 2.0000000000000004 — which is what repeated scaling produces
 * — reads as above 2 and the next step up skips 3 to land on 4. Small enough that no
 * speed a player can reach is within it of a rung it isn't on.
 */
const EPSILON = 1e-9
