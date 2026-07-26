import * as Tone from 'tone'
import type { AudioTheme, StingerRecipe } from '@content/audioThemes/types.js'

/**
 * Channel 3 — event stingers.
 *
 * Stingers are keyed to **semantic position events, not button names.** This
 * distinction is load-bearing rather than stylistic: when short, the *closing*
 * action is `buy`, so a stinger fired on the sell button would misfire on every
 * short exit — playing an exit sound on entry and vice versa. The keys here are the
 * event keys the engine emits, so that mistake is unrepresentable.
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

  const play = (recipe: StingerRecipe): void => {
    const voice = voices[recipe.voice]
    voice.volume.value = recipe.volume
    const now = Tone.now()
    recipe.notes.forEach((note, index) => {
      // Nudged forward per note so an arpeggio reads as one gesture rather than a
      // chord, without needing the transport.
      const at = now + index * recipe.step
      if (voice instanceof Tone.PluckSynth) {
        voice.triggerAttack(note, at)
      } else {
        voice.triggerAttackRelease(note, recipe.duration, at)
      }
    })
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
