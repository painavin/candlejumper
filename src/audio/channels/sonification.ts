import * as Tone from 'tone'
import type { AudioTheme } from '@content/audioThemes/types.js'
import { clamp } from '@shared/math/index.js'

/**
 * Channel 2 — movement sonification: the piece that makes price movement audible
 * on every jump.
 *
 *   - **direction** → pitch step direction (up move = step up)
 *   - **magnitude** → interval size (bigger move = bigger jump in pitch)
 *   - quantized into the theme's **scale**, which is what keeps the result from
 *     ever sounding dissonant regardless of what the price data does
 *
 * Themes change the scale and the timbre; they never change that guarantee.
 */

export interface Sonification {
  /** One note per bar, from the move into that bar. */
  playMove(previousClose: number, close: number): void
  dispose(): void
}

/**
 * A 5% move maps to the full width of the scale. Beyond that the interval saturates
 * rather than running off the top — a crash should sound extreme, not silent.
 */
const FULL_SCALE_MOVE = 0.05

export function createSonification(theme: AudioTheme, destination: Tone.InputNode): Sonification {
  const { scale, instrument, volume } = theme.sonification

  const voice =
    instrument === 'bell'
      ? new Tone.Synth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.003, decay: 0.3, sustain: 0, release: 0.2 },
        })
      : new Tone.Synth({
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.04, decay: 0.4, sustain: 0.1, release: 0.4 },
        })
  voice.volume.value = volume
  voice.connect(destination)

  /** The scale index the last note landed on; moves step from there. */
  let cursor = Math.floor(scale.length / 2)

  return {
    playMove(previousClose, close) {
      if (!(previousClose > 0)) return
      const change = (close - previousClose) / previousClose
      const magnitude = clamp(Math.abs(change) / FULL_SCALE_MOVE, 0, 1)
      const steps = Math.round(magnitude * (scale.length - 1))
      const direction = change >= 0 ? 1 : -1

      cursor = clamp(cursor + steps * direction, 0, scale.length - 1)
      const note = scale[cursor]
      if (note) voice.triggerAttackRelease(note, '16n')
    },

    dispose() {
      voice.dispose()
    },
  }
}
