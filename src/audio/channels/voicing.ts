/**
 * Voicing arithmetic for the ambient bed — note names in, note names out, no Tone.
 *
 * Split out for the same reason `axis.ts` is split from `axisLayer.ts`: the
 * interesting part is arithmetic, and arithmetic should be testable without an audio
 * context. `bed.ts` can't be unit-tested at all — Tone.js needs a real `AudioContext`
 * — so anything that *can* be checked belongs on this side of the line.
 *
 * The common-tone rule in `droneTransition` had a real bug before it lived here.
 */

/** `C3` + 1 → `C4`. Note names only; the bed never needs microtonal shifts. */
export function shiftOctave(note: string, octaves: number): string {
  if (octaves === 0) return note
  const match = /^([A-G][b#]?)(-?\d+)$/.exec(note)
  // An unparseable name passes through rather than throwing: a malformed theme
  // should sound wrong, not take the run down.
  if (!match) return note
  return `${match[1]}${Number(match[2]) + octaves}`
}

/**
 * The drone's notes for a chord: root and fifth, an octave below the surface.
 *
 * Root-and-fifth rather than the whole triad on purpose — the third is what gives a
 * chord its major/minor colour, and holding it under a moving surface makes the
 * harmony feel stuck. Leaving the third to the note layer lets the colour come and
 * go while the foundation stays put.
 */
export function droneNotes(chord: readonly string[], register: number): string[] {
  const root = chord[0]
  if (!root) return []
  const shift = register - 4
  const fifth = chord[2] ?? chord[chord.length - 1]
  const notes = [shiftOctave(root, shift)]
  if (fifth && fifth !== root) notes.push(shiftOctave(fifth, shift))
  return notes
}

/**
 * What to release and what to attack when the chord changes.
 *
 * A note the two chords share is **left alone** — neither released nor re-attacked.
 * Two reasons, and the first is a bug: releasing and attacking the same pitch on a
 * `PolySynth` at the same instant can land on one voice, so the release wins and the
 * note dies instead of continuing. `serious` hits this — its F and C chords both
 * contain C.
 *
 * The second is that it's the better musical result anyway. A held common tone is a
 * pedal, and it's the strongest continuity cue available: the harmony moves
 * underneath something that never stopped.
 */
export function droneTransition(
  held: readonly string[],
  next: readonly string[]
): { releasing: string[]; attacking: string[] } {
  return {
    releasing: held.filter((note) => !next.includes(note)),
    attacking: next.filter((note) => !held.includes(note)),
  }
}

/**
 * A chord tone by degree, wrapping into higher octaves past the top of the chord.
 *
 * The wrap is what makes a single index space usable for everything: a bass pattern
 * asks for degree 0 or 2, a melody contour walks 0..7 and climbs through octaves
 * without ever leaving the harmony. **Any** integer is in key by construction, which
 * is what lets a generated melody be safe rather than lucky.
 *
 * Negative degrees walk downward, so a contour can dip below the chord root.
 */
export function chordTone(chord: readonly string[], degree: number, octaves: number): string {
  if (chord.length === 0) return 'C3'
  // Floor division, so -1 lands on the chord's top note an octave down rather than
  // on the root. `%` alone would give a negative index.
  const wraps = Math.floor(degree / chord.length)
  const index = degree - wraps * chord.length
  return shiftOctave(chord[index] as string, octaves + wraps)
}

/**
 * A melodic contour as chord-degree offsets.
 *
 * Mostly stepwise with occasional leaps: all steps is an exercise, all leaps is
 * noise. Bounded to roughly an octave and a half of chord degrees so the line stays
 * singable and doesn't wander off the top of the register.
 *
 * Generated once per run and then **repeated**, which is the point — repetition is
 * what makes a melody recognisable, and a fresh contour every bar would just be
 * correct notes in a random order.
 */
export function contour(
  length: number,
  prng: { next(): number; chance(probability: number): boolean; int(min: number, max: number): number }
): number[] {
  const out: number[] = []
  let current = 0
  for (let i = 0; i < length; i++) {
    // A leap now and then gives the line a shape worth hearing again.
    current += prng.chance(0.22) ? prng.int(-3, 4) : prng.int(-1, 1)
    // Clamped rather than wrapped: wrapping would jump an octave mid-phrase and read
    // as a mistake instead of a leap.
    current = Math.max(-2, Math.min(7, current))
    out.push(current)
  }
  return out
}
