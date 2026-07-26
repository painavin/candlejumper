import * as Tone from 'tone'
import type { AudioTheme, StingerRecipe } from '@content/audioThemes/types.js'
import { stingerTimes } from './stingerSchedule.js'

/**
 * Channel 3 — event stingers.
 *
 * Stingers are keyed to **semantic position events, not button names.** This
 * distinction is load-bearing rather than stylistic: when short, the *closing*
 * action is `buy`, so a stinger fired on the sell button would misfire on every
 * short exit — playing an exit sound on entry and vice versa. The keys here are the
 * event keys the engine emits, so that mistake is unrepresentable.
 *
 * The voices are monophonic and reused, so *when* a note may be scheduled on one
 * depends on what that voice is already committed to. That arithmetic lives in
 * `stingerSchedule.ts`, along with the bug it exists to prevent.
 */

export interface Stingers {
  play(key: keyof AudioTheme['stingers']): void
  dispose(): void
}

export function createStingers(theme: AudioTheme, destination: Tone.InputNode): Stingers {
  /** One voice per recipe kind, reused — building a synth per event would leak. */
  const voices = {
    pluck: new Tone.PluckSynth({ attackNoise: 1, dampening: 3600, resonance: 0.86 }),
    bell: new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.18 },
    }),
    tone: new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.05, release: 0.25 },
    }),
    // Deliberately unmusical: a soft rubbery thud that can't be mistaken for a fill.
    thud: new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 1.2,
      envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.05 },
    }),
    // The most jarring voice available, reserved for stopped-out.
    buzz: new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0.12, release: 0.12 },
    }),
  }

  for (const voice of Object.values(voices)) voice.connect(destination)

  type VoiceName = keyof typeof voices
  /**
   * Last time scheduled on each voice.
   *
   * Without this, two stingers sharing a voice inside one gesture's span both
   * schedule from the same `Tone.now()` and the second one throws — which two exit
   * presses on a single bar are enough to cause. See `stingerSchedule.ts`.
   */
  const lastScheduled = new Map<VoiceName, number>()

  const play = (recipe: StingerRecipe): void => {
    const voice = voices[recipe.voice]
    const times = stingerTimes({
      now: Tone.now(),
      lastScheduled: lastScheduled.get(recipe.voice),
      noteCount: recipe.notes.length,
      step: recipe.step,
    })
    // Dropped rather than trailed: a stinger arriving long after its event has
    // stopped being feedback about it.
    if (times.length === 0) return

    // Scheduled rather than set, because a voice can now be holding one gesture
    // while the next is queued behind it — assigning `.value` would retroactively
    // change the level of notes already sounding.
    voice.volume.setValueAtTime(recipe.volume, times[0] as number)
    recipe.notes.forEach((note, index) => {
      // Nudged forward per note so an arpeggio reads as one gesture rather than a
      // chord, without needing the transport.
      const at = times[index] as number
      if (voice instanceof Tone.PluckSynth) {
        voice.triggerAttack(note, at)
      } else {
        voice.triggerAttackRelease(note, recipe.duration, at)
      }
    })
    lastScheduled.set(recipe.voice, times[times.length - 1] as number)
  }

  return {
    play(key) {
      const recipe = theme.stingers[key]
      if (recipe) play(recipe)
    },
    dispose() {
      for (const voice of Object.values(voices)) voice.dispose()
    },
  }
}
