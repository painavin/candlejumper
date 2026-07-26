import * as Tone from 'tone'
import type { AudioTheme } from '@content/audioThemes/types.js'
import { createPrng, deriveSeed } from '@shared/math/index.js'

/**
 * Channel 1 — the generative ambient bed.
 *
 * **Fully generated: no audio files.** The theme supplies a *fixed* chord
 * progression and the generator randomizes voicing, register, and timing over it.
 * Fixing the harmony is the deliberate mitigation for generative ambient's known
 * failure mode — wandering aimlessly and turning monotonous. The randomness lives
 * in the surface, not the harmony.
 *
 * Seeded from the run's world seed, so the same run sounds the same way twice.
 */

export interface AmbientBed {
  start(): void
  stop(): void
  dispose(): void
}

export function createAmbientBed(
  theme: AudioTheme,
  destination: Tone.InputNode,
  worldSeed: number
): AmbientBed {
  const { progression, instrument, register, noteRateRange, chordSeconds } = theme.bed
  const prng = createPrng(deriveSeed(worldSeed, 'audio:bed'))

  const voice =
    instrument === 'pad'
      ? new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 1.6, decay: 1.2, sustain: 0.7, release: 3.5 },
        })
      : new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.01, decay: 0.9, sustain: 0.05, release: 1.2 },
        })
  voice.volume.value = -20
  voice.connect(destination)

  let chordIndex = 0
  let timer: number | undefined

  const scheduleNext = (): void => {
    const [minRate, maxRate] = noteRateRange
    const wait = prng.range(minRate, maxRate)

    timer = globalThis.setTimeout(() => {
      const chord = progression[chordIndex % progression.length] ?? []
      const note = chord[prng.int(0, Math.max(0, chord.length - 1))]
      if (note) {
        // Voicing and register vary; the harmony does not.
        const octaveShift = prng.chance(0.3) ? 1 : 0
        const shifted = shiftOctave(note, register - 3 + octaveShift)
        voice.triggerAttackRelease(shifted, instrument === 'pad' ? '2n' : '4n')
      }
      scheduleNext()
    }, wait * 1000) as unknown as number
  }

  let chordTimer: number | undefined

  return {
    start() {
      if (timer !== undefined) return
      scheduleNext()
      chordTimer = globalThis.setInterval(() => {
        chordIndex += 1
      }, chordSeconds * 1000) as unknown as number
    },

    stop() {
      if (timer !== undefined) globalThis.clearTimeout(timer)
      if (chordTimer !== undefined) globalThis.clearInterval(chordTimer)
      timer = undefined
      chordTimer = undefined
      voice.releaseAll()
    },

    dispose() {
      this.stop()
      voice.dispose()
    },
  }
}

/** `C3` + 1 → `C4`. Note names only; the bed never needs microtonal shifts. */
function shiftOctave(note: string, octaves: number): string {
  if (octaves === 0) return note
  const match = /^([A-G][b#]?)(-?\d+)$/.exec(note)
  if (!match) return note
  return `${match[1]}${Number(match[2]) + octaves}`
}
