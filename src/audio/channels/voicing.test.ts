import { describe, expect, it } from 'vitest'
import { audioThemes } from '@content/audioThemes/index.js'
import { createPrng } from '@shared/math/index.js'
import { chordTone, contour, droneNotes, droneTransition, shiftOctave } from './voicing.js'

/**
 * `bed.ts` itself can't be tested — Tone.js needs a real `AudioContext` — so the
 * arithmetic it depends on lives here where it can be. The `droneTransition` case
 * below is a bug that shipped: `serious` has two consecutive chords sharing a C, and
 * releasing plus attacking the same pitch on one `PolySynth` voice killed the note
 * that was supposed to be sustaining.
 */

describe('shiftOctave', () => {
  it('moves a note by whole octaves', () => {
    expect(shiftOctave('C3', 1)).toBe('C4')
    expect(shiftOctave('C3', -1)).toBe('C2')
    expect(shiftOctave('Bb2', 2)).toBe('Bb4')
    expect(shiftOctave('F#4', -1)).toBe('F#3')
  })

  it('is a no-op for zero, without reformatting the name', () => {
    expect(shiftOctave('Eb3', 0)).toBe('Eb3')
  })

  it('passes an unparseable name through rather than throwing', () => {
    // A malformed theme should sound wrong, not take the run down.
    expect(shiftOctave('nonsense', 1)).toBe('nonsense')
  })
})

describe('droneNotes', () => {
  it('takes the root and the fifth, an octave below the surface register', () => {
    // Register 4 is the surface, so the drone sits at the chord's written octave.
    expect(droneNotes(['C3', 'E3', 'G3'], 4)).toEqual(['C3', 'G3'])
    expect(droneNotes(['C3', 'E3', 'G3'], 3)).toEqual(['C2', 'G2'])
  })

  it('omits the third, so the harmony can move without feeling stuck', () => {
    expect(droneNotes(['C3', 'E3', 'G3'], 4)).not.toContain('E3')
  })

  it('copes with a two-note or one-note chord', () => {
    expect(droneNotes(['C3', 'G3'], 4)).toEqual(['C3', 'G3'])
    expect(droneNotes(['C3'], 4)).toEqual(['C3'])
  })

  it('returns nothing for an empty chord instead of guessing', () => {
    expect(droneNotes([], 4)).toEqual([])
  })
})

describe('droneTransition', () => {
  it('holds a common tone rather than retriggering it', () => {
    // The bug: releasing and attacking the same pitch at one instant can land on the
    // same PolySynth voice, and the release wins — so the note that was meant to
    // sustain through the change goes silent instead.
    const { releasing, attacking } = droneTransition(['F1', 'C2'], ['C2', 'G2'])
    expect(releasing).toEqual(['F1'])
    expect(attacking).toEqual(['G2'])
    expect(releasing).not.toContain('C2')
    expect(attacking).not.toContain('C2')
  })

  it('swaps everything when the chords share nothing', () => {
    const { releasing, attacking } = droneTransition(['C3', 'G3'], ['A2', 'E3'])
    expect(releasing).toEqual(['C3', 'G3'])
    expect(attacking).toEqual(['A2', 'E3'])
  })

  it('does nothing at all when the chord repeats', () => {
    const { releasing, attacking } = droneTransition(['C3', 'G3'], ['C3', 'G3'])
    expect(releasing).toEqual([])
    expect(attacking).toEqual([])
  })

  it('attacks everything on the first chord, when nothing is held', () => {
    expect(droneTransition([], ['C3', 'G3'])).toEqual({
      releasing: [],
      attacking: ['C3', 'G3'],
    })
  })

  it('never leaves the drone silent anywhere in a shipped progression', () => {
    // The property that makes the bed continuous at all: walking a full loop of every
    // theme's progression, the drone must always be holding something. A gap here is
    // a gap in the music.
    for (const theme of audioThemes) {
      const { progression, register } = theme.bed
      let held: string[] = []
      // Two loops, so the wrap from the last chord back to the first is covered.
      for (let i = 0; i < progression.length * 2 + 1; i++) {
        const next = droneNotes(progression[i % progression.length] ?? [], register)
        expect(next.length, `${theme.id} chord ${i % progression.length}`).toBeGreaterThan(0)
        const { releasing, attacking } = droneTransition(held, next)
        // Something is always still sounding: either a common tone carries over, or
        // a new note is arriving under the outgoing one's long release.
        expect(
          attacking.length > 0 || releasing.length < held.length,
          `${theme.id} goes silent at chord ${i % progression.length}`
        ).toBe(true)
        held = next
      }
    }
  })
})

describe('chordTone', () => {
  const cMajor = ['C3', 'E3', 'G3']

  it('reads degrees straight off the chord', () => {
    expect(chordTone(cMajor, 0, 0)).toBe('C3')
    expect(chordTone(cMajor, 1, 0)).toBe('E3')
    expect(chordTone(cMajor, 2, 0)).toBe('G3')
  })

  it('wraps past the top of the chord into the next octave', () => {
    // What makes one integer space usable for a bass figure and a melody at once.
    expect(chordTone(cMajor, 3, 0)).toBe('C4')
    expect(chordTone(cMajor, 4, 0)).toBe('E4')
    expect(chordTone(cMajor, 6, 0)).toBe('C5')
  })

  it('walks downward for negative degrees, without landing on the root', () => {
    // `%` alone gives a negative index here; floor division is what makes -1 the
    // chord's top note an octave down, which is what "one step below the root" means.
    expect(chordTone(cMajor, -1, 0)).toBe('G2')
    expect(chordTone(cMajor, -3, 0)).toBe('C2')
  })

  it('applies the octave offset on top of the wrap', () => {
    expect(chordTone(cMajor, 0, -1)).toBe('C2')
    expect(chordTone(cMajor, 3, 1)).toBe('C5')
  })

  it('returns something playable for an empty chord instead of throwing', () => {
    expect(chordTone([], 4, 0)).toBe('C3')
  })
})

describe('contour', () => {
  it('is deterministic for a seed', () => {
    const run = (): number[] => contour(64, createPrng(42))
    expect(run()).toEqual(run())
  })

  it('stays within a singable span', () => {
    // Unbounded, a random walk wanders off the top of the register within a phrase
    // and the melody stops sounding like a melody.
    const walk = contour(500, createPrng(7))
    for (const degree of walk) {
      expect(degree).toBeGreaterThanOrEqual(-2)
      expect(degree).toBeLessThanOrEqual(7)
    }
  })

  it('mostly steps, and does sometimes leap', () => {
    const walk = contour(400, createPrng(3))
    const intervals = walk.slice(1).map((degree, index) => Math.abs(degree - (walk[index] as number)))
    const leaps = intervals.filter((interval) => interval > 1).length
    // Neither extreme is music: all steps is an exercise, all leaps is noise.
    expect(leaps).toBeGreaterThan(0)
    expect(leaps).toBeLessThan(intervals.length / 2)
  })

  it('produces a note that is in the chord, whatever it generates', () => {
    // The safety property behind the whole approach: a contour is degrees, and every
    // degree resolves to a chord tone, so a generated melody is in key by
    // construction rather than by luck.
    const chord = ['F2', 'A2', 'C3', 'D3']
    const names = new Set(chord.map((note) => note.replace(/-?\d+$/, '')))
    for (const degree of contour(200, createPrng(11))) {
      expect(names.has(chordTone(chord, degree, 0).replace(/-?\d+$/, ''))).toBe(true)
    }
  })
})

describe('the shipped jolly groove', () => {
  const jolly = audioThemes.find((theme) => theme.id === 'jolly')

  it('has a pulse, because ambient cannot be cheerful', () => {
    expect(jolly?.bed.pulse).toBeDefined()
  })

  it('puts stabs on the off-beats against a bass on the beats', () => {
    // The oom-pah. If these ever line up, the groove flattens into a metronome and
    // the theme stops being jolly regardless of tempo, timbre, or swing.
    const pulse = jolly?.bed.pulse
    if (!pulse) throw new Error('jolly has no pulse')

    const bassHits = pulse.bassPattern.map((degree) => (degree >= 0 ? 1 : 0))
    pulse.stabPattern.forEach((stab, eighth) => {
      if (stab !== 1) return
      expect(bassHits[eighth], `stab and bass collide on eighth ${eighth}`).not.toBe(1)
    })
    // And neither layer is empty, which would make the check vacuous.
    expect(bassHits.filter(Boolean).length).toBeGreaterThan(0)
    expect(pulse.stabPattern.filter(Boolean).length).toBeGreaterThan(0)
  })

  it('swings, and has a phrase short enough to recognise', () => {
    const pulse = jolly?.bed.pulse
    expect(pulse?.swing).toBeGreaterThan(0)
    expect(pulse?.phraseBars).toBeLessThanOrEqual(4)
  })

  it('keeps the drone quiet, since the pulse carries continuity', () => {
    expect(jolly?.bed.droneLevel).toBeLessThan(0.3)
  })
})
