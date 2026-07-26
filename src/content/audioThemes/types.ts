/**
 * An audio theme is a **parameter set, not an asset bundle** — every sound is
 * synthesized by Tone.js at runtime, so there are no audio files at all.
 *
 * A theme defines content for **all three channels at once**, so switching mood
 * never leaves them mismatched (a jolly bed under a harsh trading-floor stinger).
 * Playback code always asks "what does the *current* theme supply for channel N"
 * and never branches on theme id.
 */

/** A synth recipe. Enough to build a one-shot without naming a Tone class per event. */
export interface StingerRecipe {
  /**
   * `pluck` and `bell` are bright and short; `tone` is a plain oscillator; `thud`
   * and `buzz` are deliberately unmusical, for cues that must not be mistaken for
   * a fill.
   */
  voice: 'pluck' | 'bell' | 'tone' | 'thud' | 'buzz'
  /** Note names, played in order. One note is a blip, several an arpeggio. */
  notes: string[]
  /** Seconds per note. */
  step: number
  /** Note length, as a Tone duration. */
  duration: string
  /** Decibels, relative. */
  volume: number
}

export interface AudioTheme {
  id: string
  displayName: string

  /** Channel 1: the generative ambient bed. */
  bed: {
    /**
     * A **fixed** chord progression per theme. This is the deliberate mitigation
     * for generative ambient's known failure mode — wandering aimlessly and
     * turning monotonous. The randomness lives in the surface (voicing, register,
     * timing), not the harmony.
     */
    progression: string[][]
    instrument: 'pad' | 'pluck'
    /** Octave the voicing is centred on. */
    register: number
    /** Seconds between notes, sampled from this range by the seeded PRNG. */
    noteRateRange: [number, number]
    /** 0..1 sends. Ambience does more for perceived mood than note choice does. */
    reverbSend: number
    delaySend: number
    /** Seconds per chord. */
    chordSeconds: number
  }

  /** Channel 2: movement sonification. */
  sonification: {
    /**
     * Quantizing into a scale keeps the result from ever sounding dissonant,
     * whatever the underlying price data does. Themes change the flavour, never
     * that guarantee.
     */
    scale: string[]
    instrument: 'bell' | 'string'
    volume: number
  }

  /** Channel 3: event stingers, keyed to semantic position events. */
  stingers: {
    positionOpened: StingerRecipe
    positionIncreased: StingerRecipe
    'positionClosed.profit': StingerRecipe
    'positionClosed.loss': StingerRecipe
    /** Must be clearly more jarring than this theme's own loss cue. */
    stoppedOut: StingerRecipe
    /** Short, dry, unmistakably *not* a trade sound. */
    actionDenied: StingerRecipe
  }
}

export type StingerKey = keyof AudioTheme['stingers']
