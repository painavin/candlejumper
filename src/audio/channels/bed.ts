import * as Tone from 'tone'
import type { AudioTheme } from '@content/audioThemes/types.js'
import { createPrng, deriveSeed } from '@shared/math/index.js'
import { createPulse } from './pulse.js'
import type { Pulse } from './pulse.js'
import { droneNotes, droneTransition, shiftOctave } from './voicing.js'

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
 *
 * ## Why this is built in two layers
 *
 * The first version played **one note at a time with silence between**, which is
 * not what a bed is: it read as a trickle of unrelated plinks, the chord
 * progression was never actually sounded, and a chord change usually landed in a
 * gap where nobody could hear it. Continuity is not a mixing problem — no amount of
 * reverb fixes a texture with holes in it.
 *
 * So there are two layers, and the continuity comes from the first:
 *
 *   - **The drone** holds the current chord's root and fifth, indefinitely, with a
 *     multi-second attack and release. Something is *always* sounding. Chord changes
 *     overlap by design: the outgoing chord's release runs long past the incoming
 *     chord's attack, so the harmony crossfades rather than switching.
 *   - **The notes** are the sparse surface on top — two chord tones at a time rather
 *     than one, with each gesture held **longer than the gap that follows it**, so
 *     consecutive gestures always overlap. That overlap is what makes the surface
 *     read as one line instead of separate events.
 *
 * Scheduling is on `Tone.Transport` rather than `setTimeout`: sample-accurate
 * instead of drifting, and it doesn't get throttled into stuttering when the tab
 * loses focus.
 *
 * ## Two modes, because ambient can't be cheerful
 *
 * A theme supplying `bed.pulse` gets the **metered** engine in `pulse.ts` instead of
 * the sparse gestures above: a bouncing bass, off-beat stabs, and a repeating hook.
 * That isn't a preset of this engine, it's a different one — cheerfulness comes from
 * meter, and "randomize the timing of single notes" cannot express meter at any
 * parameter setting.
 *
 * The drone is shared by both modes, and follows the chord either way. In metered
 * mode it wants to be quiet: the pulse is already carrying continuity, so a prominent
 * drone only muddies it.
 */

export interface AmbientBed {
  start(): void
  stop(): void
  dispose(): void
}

/**
 * Seconds of attack and release on the drone.
 *
 * Long enough that a chord change is a swell rather than an edit. The release
 * deliberately outlasts the attack, so the crossfade never dips through a gap —
 * the old chord is still audible while the new one is arriving.
 */
const DRONE_ATTACK = 3.5
const DRONE_RELEASE = 7

/** Notes per gesture. Two sounds like harmony; three muddies at this register. */
const NOTES_PER_GESTURE = 2

export function createAmbientBed(
  theme: AudioTheme,
  destination: Tone.InputNode,
  worldSeed: number
): AmbientBed {
  const {
    progression,
    instrument,
    register,
    noteRateRange,
    chordSeconds,
    droneLevel,
    noteOverlap,
  } = theme.bed
  const prng = createPrng(deriveSeed(worldSeed, 'audio:bed'))
  const transport = Tone.getTransport()

  /**
   * The sustained layer. Sine and `sustain: 1` so a held note holds forever at full
   * level rather than decaying to a whisper — this is the layer whose whole job is
   * never to stop.
   */
  const drone = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: DRONE_ATTACK, decay: 0.1, sustain: 1, release: DRONE_RELEASE },
  })
  // Silence rather than a very quiet drone when a theme asks for none.
  drone.volume.value = droneLevel <= 0 ? -Infinity : Tone.gainToDb(droneLevel) - 16
  drone.connect(destination)

  const voice =
    instrument === 'pad'
      ? new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 1.6, decay: 1.2, sustain: 0.7, release: 3.5 },
        })
      : new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          // Longer release than a true pluck: the tail is what bridges one gesture
          // to the next, and without it the surface goes back to being plinks.
          envelope: { attack: 0.02, decay: 1.1, sustain: 0.12, release: 2.6 },
        })
  voice.volume.value = -18
  voice.connect(destination)

  let chordIndex = 0
  /** What the drone is currently holding, so it can be released on a change. */
  let held: string[] = []
  let noteEvent: number | undefined
  let chordEvent: number | undefined
  let pulse: Pulse | undefined

  const chordAt = (index: number): string[] => progression[index % progression.length] ?? []

  const moveDrone = (chord: readonly string[], time: number): void => {
    const next = droneNotes(chord, register)
    if (next.length === 0) return

    // Common tones are held through the change rather than retriggered — see
    // `droneTransition`, which is where the reasoning and the test live.
    const { releasing, attacking } = droneTransition(held, next)

    // Both at the same instant: the outgoing notes take DRONE_RELEASE seconds to
    // fade while the incoming ones take DRONE_ATTACK to arrive, so the two overlap
    // and the harmony never drops out.
    if (releasing.length > 0) drone.triggerRelease(releasing, time)
    if (attacking.length > 0) drone.triggerAttack(attacking, time)
    held = next
  }

  /** Two distinct tones from the chord, voiced in the surface register. */
  const gesture = (chord: string[]): string[] => {
    if (chord.length === 0) return []
    const pool = [...chord]
    const picked: string[] = []
    for (let i = 0; i < NOTES_PER_GESTURE && pool.length > 0; i++) {
      const [note] = pool.splice(prng.int(0, pool.length - 1), 1)
      if (!note) continue
      // Voicing and register vary; the harmony does not.
      picked.push(shiftOctave(note, register - 3 + (prng.chance(0.3) ? 1 : 0)))
    }
    return picked
  }

  const scheduleNote = (): void => {
    const [minRate, maxRate] = noteRateRange
    const wait = prng.range(minRate, maxRate)

    noteEvent = transport.scheduleOnce((time) => {
      const notes = gesture(chordAt(chordIndex))
      if (notes.length > 0) {
        // Held longer than the gap that follows, so the next gesture starts while
        // this one is still sounding. `noteOverlap` above 1 guarantees it.
        voice.triggerAttackRelease(notes, wait * noteOverlap, time)
      }
      scheduleNote()
    }, `+${wait}`)
  }

  if (theme.bed.pulse) {
    // Metered mode. The pulse owns the clock and the chord cursor; the drone just
    // follows whatever chord it announces, so the two can never disagree about where
    // in the progression they are.
    pulse = createPulse({
      pulse: theme.bed.pulse,
      progression,
      register,
      destination,
      worldSeed,
      onChord: (chord, time) => moveDrone(chord, time),
    })

    return {
      start() {
        pulse?.start()
      },
      stop() {
        pulse?.stop()
        if (held.length > 0) drone.triggerRelease(held)
        held = []
      },
      dispose() {
        this.stop()
        pulse?.dispose()
        drone.dispose()
        voice.dispose()
      },
    }
  }

  return {
    start() {
      if (noteEvent !== undefined) return

      moveDrone(chordAt(chordIndex), Tone.now())
      scheduleNote()
      chordEvent = transport.scheduleRepeat(
        (time) => {
          chordIndex += 1
          moveDrone(chordAt(chordIndex), time)
        },
        chordSeconds,
        chordSeconds
      )
      transport.start()
    },

    stop() {
      if (noteEvent !== undefined) transport.clear(noteEvent)
      if (chordEvent !== undefined) transport.clear(chordEvent)
      noteEvent = undefined
      chordEvent = undefined
      // Stopping the transport is safe: channels 2 and 3 schedule off `Tone.now()`
      // and never read its position.
      transport.stop()
      if (held.length > 0) drone.triggerRelease(held)
      held = []
      voice.releaseAll()
    },

    dispose() {
      this.stop()
      drone.dispose()
      voice.dispose()
    },
  }
}
