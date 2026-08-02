import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { midiPath, parseMidi } from './midi.js'

/**
 * The MIDI reader.
 *
 * Tested against hand-built bytes rather than only the shipped files, because the
 * cases that break a parser are the ones a well-behaved file never exercises —
 * running status, zero-velocity note-offs, a tempo map in a different track from the
 * notes it governs. Each of those silently loses notes rather than failing, which is
 * the failure mode a test has to catch.
 *
 * The shipped placeholders are then read as a smoke test: real sequencer output uses
 * every one of those tricks at once.
 */

/** A big-endian chunk: four ASCII bytes, a 32-bit length, then the body. */
const chunk = (tag: string, body: number[]): number[] => [
  ...[...tag].map((c) => c.charCodeAt(0)),
  (body.length >>> 24) & 0xff,
  (body.length >>> 16) & 0xff,
  (body.length >>> 8) & 0xff,
  body.length & 0xff,
  ...body,
]

const header = (format: number, tracks: number, division: number): number[] =>
  chunk('MThd', [0, format, 0, tracks, (division >> 8) & 0xff, division & 0xff])

const END_OF_TRACK = [0x00, 0xff, 0x2f, 0x00]

/**
 * A delta time, variable-length encoded.
 *
 * Anything over 127 needs more than one byte, and writing it raw is not a near miss —
 * a bare `192` is `0xc0`, whose high bit means "more follows", so the parser swallows
 * the next byte and the rest of the track desynchronises. Three of these tests were
 * wrong in exactly that way before this existed.
 */
const delta = (ticks: number): number[] => {
  const out = [ticks & 0x7f]
  let rest = ticks >> 7
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80)
    rest >>= 7
  }
  return out
}

const file = (division: number, tracks: number[][]): Uint8Array =>
  new Uint8Array([
    ...header(tracks.length > 1 ? 1 : 0, tracks.length, division),
    ...tracks.flatMap((events) => chunk('MTrk', [...events, ...END_OF_TRACK])),
  ])

describe('parseMidi', () => {
  it('reads a note as a time, a duration, a pitch and a velocity', () => {
    // 96 ticks per quarter, no tempo event, so the 120 bpm default applies: one
    // quarter note is 0.5s. CC 7 is set to full first so this isolates raw velocity —
    // the channel-volume default deliberately scales it, and that has its own test.
    const track = parseMidi(
      file(96, [[0x00, 0xb0, 0x07, 127, 0x00, 0x90, 60, 100, 96, 0x80, 60, 0x40]])
    )
    expect(track.notes).toHaveLength(1)
    const note = track.notes[0]!
    expect(note.time).toBeCloseTo(0, 6)
    expect(note.duration).toBeCloseTo(0.5, 6)
    expect(note.note).toBe(60)
    expect(note.velocity).toBeCloseTo(100 / 127, 6)
    expect(note.channel).toBe(0)
    expect(note.program).toBe(0)
    expect(note.pan).toBe(0)
  })

  it('treats a zero-velocity note-on as a note-off', () => {
    // Every sequencer does this to stay on running status. Reading it as an attack
    // leaves the note held forever, which sounds like a stuck key rather than a bug.
    const track = parseMidi(file(96, [[0x00, 0x90, 64, 80, 48, 0x90, 64, 0x00]]))
    expect(track.notes).toHaveLength(1)
    expect(track.notes[0]!.duration).toBeCloseTo(0.25, 6)
  })

  it('honours running status, which is where most of the notes live', () => {
    // Three note-ons and three note-offs with the status byte written once each.
    // Without running-status handling this yields garbage or throws.
    const track = parseMidi(
      file(96, [
        [
          0x00, 0x90, 60, 100, // explicit note-on
          0x00, 62, 100, // running: note-on
          0x00, 64, 100, // running: note-on
          96, 0x80, 60, 0x40, // explicit note-off
          0x00, 62, 0x40, // running: note-off
          0x00, 64, 0x40, // running: note-off
        ],
      ])
    )
    expect(track.notes.map((n) => n.note)).toEqual([60, 62, 64])
    expect(track.notes.every((n) => Math.abs(n.duration - 0.5) < 1e-6)).toBe(true)
  })

  it('applies a tempo map from one track to notes in another', () => {
    // The format 1 arrangement: tempo in track 0, notes in track 1. Reading them
    // per-track would leave the notes on the default tempo.
    const tempoTrack = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20] // 500000 µs = 120bpm
    const fastTempo = [0x00, 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90] // 250000 µs = 240bpm
    const notes = [0x00, 0x90, 60, 100, 96, 0x80, 60, 0x40]
    const slow = parseMidi(file(96, [tempoTrack, notes]))
    const fast = parseMidi(file(96, [fastTempo, notes]))
    expect(slow.notes[0]!.duration).toBeCloseTo(0.5, 6)
    // Twice the tempo, half the duration — proving the map was actually consulted.
    expect(fast.notes[0]!.duration).toBeCloseTo(0.25, 6)
  })

  it('integrates a tempo change mid-file rather than using only the first', () => {
    /**
     * A note starting after a tempo change must be placed using both tempos. Using
     * only the first would put it early, and the error compounds — one placeholder
     * track has sixty-two changes, so "close enough" drifts into nonsense.
     */
    const track = parseMidi(
      file(96, [
        [
          0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 120 bpm at tick 0
          96, 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90, // 240 bpm at tick 96
        ],
        [...delta(192), 0x90, 60, 100, 96, 0x80, 60, 0x40],
      ])
    )
    // First quarter at 120bpm (0.5s) + second at 240bpm (0.25s) = 0.75s.
    expect(track.notes[0]!.time).toBeCloseTo(0.75, 6)
  })

  it('reports duration as the end of the last note, not the last note-on', () => {
    // The loop point. Taking the last note-on would clip whatever is still ringing.
    const track = parseMidi(file(96, [[0x00, 0x90, 60, 100, ...delta(192), 0x80, 60, 0x40]]))
    expect(track.duration).toBeCloseTo(1, 6)
  })

  it('keeps the channel, since it is the only instrument hint a file carries', () => {
    const track = parseMidi(file(96, [[0x00, 0x99, 38, 100, 24, 0x89, 38, 0x40]]))
    expect(track.notes[0]!.channel).toBe(9)
  })

  it('skips events it does not decode instead of losing sync', () => {
    // A pitch bend, a controller, a program change and a sysex between two notes.
    // Mis-sizing any one of them desynchronises the rest of the track.
    const track = parseMidi(
      file(96, [
        [
          0x00, 0xb0, 0x07, 0x64, // controller: 2 data bytes
          0x00, 0xc0, 0x30, // program change: 1 data byte
          0x00, 0xe0, 0x00, 0x40, // pitch bend: 2 data bytes
          0x00, 0xf0, 0x02, 0x7d, 0xf7, // sysex, length-prefixed
          0x00, 0x90, 60, 100,
          96, 0x80, 60, 0x40,
        ],
      ])
    )
    expect(track.notes).toHaveLength(1)
    expect(track.notes[0]!.note).toBe(60)
  })

  it('holds a note left hanging at the end of a track rather than dropping it', () => {
    // A truncated file should lose a duration, not a note.
    const track = parseMidi(file(96, [[0x00, 0x90, 60, 100]]))
    expect(track.notes).toHaveLength(1)
    expect(track.notes[0]!.duration).toBe(0)
  })

  it('treats a repeat of a sounding pitch as a retrigger, ending the first note', () => {
    /**
     * MIDI cannot express two simultaneous identical pitches on one channel, so a
     * second note-on ends the first. Holding both and pairing them against later
     * note-offs would give one of them a duration spanning the other, which sounds
     * like a stuck key.
     */
    const track = parseMidi(
      file(96, [
        [0x00, 0x90, 60, 100, 48, 0x90, 60, 100, 48, 0x80, 60, 0x40, 96, 0x80, 60, 0x40],
      ])
    )
    expect(track.notes).toHaveLength(2)
    // Ticks 0–48 and 48–96, an eighth each. The trailing note-off matches nothing.
    expect(track.notes[0]!.duration).toBeCloseTo(0.25, 6)
    expect(track.notes[1]!.duration).toBeCloseTo(0.25, 6)
  })

  it('reads a multi-byte delta time, not just the ones under 128', () => {
    // The trap this suite fell into: 192 ticks is two VLQ bytes. A parser that read
    // one would place every later note wrongly, and the error accumulates.
    const track = parseMidi(
      file(96, [[...delta(1000), 0x90, 60, 100, ...delta(96), 0x80, 60, 0x40]])
    )
    expect(track.notes[0]!.time).toBeCloseTo((1000 / 96) * 0.5, 6)
  })

  it('sorts notes by time, so a scheduler can walk them in order', () => {
    const track = parseMidi(
      file(96, [
        [96, 0x90, 72, 100, 48, 0x80, 72, 0x40],
        [0x00, 0x90, 48, 100, 48, 0x80, 48, 0x40],
      ])
    )
    expect(track.notes.map((n) => n.note)).toEqual([48, 72])
  })

  it('folds CC 7 channel volume into velocity', () => {
    /**
     * The mix the composer wrote. Ignoring CC 7 plays every part at the level of the
     * loudest thing in the file, which is most of why a dense arrangement sounds
     * like a wall rather than an arrangement.
     */
    const quiet = parseMidi(file(96, [[0x00, 0xb0, 0x07, 40, 0x00, 0x90, 60, 127, 96, 0x80, 60, 0x40]]))
    const loud = parseMidi(file(96, [[0x00, 0xb0, 0x07, 127, 0x00, 0x90, 60, 127, 96, 0x80, 60, 0x40]]))
    expect(quiet.notes[0]!.velocity).toBeCloseTo(40 / 127, 6)
    expect(loud.notes[0]!.velocity).toBeCloseTo(1, 6)
  })

  it('defaults channel volume to 100, not full scale', () => {
    // General MIDI's stated default. Starting at 127 makes every file that never sets
    // CC 7 louder than the ones that do.
    const track = parseMidi(file(96, [[0x00, 0x90, 60, 127, 96, 0x80, 60, 0x40]]))
    expect(track.notes[0]!.velocity).toBeCloseTo(100 / 127, 6)
  })

  it('folds CC 11 expression in as well, on top of volume', () => {
    const track = parseMidi(
      file(96, [[0x00, 0xb0, 0x07, 127, 0x00, 0xb0, 0x0b, 64, 0x00, 0x90, 60, 127, 96, 0x80, 60, 0x40]])
    )
    expect(track.notes[0]!.velocity).toBeCloseTo(64 / 127, 6)
  })

  it('reads CC 10 as pan, centred at 64', () => {
    const left = parseMidi(file(96, [[0x00, 0xb0, 0x0a, 0, 0x00, 0x90, 60, 100, 96, 0x80, 60, 0x40]]))
    const centre = parseMidi(file(96, [[0x00, 0xb0, 0x0a, 64, 0x00, 0x90, 60, 100, 96, 0x80, 60, 0x40]]))
    const right = parseMidi(file(96, [[0x00, 0xb0, 0x0a, 127, 0x00, 0x90, 60, 100, 96, 0x80, 60, 0x40]]))
    expect(left.notes[0]!.pan).toBe(-1)
    expect(centre.notes[0]!.pan).toBe(0)
    /**
     * Full right is 0.984, not 1 — the range either side of a 64 centre is 64 steps
     * down and only 63 up, so CC 10 cannot reach hard right. That asymmetry is in the
     * format, not a rounding slip, and the clamp in the parser is therefore defensive
     * against malformed values rather than something valid input reaches.
     */
    expect(right.notes[0]!.pan).toBeCloseTo(63 / 64, 6)
  })

  it('captures the program in force when a note begins', () => {
    // The instrument hint. A program change after the note must not retroactively
    // change it, or a voice swap mid-phrase rewrites what already sounded.
    const track = parseMidi(
      file(96, [
        [
          0x00, 0xc0, 32, // program 32: bass
          0x00, 0x90, 60, 100,
          96, 0x80, 60, 0x40,
          0x00, 0xc0, 48, // program 48: strings, after the first note
          0x00, 0x90, 62, 100,
          96, 0x80, 62, 0x40,
        ],
      ])
    )
    expect(track.notes.map((n) => n.program)).toEqual([32, 48])
  })

  it('applies a controller written in another track, at the right tick', () => {
    /**
     * The reason decoding is two passes. A format 1 file may put CC 7 for channel 0 in
     * one track and the notes in another; interpreting track by track would apply it
     * only to whatever came later in file order.
     */
    const track = parseMidi(
      file(96, [
        [0x00, 0xb0, 0x07, 40],
        [0x00, 0x90, 60, 127, 96, 0x80, 60, 0x40],
      ])
    )
    expect(track.notes[0]!.velocity).toBeCloseTo(40 / 127, 6)
  })

  it('releases held notes on CC 120 and CC 123', () => {
    // All-sound-off / all-notes-off. Ignoring them leaves every note on that channel
    // held until the end of the track.
    for (const controller of [120, 123]) {
      const track = parseMidi(file(96, [[0x00, 0x90, 60, 100, 48, 0xb0, controller, 0]]))
      expect(track.notes, `cc ${controller}`).toHaveLength(1)
      expect(track.notes[0]!.duration, `cc ${controller}`).toBeCloseTo(0.25, 6)
    }
  })

  it('leaves notes on other channels alone when one channel is silenced', () => {
    const track = parseMidi(
      file(96, [
        [0x00, 0x90, 60, 100, 0x00, 0x91, 62, 100, 48, 0xb0, 123, 0, 48, 0x81, 62, 0x40],
      ])
    )
    const byChannel = new Map(track.notes.map((n) => [n.channel, n]))
    expect(byChannel.get(0)!.duration).toBeCloseTo(0.25, 6)
    expect(byChannel.get(1)!.duration).toBeCloseTo(0.5, 6)
  })

  it('loops at the end-of-track marker, keeping trailing silence', () => {
    /**
     * The bug this exists for. A sequence that rests before repeating says so with a
     * late end-of-track tick; taking the last note's end instead cuts the rest and the
     * loop comes back early. Here the note ends at tick 96 and the track at 384.
     */
    const withRest = new Uint8Array([
      ...header(0, 1, 96),
      ...chunk('MTrk', [
        0x00, 0x90, 60, 100,
        96, 0x80, 60, 0x40,
        ...delta(288), 0xff, 0x2f, 0x00,
      ]),
    ])
    const track = parseMidi(withRest)
    expect(track.notes[0]!.time + track.notes[0]!.duration).toBeCloseTo(0.5, 6)
    // Four quarter notes at 120bpm.
    expect(track.duration).toBeCloseTo(2, 6)
  })

  it('still uses the last note when end-of-track comes early', () => {
    // A truncated or mis-written file should not loop before its own notes finish.
    const track = parseMidi(file(96, [[0x00, 0x90, 60, 100, ...delta(192), 0x80, 60, 0x40]]))
    expect(track.duration).toBeCloseTo(1, 6)
  })

  it('refuses input that is not a MIDI file', () => {
    // Loudly, rather than returning an empty track: silence is harder to diagnose.
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4]))).toThrow(/missing MThd/)
  })

  it('refuses SMPTE time division rather than playing at a wrong speed', () => {
    // A negative division is frames-per-second, a different time base entirely.
    expect(() => parseMidi(file(0xe728, [[]]))).toThrow(/SMPTE/)
  })

  it('refuses a zero division, which would divide by zero into NaN times', () => {
    expect(() => parseMidi(file(0, [[]]))).toThrow(/zero ticks/)
  })

  it('returns an empty track for a file with no notes', () => {
    const track = parseMidi(file(96, [[]]))
    expect(track.notes).toEqual([])
    expect(track.duration).toBe(0)
  })
})

describe('the shipped placeholder tracks', () => {
  /**
   * A smoke test over real sequencer output, which combines every trick above at
   * once. Deliberately asserts only what must be true of any playable track rather
   * than exact note counts — these are placeholders and are expected to be replaced.
   */
  it.each(['jolly', 'serious', 'neon', 'vapour', 'cobalt'])('decodes %s.mid', (id) => {
    const track = parseMidi(new Uint8Array(readFileSync(`public/${midiPath(id)}`)))
    expect(track.notes.length).toBeGreaterThan(0)
    expect(track.duration).toBeGreaterThan(0)
    for (const note of track.notes) {
      expect(note.time).toBeGreaterThanOrEqual(0)
      expect(note.time).toBeLessThanOrEqual(track.duration)
      expect(note.duration).toBeGreaterThanOrEqual(0)
      expect(note.note).toBeGreaterThanOrEqual(0)
      expect(note.note).toBeLessThanOrEqual(127)
      expect(note.velocity).toBeGreaterThan(0)
      expect(note.velocity).toBeLessThanOrEqual(1)
      expect(note.channel).toBeGreaterThanOrEqual(0)
      expect(note.channel).toBeLessThanOrEqual(15)
    }
  })

  it('names a track file from its theme id', () => {
    expect(midiPath('jolly')).toBe('midi/jolly.mid')
  })
})
