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

/**
 * The metered mode for channel 1.
 *
 * Present on a theme when its bed should have a **pulse** rather than drift.
 * Absent, the bed is ambient — a drone plus sparsely timed gestures.
 *
 * This exists because ambient cannot be *cheerful*. Cheerfulness in game music comes
 * from meter: a bouncing bass, accents landing between the beats, a shuffle, and a
 * phrase short enough to recognise when it comes round again. None of those are
 * expressible as "randomize the timing of single notes", so a bed asked to be jolly
 * needs a different engine rather than different parameters.
 *
 * Everything here is data. Patterns are step arrays, so retuning the groove means
 * editing numbers in `audioThemes/index.ts` — no new code path per theme.
 */
export interface BedPulse {
  /** Beats per minute. Sets the shared Tone transport tempo. */
  tempo: number
  /**
   * Shuffle amount, 0..1, applied to eighths.
   *
   * The single most effective cheerfulness lever available. A straight grid reads as
   * mechanical however bright the timbre; a little lilt reads as playful.
   */
  swing: number
  /** Bars per chord, so changes land on a bar line rather than mid-phrase. */
  barsPerChord: number
  /**
   * Bass line, one entry per **eighth note**, one bar long.
   *
   * Values index the chord's own tones (0 = root, 1 = third, 2 = fifth, wrapping),
   * and `-1` is a rest. An alternating root/fifth figure is the classic bounce —
   * it's what makes a line feel like walking rather than sitting.
   */
  bassPattern: number[]
  /**
   * Chord stabs, one entry per eighth note. 1 plays, 0 rests.
   *
   * Putting these on the **off**-beats against the bass's on-beats is the oom-pah
   * that carries the whole feel. Straight-through stabs sound like a metronome.
   */
  stabPattern: number[]
  /**
   * Melody rhythm, one entry per **sixteenth note**, one bar long. 1 plays, 0 rests.
   *
   * Syncopation lives here: notes landing off the grid are what stop a generated
   * line sounding like an exercise.
   */
  melodyPattern: number[]
  /**
   * How many bars the melodic contour spans before repeating.
   *
   * The contour is generated once from the seed and then **reused**, remapped onto
   * whatever chord is current. Repetition is what makes a melody a melody rather
   * than a sequence of correct notes — and remapping is what keeps it in key while
   * the harmony moves.
   */
  phraseBars: number
  /** Per-layer levels, 0..1. */
  levels: { bass: number; stabs: number; melody: number }
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
    /** The *surface* voice. The sustained drone underneath is not skinnable. */
    instrument: 'pad' | 'pluck'
    /** Octave the voicing is centred on. */
    register: number
    /** Seconds between note gestures, sampled from this range by the seeded PRNG. */
    noteRateRange: [number, number]
    /**
     * How loud the sustained drone sits under the notes, 0..1.
     *
     * **This is the continuity knob.** The drone is the only layer that is always
     * sounding; the notes are sparse by design. At 0 there is no drone and the bed
     * goes back to being a trickle of separate events with silence between them,
     * which is what it used to be. Somewhere around 0.5 it reads as music.
     */
    droneLevel: number
    /**
     * Note length as a multiple of the gap that follows it.
     *
     * Above 1 means consecutive gestures always overlap, which is what makes the
     * surface read as one line rather than separate hits. Below 1 leaves audible
     * holes. 1.4–2 is the useful range; much higher and the notes pile into mud.
     */
    noteOverlap: number
    /** 0..1 sends. Ambience does more for perceived mood than note choice does. */
    reverbSend: number
    delaySend: number
    /** Seconds per chord. Chord changes crossfade, so this can be long. */
    chordSeconds: number
    /**
     * Present ⇒ the bed is metered instead of ambient, and `noteRateRange`,
     * `noteOverlap`, `instrument`, and `chordSeconds` are unused.
     *
     * `droneLevel` still applies and is worth keeping low here: with a pulse
     * carrying continuity, a prominent drone only muddies it.
     */
    pulse?: BedPulse
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
