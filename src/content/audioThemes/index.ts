import type { AudioTheme } from './types.js'

/**
 * Two moods. Adding a third is another object of this size — no engine changes and
 * no audio production.
 *
 * The rule that shapes both: **`stoppedOut` must be deliberately different from
 * `positionClosed.loss`.** A triggered stop should *feel* different from a
 * deliberate exit, not just look different in a log — that distinction is the whole
 * point of the discipline lesson. So each theme's stop-out cue is more jarring than
 * its own manual-loss cue, whatever its overall tone.
 */

export const jollyAudioTheme: AudioTheme = {
  id: 'jolly',
  displayName: 'Jolly',
  bed: {
    // I–V–vi–IV: bright and resolved.
    progression: [
      ['C3', 'E3', 'G3'],
      ['G2', 'B2', 'D3'],
      ['A2', 'C3', 'E3'],
      ['F2', 'A2', 'C3'],
    ],
    instrument: 'pluck',
    register: 4,
    noteRateRange: [0.4, 1.6],
    reverbSend: 0.28,
    delaySend: 0.18,
    chordSeconds: 6,
  },
  sonification: {
    // Major pentatonic: cheerful, and impossible to make dissonant.
    scale: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5'],
    instrument: 'bell',
    volume: -14,
  },
  stingers: {
    positionOpened: { voice: 'bell', notes: ['C5', 'G5'], step: 0.07, duration: '16n', volume: -12 },
    positionIncreased: { voice: 'bell', notes: ['G5'], step: 0.05, duration: '32n', volume: -16 },
    'positionClosed.profit': {
      voice: 'bell',
      notes: ['C5', 'E5', 'G5', 'C6'],
      step: 0.075,
      duration: '16n',
      volume: -10,
    },
    'positionClosed.loss': {
      voice: 'pluck',
      notes: ['E4', 'D4', 'B3'],
      step: 0.1,
      duration: '8n',
      volume: -12,
    },
    // Playful "uh-oh", still clearly worse than the loss cue above.
    stoppedOut: {
      voice: 'buzz',
      notes: ['A3', 'Eb3'],
      step: 0.16,
      duration: '4n',
      volume: -8,
    },
    actionDenied: { voice: 'thud', notes: ['C2'], step: 0.05, duration: '32n', volume: -18 },
  },
}

export const seriousAudioTheme: AudioTheme = {
  id: 'serious',
  displayName: 'Serious',
  bed: {
    // i–VI–III–VII: minor and unresolved.
    progression: [
      ['A2', 'C3', 'E3'],
      ['F2', 'A2', 'C3'],
      ['C3', 'E3', 'G3'],
      ['G2', 'B2', 'D3'],
    ],
    instrument: 'pad',
    register: 3,
    noteRateRange: [1.2, 3.4],
    reverbSend: 0.5,
    delaySend: 0.3,
    chordSeconds: 9,
  },
  sonification: {
    // Minor pentatonic: same dissonance guarantee, colder flavour.
    scale: ['A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5'],
    instrument: 'string',
    volume: -16,
  },
  stingers: {
    positionOpened: { voice: 'tone', notes: ['A4'], step: 0.04, duration: '32n', volume: -18 },
    positionIncreased: { voice: 'tone', notes: ['E4'], step: 0.04, duration: '32n', volume: -20 },
    'positionClosed.profit': {
      voice: 'pluck',
      notes: ['A4', 'E5'],
      step: 0.09,
      duration: '8n',
      volume: -13,
    },
    'positionClosed.loss': {
      voice: 'tone',
      notes: ['E3', 'C3'],
      step: 0.12,
      duration: '4n',
      volume: -14,
    },
    // A sharp buzzer — clearly worse than this theme's own loss tone.
    stoppedOut: { voice: 'buzz', notes: ['Bb3', 'Bb3'], step: 0.13, duration: '8n', volume: -8 },
    // Dry and lower than the entry click, so it can't be confused with a fill.
    actionDenied: { voice: 'thud', notes: ['G1'], step: 0.04, duration: '32n', volume: -20 },
  },
}

export const audioThemes: readonly AudioTheme[] = [jollyAudioTheme, seriousAudioTheme]

export function audioTheme(id: string): AudioTheme {
  return audioThemes.find((theme) => theme.id === id) ?? jollyAudioTheme
}
