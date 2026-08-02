/**
 * A decoded MIDI track: notes with absolute times, ready to schedule.
 *
 * Lives in `shared/` because it is a **seam** — `data/` decodes into this shape and
 * `audio/` schedules from it, and neither zone may import the other. It passes the
 * admission test on both counts: used by two top-level folders, importing nothing
 * outside `shared/`.
 *
 * Times are **seconds, not ticks**. Decoding resolves the file's tempo map up front,
 * so a track with tempo changes needs no special handling at playback: the scheduler
 * fires absolute times and never has to know what a beat was worth. Ticks would push
 * that arithmetic into the audio layer, where it would have to be redone against the
 * transport's own tempo.
 */

export interface MidiNote {
  /** Seconds from the start of the track. */
  time: number
  /** Seconds the note is held. */
  duration: number
  /** MIDI note number, 0..127. */
  note: number
  /**
   * 0..1, with the channel's mix already folded in.
   *
   * Note-on velocity scaled by CC 7 (channel volume) and CC 11 (expression) as they
   * stood when the note began. Composers use those to balance parts, so ignoring them
   * plays everything at the level of the loudest thing in the file.
   */
  velocity: number
  /** Zero-based MIDI channel, 0..15. Channel 9 is percussion by convention. */
  channel: number
  /**
   * The General MIDI program in force on this channel when the note began, 0..127.
   *
   * There is no soundfont here, so this does not select a sample — it selects a
   * *synth recipe*, by instrument family. That is a weaker claim than General MIDI
   * makes and still far better than ignoring it: a bass part and a string part come
   * out different, where keying voices off the channel number alone makes them
   * identical whenever they happen to sit next to each other.
   */
  program: number
  /** Stereo position from CC 10, -1 (left) to 1 (right). */
  pan: number
}

export interface MidiTrack {
  notes: MidiNote[]
  /**
   * Seconds until the track repeats.
   *
   * The later of the file's end-of-track marker and the end of the last note — **not**
   * the last note's end alone. Trailing silence is musical: a sequence that rests for
   * two bars before repeating says so with an end-of-track tick, and looping at the
   * last note instead cuts that rest and brings the loop back early.
   *
   * Zero when the file has no notes, which callers must treat as "nothing to play"
   * rather than looping instantly.
   */
  duration: number
}
