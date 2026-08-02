import * as Tone from 'tone'
import type { MidiNote, MidiTrack } from '@shared/contracts/index.js'
import type { AmbientBed } from './bed.js'

/**
 * Channel 1 playing a **composed track** instead of generating one.
 *
 * Satisfies the same `AmbientBed` interface as the generated bed, so `audioSystem`
 * swaps one for the other and nothing downstream — pause, the music bus, the mix —
 * knows which is running.
 *
 * ## What a MIDI file supplies, and what it doesn't
 *
 * Notes, timing, a mix, and an instrument *hint*. Not sound: there is no General MIDI
 * soundfont here, because that would mean shipping samples. So a program number picks
 * a **synth recipe by instrument family** rather than a patch, and a track will not
 * sound the way it does in a DAW.
 *
 * That is a much weaker claim than General MIDI makes and still the right trade. The
 * first version of this ignored programs entirely and assigned voices by *channel
 * index*, which made a bass part and a string part identical whenever they happened
 * to land next to each other — throwing away the one piece of instrumentation the
 * file actually states.
 */

/** MIDI's percussion channel, zero-based. Channel 10 in one-based tools. */
const DRUM_CHANNEL = 9

/** A pitched voice recipe, per General MIDI instrument family. */
interface Patch {
  type: 'triangle' | 'sine' | 'sawtooth' | 'square'
  attack: number
  decay: number
  sustain: number
  release: number
  /**
   * Detune spread in cents across three oscillators, or 0 for one.
   *
   * Tone's `fat*` oscillator types do this natively. It matters more than it sounds
   * like it should: a single oscillator per note is what makes a synthesized string
   * section read as a buzzer rather than as several players.
   */
  detune: number
  /** Relative level, before velocity. Bright families are pulled down. */
  gain: number
}

/**
 * The sixteen General MIDI families, collapsed to twelve recipes.
 *
 * Ported from a reference implementation rather than derived — these are well-chosen
 * and tuning them by ear is not something a test can defend. The shape that matters
 * is that each family differs in *envelope*, not just waveform: a piano and an organ
 * on the same triangle wave are told apart by attack and sustain, and getting that
 * wrong is what makes every part sound like the same instrument.
 */
const PATCHES: readonly Patch[] = [
  { type: 'triangle', attack: 0.004, decay: 1.9, sustain: 0.28, release: 0.22, detune: 4, gain: 0.95 }, // piano
  { type: 'sine', attack: 0.002, decay: 0.55, sustain: 0.04, release: 0.12, detune: 0, gain: 1 }, // chromatic percussion
  { type: 'sine', attack: 0.012, decay: 6, sustain: 0.92, release: 0.1, detune: 7, gain: 0.7 }, // organ
  { type: 'sawtooth', attack: 0.004, decay: 1.3, sustain: 0.22, release: 0.18, detune: 6, gain: 0.55 }, // guitar
  { type: 'triangle', attack: 0.006, decay: 1.6, sustain: 0.45, release: 0.14, detune: 3, gain: 1 }, // bass
  { type: 'sawtooth', attack: 0.07, decay: 4, sustain: 0.8, release: 0.3, detune: 8, gain: 0.45 }, // strings
  { type: 'sawtooth', attack: 0.05, decay: 3, sustain: 0.75, release: 0.28, detune: 10, gain: 0.42 }, // ensemble
  { type: 'square', attack: 0.03, decay: 2.2, sustain: 0.7, release: 0.16, detune: 5, gain: 0.34 }, // brass
  { type: 'square', attack: 0.02, decay: 2.4, sustain: 0.72, release: 0.16, detune: 4, gain: 0.32 }, // reed
  { type: 'sine', attack: 0.03, decay: 3, sustain: 0.85, release: 0.14, detune: 3, gain: 0.8 }, // pipe
  { type: 'square', attack: 0.008, decay: 1.8, sustain: 0.55, release: 0.16, detune: 6, gain: 0.34 }, // synth lead
  { type: 'sawtooth', attack: 0.18, decay: 5, sustain: 0.85, release: 0.45, detune: 12, gain: 0.38 }, // synth pad
]

/** Families 12–15 (effects, ethnic, percussive, sound effects) share a neutral recipe. */
const FALLBACK_PATCH: Patch = {
  type: 'triangle',
  attack: 0.01,
  decay: 1.6,
  sustain: 0.4,
  release: 0.2,
  detune: 5,
  gain: 0.6,
}

function patchFor(program: number): Patch {
  return PATCHES[Math.floor(program / 8)] ?? FALLBACK_PATCH
}

/** One drum voice's character: pitch, length, and the balance of noise to tone. */
interface Drum {
  frequency: number
  length: number
  /** 0..1 filtered-noise component — the body of a snare or a hat. */
  noise: number
  /** 0..1 pitched component — the body of a kick or a tom. */
  tone: number
}

/**
 * The General MIDI percussion map, for the drums that actually appear in music.
 *
 * A published standard, which is why it is worth having: the first version of this
 * split on `note < 45` and gave everything above it white noise, so a hi-hat, a ride,
 * a clap and a cowbell were the same sound. Note numbers follow GM level 1.
 */
function drumFor(note: number): Drum {
  if (note === 35 || note === 36) return { frequency: 62, length: 0.3, noise: 0.1, tone: 1 } // kick
  if (note === 38 || note === 40) return { frequency: 200, length: 0.18, noise: 0.95, tone: 0.35 } // snare
  if (note === 37) return { frequency: 320, length: 0.1, noise: 0.7, tone: 0.35 } // rim
  if (note === 39) return { frequency: 1200, length: 0.12, noise: 0.9, tone: 0.1 } // clap
  if (note === 42 || note === 44) return { frequency: 8000, length: 0.06, noise: 1, tone: 0 } // closed hat
  if (note === 46 || note === 49 || note === 57)
    return { frequency: 6000, length: 0.55, noise: 1, tone: 0 } // open hat, crash
  if (note === 51 || note === 59) return { frequency: 7000, length: 0.35, noise: 0.85, tone: 0.1 } // ride
  if (note === 54 || note === 56) return { frequency: 900, length: 0.12, noise: 0.5, tone: 0.6 } // tambourine, cowbell
  // Toms rise with pitch across the kit.
  if (note >= 41 && note <= 50)
    return { frequency: 90 + (note - 41) * 22, length: 0.28, noise: 0.25, tone: 0.9 }
  return { frequency: 400, length: 0.14, noise: 0.6, tone: 0.5 }
}

/**
 * Decibel trim on the whole track.
 *
 * A composed arrangement is many simultaneous voices where the generated bed is two to
 * four, so it arrives far louder at the same bus gain. This is not a substitute for the
 * player's music slider — it is what makes the slider's usable range the same whichever
 * bed is playing.
 */
const TRACK_TRIM = -12

/** Maximum voices sounding at once, per synth. Above this Tone starts stealing. */
const POLYPHONY = 10

/**
 * A note shorter than this is lengthened to it.
 *
 * Sequenced percussion often writes one-tick notes, which at some tempos resolve to
 * under a millisecond — short enough that the envelope never opens and the note is
 * silent. Lengthening is the difference between hearing a drum part and not.
 */
const MIN_DURATION = 0.03

export function createTrackBed(
  track: MidiTrack,
  destination: Tone.InputNode,
  trim = TRACK_TRIM
): AmbientBed {
  /**
   * A compressor before the bus, which the generated bed does not need.
   *
   * Ten voices whose peaks coincide clip where four never would, and a fixed trim can
   * only trade headroom against being inaudible. This catches the coincidences instead.
   */
  const compressor = new Tone.Compressor({
    threshold: -14,
    ratio: 4,
    attack: 0.004,
    release: 0.18,
    knee: 22,
  }).connect(destination)
  const gain = new Tone.Gain(Tone.dbToGain(trim)).connect(compressor)

  /** Keyed by `channel:program`, so a program change mid-track gets its own voice. */
  const voices = new Map<string, { synth: Tone.PolySynth; panner: Tone.Panner }>()
  const drums = new Map<number, { noise: Tone.NoiseSynth; tone: Tone.MembraneSynth }>()

  const pitched = (note: MidiNote): { synth: Tone.PolySynth; panner: Tone.Panner } => {
    const key = `${note.channel}:${note.program}`
    const existing = voices.get(key)
    if (existing) return existing
    const patch = patchFor(note.program)
    const panner = new Tone.Panner(note.pan).connect(gain)
    /**
     * A lowpass tracking nothing in particular, on purpose.
     *
     * Per-note tracking would need a filter per voice, which `PolySynth` does not
     * expose. A fixed corner still does the job it is here for: keeping the sawtooth
     * and square families from being harsh in the top octaves.
     */
    const filter = new Tone.Filter({ type: 'lowpass', frequency: 5200, Q: 0.4 }).connect(panner)
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: patch.detune
        ? { type: `fat${patch.type}` as 'fatsawtooth', count: 3, spread: patch.detune * 3 }
        : { type: patch.type },
      envelope: {
        attack: patch.attack,
        decay: patch.decay,
        sustain: patch.sustain,
        release: patch.release,
      },
      volume: Tone.gainToDb(patch.gain),
    })
    synth.maxPolyphony = POLYPHONY
    synth.connect(filter)
    const voice = { synth, panner }
    voices.set(key, voice)
    return voice
  }

  /**
   * One voice per drum pitch, built from its GM character.
   *
   * Noise and tone are separate nodes because most drums are a blend: a snare is
   * mostly noise with a little pitch, a kick the reverse. `MembraneSynth` carries the
   * pitched half — it exists for exactly this and does the downward sweep itself.
   */
  const percussive = (note: number): { noise: Tone.NoiseSynth; tone: Tone.MembraneSynth } => {
    const existing = drums.get(note)
    if (existing) return existing
    const drum = drumFor(note)
    const bandpass = new Tone.Filter({
      type: drum.frequency > 3000 ? 'highpass' : 'bandpass',
      frequency: drum.frequency,
      Q: drum.frequency > 3000 ? 0.7 : 1.4,
    }).connect(gain)
    const noise = new Tone.NoiseSynth({
      noise: { type: drum.frequency > 3000 ? 'white' : 'pink' },
      envelope: { attack: 0.001, decay: drum.length, sustain: 0 },
      volume: Tone.gainToDb(Math.max(0.0001, drum.noise)),
    }).connect(bandpass)
    const tone = new Tone.MembraneSynth({
      pitchDecay: drum.length * 0.6,
      octaves: 1.5,
      envelope: { attack: 0.001, decay: drum.length, sustain: 0, release: 0.02 },
      volume: Tone.gainToDb(Math.max(0.0001, drum.tone)),
    }).connect(gain)
    const voice = { noise, tone }
    drums.set(note, voice)
    return voice
  }

  let part: Tone.Part<MidiNote> | undefined

  return {
    start() {
      if (part || track.notes.length === 0 || track.duration <= 0) return
      part = new Tone.Part<MidiNote>((time, note) => {
        const duration = Math.max(MIN_DURATION, note.duration)
        if (note.channel === DRUM_CHANNEL) {
          const drum = drumFor(note.note)
          const voice = percussive(note.note)
          // Held no longer than the drum's own character, whatever the file wrote:
          // a two-second note-off on a hi-hat is a sequencing artefact, not a sound.
          const length = Math.min(Math.max(duration, drum.length), drum.length)
          if (drum.noise > 0) voice.noise.triggerAttackRelease(length, time, note.velocity)
          if (drum.tone > 0) {
            voice.tone.triggerAttackRelease(drum.frequency, length, time, note.velocity)
          }
          return
        }
        const voice = pitched(note)
        // Pan is per-note in the data but per-voice in the graph. Setting it at the
        // scheduled time keeps automation roughly right without a panner per note.
        voice.panner.pan.setValueAtTime(note.pan, time)
        voice.synth.triggerAttackRelease(
          Tone.Frequency(note.note, 'midi').toFrequency(),
          duration,
          time,
          note.velocity
        )
      }, track.notes)
      part.loop = true
      // Looping on the track's own duration — end-of-track, not last note — so any
      // trailing rest the composer wrote survives the repeat.
      part.loopStart = 0
      part.loopEnd = track.duration
      part.start(0)
      Tone.getTransport().start()
    },

    stop() {
      part?.stop()
      part?.dispose()
      part = undefined
      // Release anything mid-note, or pausing leaves a chord sounding over a frozen
      // chart — the same reason the generated bed stops on pause.
      for (const voice of voices.values()) voice.synth.releaseAll()
      Tone.getTransport().stop()
    },

    dispose() {
      part?.dispose()
      part = undefined
      for (const voice of voices.values()) {
        voice.synth.dispose()
        voice.panner.dispose()
      }
      for (const voice of drums.values()) {
        voice.noise.dispose()
        voice.tone.dispose()
      }
      voices.clear()
      drums.clear()
      gain.dispose()
      compressor.dispose()
    },
  }
}
