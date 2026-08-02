import type { AudioTheme } from './types.js'

/**
 * Five moods. Adding a sixth is another object of this size — no engine changes, and
 * no audio production *unless* it wants a composed bed: a theme may ship
 * `public/midi/<id>.mid`, which replaces the generated bed with a sequenced one. Every
 * bundle below still defines a full generated bed, because that is what plays when the
 * file is absent or fails to load, and a mood whose fallback is silence turns a network
 * hiccup into a bug report.
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
    /**
     * I–vi–IV–V, with sixths added.
     *
     * The added sixth is the whole reason this reads as *cheerful* rather than merely
     * major: a plain triad is neutral, and C–E–G–A is the sound of an era of music
     * that could not stop grinning. I–vi–IV–V also turns over faster than the old
     * I–V–vi–IV and lands back on the tonic, which keeps a two-bar chord from
     * feeling like waiting.
     */
    progression: [
      ['C3', 'E3', 'G3', 'A3'],
      ['A2', 'C3', 'E3', 'G3'],
      ['F2', 'A2', 'C3', 'D3'],
      ['G2', 'B2', 'D3', 'E3'],
    ],
    instrument: 'pluck',
    register: 4,
    /**
     * The pulse below replaces this engine, so `noteRateRange`, `noteOverlap`, and
     * `chordSeconds` are unused for this theme. Left in place because dropping the
     * pulse is the way to hear the ambient version, and having to reinvent these
     * numbers to do that would make the comparison annoying enough not to bother.
     */
    noteRateRange: [0.7, 2.2],
    noteOverlap: 1.6,
    chordSeconds: 8,
    // Quiet: the pulse carries continuity, so the drone is only there to stop the
    // bottom falling out between phrases.
    droneLevel: 0.16,
    // Restrained, so the rhythm stays crisp. Wash is the enemy of bounce.
    reverbSend: 0.2,
    delaySend: 0.12,
    pulse: {
      // Brisk enough to feel like running, slow enough to read the chart under it.
      tempo: 138,
      // The lilt. Straight, this groove is a metronome; at 0.3 it skips.
      swing: 0.3,
      barsPerChord: 2,
      /**
       * Bass, per eighth: root on the beat, fifth after it, walking up to the third
       * at the end of the bar so the figure leads somewhere instead of looping in
       * place. `-1` is a rest — the rests are what make it bounce rather than drone.
       */
      bassPattern: [0, -1, 2, -1, 0, -1, 2, 1],
      /**
       * Stabs on the off-beats, against a bass that plays on the beats. This is the
       * oom-pah, and it is doing more work here than any other single parameter.
       *
       * The last eighth is left empty on purpose: that's where the bass walks up to
       * the third, and a stab on top of the pick-up buries the one note in the figure
       * that's leading somewhere. The hole also gives the bar a breath before it
       * turns over.
       */
      stabPattern: [0, 1, 0, 1, 0, 1, 0, 0],
      /**
       * Melody, per sixteenth. Syncopated on purpose: notes on the 1, the back half
       * of beat 2, and across beat 3 — landing off the grid is what stops a generated
       * line sounding like an exercise. The gap at the end of the bar lets it breathe.
       */
      melodyPattern: [1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0],
      // Four bars: long enough to be a phrase, short enough to recognise on its
      // second pass. Two lands as a stutter, eight is a tune nobody remembers.
      phraseBars: 4,
      levels: { bass: 0.85, stabs: 0.5, melody: 0.7 },
    },
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
    noteRateRange: [1.6, 3.8],
    // Heavier drone than jolly: this theme is mostly foundation with occasional
    // movement over it, where jolly is the other way round.
    droneLevel: 0.6,
    noteOverlap: 1.8,
    reverbSend: 0.6,
    delaySend: 0.32,
    chordSeconds: 12,
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

/**
 * Neon: cold, wide, unhurried. The counterpart to the near-black visual mood.
 *
 * The bed here is a **fallback**, not the intended sound — `public/midi/neon.mid`
 * replaces it whenever the file loads. It still has to be right, because it is what
 * plays if the fetch fails, and a theme whose fallback is silence would turn a network
 * hiccup into a bug report. That is also why these three themes exist at all as full
 * bundles: the mood picker lists ids present in *both* registries, so a visuals-only
 * theme is unreachable from it however good its track is.
 */
export const neonAudioTheme: AudioTheme = {
  id: 'neon',
  displayName: 'Neon',
  bed: {
    // i–v–VI–IV in D minor: circular rather than resolving, which is what lets a long
    // chord sit without asking to move on.
    progression: [
      ['D2', 'F2', 'A2'],
      ['A2', 'C3', 'E3'],
      ['Bb2', 'D3', 'F3'],
      ['G2', 'Bb2', 'D3'],
    ],
    instrument: 'pad',
    register: 3,
    noteRateRange: [2.2, 4.6],
    // The heaviest drone of any mood: this one is nearly all foundation.
    droneLevel: 0.72,
    noteOverlap: 2,
    reverbSend: 0.72,
    delaySend: 0.4,
    chordSeconds: 14,
  },
  sonification: {
    // Dorian-flavoured pentatonic — minor without the leading-tone pull, so a long
    // run of up-moves does not start sounding like it wants to land somewhere.
    scale: ['D3', 'F3', 'G3', 'A3', 'C4', 'D4', 'F4', 'G4'],
    instrument: 'bell',
    volume: -15,
  },
  stingers: {
    positionOpened: { voice: 'bell', notes: ['D5'], step: 0.05, duration: '32n', volume: -14 },
    positionIncreased: { voice: 'bell', notes: ['A5'], step: 0.04, duration: '32n', volume: -18 },
    'positionClosed.profit': {
      voice: 'bell',
      notes: ['D5', 'A5', 'D6'],
      step: 0.07,
      duration: '16n',
      volume: -12,
    },
    'positionClosed.loss': {
      voice: 'tone',
      notes: ['F3', 'D3'],
      step: 0.13,
      duration: '4n',
      volume: -13,
    },
    stoppedOut: { voice: 'buzz', notes: ['Db3', 'Db3'], step: 0.12, duration: '8n', volume: -8 },
    actionDenied: { voice: 'thud', notes: ['D2'], step: 0.04, duration: '32n', volume: -19 },
  },
}

/**
 * Vapour: bright, saturated, plastic. Loud where `neon` is wide.
 *
 * `pulse` is present, so the fallback bed is **metered** rather than ambient — the
 * visual mood is the most energetic of the five and an ambient drone under it would
 * read as a mismatch. Same reason `jolly` has one: meter is what a bed needs to be
 * anything other than atmospheric.
 */
export const vapourAudioTheme: AudioTheme = {
  id: 'vapour',
  displayName: 'Vapour',
  bed: {
    // I–III–IV–iv: the major-third lift, then a minor-fourth shadow. Bright and slightly
    // wrong, which is the whole idea.
    progression: [
      ['F2', 'A2', 'C3', 'E3'],
      ['A2', 'Db3', 'E3'],
      ['Bb2', 'D3', 'F3'],
      ['Bb2', 'Db3', 'F3'],
    ],
    instrument: 'pluck',
    register: 4,
    noteRateRange: [0.6, 1.8],
    droneLevel: 0.2,
    noteOverlap: 1.5,
    reverbSend: 0.34,
    delaySend: 0.26,
    chordSeconds: 8,
    pulse: {
      tempo: 118,
      // Straighter than jolly: this mood is meant to drive rather than skip.
      swing: 0.12,
      barsPerChord: 2,
      // Root on every beat with an octave push between — a four-on-the-floor bass.
      bassPattern: [0, -1, 0, 2, 0, -1, 0, 1],
      // Stabs on every off-beat, which against that bass is the genre's whole rhythm.
      stabPattern: [0, 1, 0, 1, 0, 1, 0, 1],
      melodyPattern: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      phraseBars: 4,
      levels: { bass: 0.6, stabs: 0.34, melody: 0.44 },
    },
  },
  sonification: {
    // Major pentatonic, high: the brightest scale of the five, to match the palette.
    scale: ['F4', 'G4', 'A4', 'C5', 'D5', 'F5', 'G5', 'A5'],
    instrument: 'bell',
    volume: -14,
  },
  stingers: {
    positionOpened: { voice: 'pluck', notes: ['F5', 'C6'], step: 0.06, duration: '16n', volume: -12 },
    positionIncreased: { voice: 'pluck', notes: ['C6'], step: 0.04, duration: '32n', volume: -16 },
    'positionClosed.profit': {
      voice: 'bell',
      notes: ['F5', 'A5', 'C6', 'F6'],
      step: 0.06,
      duration: '16n',
      volume: -10,
    },
    'positionClosed.loss': {
      voice: 'tone',
      notes: ['Db4', 'Bb3'],
      step: 0.11,
      duration: '8n',
      volume: -13,
    },
    stoppedOut: { voice: 'buzz', notes: ['Eb3', 'Eb3'], step: 0.11, duration: '8n', volume: -7 },
    actionDenied: { voice: 'thud', notes: ['F2'], step: 0.04, duration: '32n', volume: -18 },
  },
}

/**
 * Cobalt: clean and neutral, the quiet one.
 *
 * Deliberately the least characterful bundle of the five. The visual mood is a
 * presentation chart rather than a landscape, and a sound design with opinions would
 * fight that — this is the mood for someone who wants the game to look and sound like
 * an instrument. Its stingers are the driest here for the same reason.
 */
export const cobaltAudioTheme: AudioTheme = {
  id: 'cobalt',
  displayName: 'Cobalt',
  bed: {
    // I–V–vi–IV in C, the plainest progression available, at a slow turn.
    progression: [
      ['C3', 'E3', 'G3'],
      ['G2', 'B2', 'D3'],
      ['A2', 'C3', 'E3'],
      ['F2', 'A2', 'C3'],
    ],
    instrument: 'pad',
    register: 3,
    noteRateRange: [1.8, 4],
    droneLevel: 0.54,
    noteOverlap: 1.7,
    // The driest of the five: reverb is atmosphere, and this mood has none on purpose.
    reverbSend: 0.3,
    delaySend: 0.14,
    chordSeconds: 11,
  },
  sonification: {
    // Plain major pentatonic in the middle of the range — the most neutral option that
    // still cannot sound dissonant.
    scale: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5'],
    instrument: 'bell',
    volume: -16,
  },
  stingers: {
    positionOpened: { voice: 'tone', notes: ['C5'], step: 0.04, duration: '32n', volume: -17 },
    positionIncreased: { voice: 'tone', notes: ['G4'], step: 0.04, duration: '32n', volume: -20 },
    'positionClosed.profit': {
      voice: 'pluck',
      notes: ['C5', 'G5'],
      step: 0.08,
      duration: '16n',
      volume: -13,
    },
    'positionClosed.loss': {
      voice: 'tone',
      notes: ['G3', 'D3'],
      step: 0.12,
      duration: '4n',
      volume: -14,
    },
    stoppedOut: { voice: 'buzz', notes: ['B2', 'B2'], step: 0.14, duration: '8n', volume: -8 },
    actionDenied: { voice: 'thud', notes: ['C2'], step: 0.04, duration: '32n', volume: -20 },
  },
}

export const audioThemes: readonly AudioTheme[] = [
  jollyAudioTheme,
  seriousAudioTheme,
  neonAudioTheme,
  vapourAudioTheme,
  cobaltAudioTheme,
]

export function audioTheme(id: string): AudioTheme {
  return audioThemes.find((theme) => theme.id === id) ?? jollyAudioTheme
}
