import * as Tone from 'tone'
import type { BedPulse } from '@content/audioThemes/types.js'
import { createPrng, deriveSeed } from '@shared/math/index.js'
import { chordTone, contour } from './voicing.js'

/**
 * The metered mode for channel 1 — a bouncing bass, off-beat stabs, and a repeating
 * melodic hook over the theme's fixed progression.
 *
 * ## Why this exists as a second engine
 *
 * The ambient bed cannot be cheerful, and that isn't a tuning problem. Cheerfulness
 * in game music is made of meter: a bass that walks, accents that land *between* the
 * beats, a shuffle, and a phrase short enough to recognise when it comes round again.
 * "Randomize the timing of single notes" can't express any of those, so a bed asked
 * to be jolly needs a different engine rather than different numbers.
 *
 * ## What makes it feel jolly, in order of how much each contributes
 *
 *   1. **Off-beat stabs against an on-beat bass.** The oom-pah. This one cue carries
 *      more of the feeling than every other decision here combined.
 *   2. **Swing.** A straight grid reads as mechanical however bright the timbre.
 *   3. **A repeating contour.** Generated once from the seed and then reused,
 *      remapped onto whichever chord is current. Repetition is what makes a melody a
 *      melody rather than a sequence of individually correct notes — and the
 *      remapping is what keeps it in key while the harmony moves underneath.
 *   4. **Short, bright timbres.** Pulse and triangle waves with fast decays, so the
 *      texture stays crisp and rhythmic instead of blurring.
 *
 * All four are parameters or seeded, so this is one code path serving any number of
 * grooves — no branching on theme id.
 *
 * ## What it deliberately is not
 *
 * Not a transcription. The progression, the rhythm patterns, and the phrase length
 * are the theme's; the *pitches* come out of a seeded walk over the chord tones. The
 * result should share a genre with the music that inspired it and none of its notes.
 */

export interface Pulse {
  start(): void
  stop(): void
  dispose(): void
}

export interface PulseOptions {
  pulse: BedPulse
  progression: readonly string[][]
  /**
   * Octave the melody is centred on; bass and stabs are placed relative to it.
   *
   * The three layers are spread across roughly three octaves — bass well below,
   * stabs in the middle, melody on top. Bunching them makes the chord and the tune
   * fight for the same space and the whole thing turns to mud, which matters more
   * here than in ambient mode because everything is short and simultaneous.
   */
  register: number
  destination: Tone.InputNode
  worldSeed: number
  /** Fires when the chord changes, so a drone underneath can follow along. */
  onChord(chord: readonly string[], time: number): void
}

/** Sixteenths per bar, in 4/4. The patterns are written against this grid. */
const STEPS_PER_BAR = 16

export function createPulse({
  pulse,
  progression,
  register,
  destination,
  worldSeed,
  onChord,
}: PulseOptions): Pulse {
  const prng = createPrng(deriveSeed(worldSeed, 'audio:pulse'))
  const transport = Tone.getTransport()

  /**
   * Three voices rather than one, so each layer can have its own envelope — the
   * whole point of the texture is that the bass sustains a little, the stabs don't,
   * and the melody sings.
   */
  const bass = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.01, decay: 0.18, sustain: 0.25, release: 0.16 },
  })
  const stabs = new Tone.PolySynth(Tone.Synth, {
    // A narrow pulse is bright and hollow — it cuts through without weight, which is
    // what an off-beat accent wants to do.
    oscillator: { type: 'pulse', width: 0.35 },
    envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.08 },
  })
  const melody = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'square' },
    // Enough decay to sing, short enough to stay rhythmic.
    envelope: { attack: 0.01, decay: 0.22, sustain: 0.14, release: 0.22 },
  })

  bass.volume.value = level(pulse.levels.bass, -14)
  stabs.volume.value = level(pulse.levels.stabs, -22)
  melody.volume.value = level(pulse.levels.melody, -17)
  for (const voice of [bass, stabs, melody]) voice.connect(destination)

  /**
   * The hook, generated once.
   *
   * Chord-tone offsets rather than pitches, so the same shape can be replayed over
   * every chord in the progression and stay in key. Small steps with the occasional
   * leap: all steps is dull, all leaps is noise.
   */
  const phraseSteps = pulse.phraseBars * STEPS_PER_BAR
  const hook = contour(phraseSteps, prng)

  let step = 0
  let chordIndex = -1
  let event: number | undefined

  const stepsPerChord = pulse.barsPerChord * STEPS_PER_BAR

  const tick = (time: number): void => {
    const inBar = step % STEPS_PER_BAR
    const wantedChord = Math.floor(step / stepsPerChord) % progression.length

    if (wantedChord !== chordIndex) {
      chordIndex = wantedChord
      onChord(progression[chordIndex] ?? [], time)
    }
    const chord = progression[chordIndex] ?? []
    if (chord.length === 0) {
      step += 1
      return
    }

    // Bass and stabs are written per eighth, so they only act on even sixteenths.
    if (inBar % 2 === 0) {
      const eighth = inBar / 2
      const degree = pulse.bassPattern[eighth % pulse.bassPattern.length] ?? -1
      if (degree >= 0) {
        // An octave below the melody: the bounce needs room under everything else.
        bass.triggerAttackRelease(chordTone(chord, degree, register - 5), '8n', time)
      }
      if ((pulse.stabPattern[eighth % pulse.stabPattern.length] ?? 0) === 1) {
        // The full chord, short. Stabs are harmony as rhythm.
        const voiced = chord.map((_, index) => chordTone(chord, index, register - 4))
        stabs.triggerAttackRelease(voiced, '16n', time)
      }
    }

    if ((pulse.melodyPattern[inBar % pulse.melodyPattern.length] ?? 0) === 1) {
      const offset = hook[step % phraseSteps] ?? 0
      melody.triggerAttackRelease(chordTone(chord, offset, register - 3), '16n', time)
    }

    step += 1
  }

  return {
    start() {
      if (event !== undefined) return
      transport.bpm.value = pulse.tempo
      transport.swing = pulse.swing
      transport.swingSubdivision = '8n'
      step = 0
      chordIndex = -1
      event = transport.scheduleRepeat(tick, '16n', 0)
      transport.start()
    },

    stop() {
      if (event !== undefined) transport.clear(event)
      event = undefined
      transport.stop()
      for (const voice of [bass, stabs, melody]) voice.releaseAll()
    },

    dispose() {
      this.stop()
      for (const voice of [bass, stabs, melody]) voice.dispose()
    },
  }
}

/** Theme level 0..1 → decibels, offset per layer. Silence rather than a whisper at 0. */
function level(value: number, offset: number): number {
  return value <= 0 ? -Infinity : Tone.gainToDb(value) + offset
}
