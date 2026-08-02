import type { MidiNote, MidiTrack } from '@shared/contracts/index.js'

/**
 * A Standard MIDI File reader: bytes in, notes with absolute times out.
 *
 * Hand-rolled rather than `@tonejs/midi`, for the same reason the PRNG and the noise
 * generators are: this needs one function's worth of the format, and as a pure
 * bytes-to-events transform it is directly testable, where a dependency's behaviour
 * is not. It also keeps the parser out of the audio bundle's dependency graph.
 *
 * ## Two passes, not one
 *
 * Reading happens per track, but interpretation cannot: a format 1 file keeps its
 * tempo map in track 0 and its notes in the others, and controller changes on a
 * channel may be written in a different track from the notes they govern. So pass one
 * collects raw events with their ticks, pass two sorts them into one timeline and
 * walks it, carrying tempo and per-channel state forward.
 *
 * Interpreting track by track was the first shape and it was wrong in a way nothing
 * would have failed on: notes came out at plausible times with the wrong mix, because
 * a CC 7 written in a later track had not been seen yet.
 *
 * ## What is decoded, and what is skipped
 *
 * Notes, the tempo map, program changes, and CC 7 / 11 / 10 / 120 / 123. Skipped:
 * pitch bend, aftertouch, every other controller, sysex, and all meta events except
 * tempo and end-of-track — with no soundfont and no per-note pitch automation, they
 * have nothing to act on here.
 */

const META = 0xff
const SYSEX = 0xf0
const SYSEX_ESCAPE = 0xf7
const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CONTROL_CHANGE = 0xb0
const PROGRAM_CHANGE = 0xc0
const CHANNEL_PRESSURE = 0xd0
const META_TEMPO = 0x51
const META_END_OF_TRACK = 0x2f
const MAX_VALUE = 127

/** Controllers that carry mix information rather than timbre. */
const CC_CHANNEL_VOLUME = 7
const CC_PAN = 10
const CC_EXPRESSION = 11
const CC_ALL_SOUND_OFF = 120
const CC_ALL_NOTES_OFF = 123

/**
 * Microseconds per quarter note when a file says nothing.
 *
 * 500000 is 120 bpm, which the specification names as the default. A file with no
 * tempo event is common enough that falling back is the difference between playing at
 * the wrong speed and not playing at all.
 */
const DEFAULT_TEMPO = 500_000

/**
 * Channel volume before any CC 7 arrives.
 *
 * 100, not 127, because that is General MIDI's stated default — a file that never
 * sends CC 7 expects to sit below full scale, and starting at 127 makes every such
 * file louder than the ones that do set it.
 */
const DEFAULT_CHANNEL_VOLUME = 100

/** Centre pan, as CC 10 expresses it. */
const PAN_CENTRE = 64

interface Cursor {
  readonly bytes: Uint8Array
  offset: number
}

function u8(cursor: Cursor): number {
  const value = cursor.bytes[cursor.offset]
  if (value === undefined) throw new Error('MIDI ended mid-event')
  cursor.offset += 1
  return value
}

function u16(cursor: Cursor): number {
  return (u8(cursor) << 8) | u8(cursor)
}

function u32(cursor: Cursor): number {
  return (u16(cursor) * 0x10000 + u16(cursor)) >>> 0
}

function ascii(cursor: Cursor, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(u8(cursor))
  return out
}

/**
 * A variable-length quantity: seven bits per byte, high bit means "more follows".
 *
 * Capped at four bytes because that is the specification's own limit, and because an
 * uncapped loop on corrupt input runs until the buffer ends while shifting a number
 * past the point where it means anything.
 */
function vlq(cursor: Cursor): number {
  let value = 0
  for (let i = 0; i < 4; i++) {
    const byte = u8(cursor)
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) return value
  }
  throw new Error('MIDI variable-length quantity longer than four bytes')
}

/**
 * One event from the file, before tempo and channel state are applied.
 *
 * `order` preserves file order for events landing on the same tick, so a CC that was
 * written before a note-on still applies to it after sorting.
 */
type RawEvent = { tick: number; order: number } & (
  | { kind: 'on' | 'off'; channel: number; note: number; velocity: number }
  | { kind: 'cc'; channel: number; controller: number; value: number }
  | { kind: 'program'; channel: number; program: number }
  | { kind: 'tempo'; microsecondsPerQuarter: number }
  | { kind: 'end' }
)

/** A note-on still waiting for its note-off, with the state it captured. */
interface Pending {
  time: number
  note: number
  velocity: number
  channel: number
  program: number
  pan: number
}

/** Per-channel state carried along the timeline. */
interface ChannelState {
  program: number
  volume: number
  expression: number
  pan: number
}

function readEvents(bytes: Uint8Array): { events: RawEvent[]; ticksPerQuarter: number } {
  const cursor: Cursor = { bytes, offset: 0 }
  if (ascii(cursor, 4) !== 'MThd') throw new Error('Not a MIDI file: missing MThd header')
  const headerLength = u32(cursor)
  u16(cursor) // format: every one decodes the same way here, since notes carry channels
  const trackCount = u16(cursor)
  const division = u16(cursor)
  cursor.offset += Math.max(0, headerLength - 6)

  /**
   * SMPTE division is rejected rather than guessed at.
   *
   * A negative high byte means "frames per second", a different time base entirely.
   * Treating those ticks as ticks-per-quarter would play the file at an arbitrary
   * wrong speed, which is harder to diagnose than a refusal.
   */
  if (division & 0x8000) throw new Error('SMPTE time-division MIDI is not supported')
  if (division === 0) throw new Error('MIDI declares zero ticks per quarter note')

  const events: RawEvent[] = []
  let order = 0

  for (let index = 0; index < trackCount && cursor.offset < bytes.length; index++) {
    if (ascii(cursor, 4) !== 'MTrk') break
    const length = u32(cursor)
    const end = Math.min(cursor.offset + length, bytes.length)
    let tick = 0
    let runningStatus = 0

    while (cursor.offset < end) {
      tick += vlq(cursor)
      let status = bytes[cursor.offset] ?? 0
      if (status & 0x80) {
        cursor.offset += 1
        runningStatus = status
      } else {
        // Running status: a data byte where a status byte would be means "same event
        // type as last time". Omitting this drops most of the notes in a real file.
        status = runningStatus
      }
      const kind = status & 0xf0
      const channel = status & 0x0f

      if (status === META) {
        const type = u8(cursor)
        const metaLength = vlq(cursor)
        if (type === META_TEMPO && metaLength >= 3) {
          const value = (u8(cursor) << 16) | (u8(cursor) << 8) | u8(cursor)
          if (value > 0) events.push({ tick, order: order++, kind: 'tempo', microsecondsPerQuarter: value })
          cursor.offset += metaLength - 3
        } else {
          if (type === META_END_OF_TRACK) events.push({ tick, order: order++, kind: 'end' })
          cursor.offset += metaLength
        }
        continue
      }
      if (status === SYSEX || status === SYSEX_ESCAPE) {
        cursor.offset += vlq(cursor)
        continue
      }

      if (kind === NOTE_ON || kind === NOTE_OFF) {
        const note = u8(cursor)
        const velocity = u8(cursor)
        // A note-on with zero velocity is a note-off. Every sequencer uses this to
        // stay on running status, so reading it as an attack leaves notes stuck on.
        const isAttack = kind === NOTE_ON && velocity > 0
        events.push({
          tick,
          order: order++,
          kind: isAttack ? 'on' : 'off',
          channel,
          note,
          velocity,
        })
        continue
      }

      if (kind === CONTROL_CHANGE) {
        const controller = u8(cursor)
        const value = u8(cursor)
        events.push({ tick, order: order++, kind: 'cc', channel, controller, value })
        continue
      }

      if (kind === PROGRAM_CHANGE) {
        events.push({ tick, order: order++, kind: 'program', channel, program: u8(cursor) })
        continue
      }

      if (kind === CHANNEL_PRESSURE) {
        cursor.offset += 1
        continue
      }
      // Aftertouch and pitch bend: two data bytes, neither decoded.
      cursor.offset += 2
    }
    cursor.offset = end
  }

  // Tick then file order, so same-tick controller changes precede the notes they set up.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)
  return { events, ticksPerQuarter: division }
}

/**
 * Decode a Standard MIDI File.
 *
 * Throws on anything that isn't one, rather than returning an empty track: a file
 * that fails to parse is a mistake to surface, where silence is a mistake to hunt.
 */
export function parseMidi(bytes: Uint8Array): MidiTrack {
  const { events, ticksPerQuarter } = readEvents(bytes)

  const channels: ChannelState[] = Array.from({ length: 16 }, () => ({
    program: 0,
    volume: DEFAULT_CHANNEL_VOLUME,
    expression: MAX_VALUE,
    pan: PAN_CENTRE,
  }))
  const pending = new Map<number, Pending>()
  const notes: MidiNote[] = []

  let tempo = DEFAULT_TEMPO
  let lastTick = 0
  let lastSeconds = 0
  /** The latest time any event occurs, end-of-track included. */
  let endSeconds = 0

  const close = (entry: Pending, at: number): void => {
    notes.push({
      time: entry.time,
      duration: Math.max(0, at - entry.time),
      note: entry.note,
      velocity: entry.velocity,
      channel: entry.channel,
      program: entry.program,
      pan: entry.pan,
    })
  }

  for (const event of events) {
    /**
     * Advance the clock with the tempo **in force over the span just crossed**, then
     * let a tempo event change it. Applying a new tempo to the span before it appears
     * is the classic off-by-one here, and it shifts everything after the first change.
     */
    const seconds = lastSeconds + ((event.tick - lastTick) * tempo) / ticksPerQuarter / 1_000_000
    lastTick = event.tick
    lastSeconds = seconds
    if (seconds > endSeconds) endSeconds = seconds

    const state = event.kind === 'tempo' || event.kind === 'end' ? undefined : channels[event.channel]

    switch (event.kind) {
      case 'tempo':
        tempo = event.microsecondsPerQuarter
        break

      case 'program':
        if (state) state.program = event.program
        break

      case 'cc': {
        if (!state) break
        if (event.controller === CC_CHANNEL_VOLUME) state.volume = event.value
        else if (event.controller === CC_EXPRESSION) state.expression = event.value
        else if (event.controller === CC_PAN) state.pan = event.value
        else if (
          event.controller === CC_ALL_SOUND_OFF ||
          event.controller === CC_ALL_NOTES_OFF
        ) {
          // Without this a file that silences a channel wholesale leaves every note
          // on it held until the end of the track.
          for (const [key, entry] of pending) {
            if ((key >> 8) !== event.channel) continue
            close(entry, seconds)
            pending.delete(key)
          }
        }
        break
      }

      case 'on': {
        if (!state) break
        const key = (event.channel << 8) | event.note
        /**
         * A repeat of a sounding pitch with no note-off between ends the first note
         * here. MIDI has no way to express two simultaneous identical pitches on one
         * channel, so a second note-on is a retrigger — and this is also what makes at
         * most one note pending per key, which is why this is a plain map rather than a
         * queue.
         */
        const previous = pending.get(key)
        if (previous) close(previous, seconds)
        const entry: Pending = {
          time: seconds,
          note: event.note,
          velocity:
            (event.velocity / MAX_VALUE) *
            (state.volume / MAX_VALUE) *
            (state.expression / MAX_VALUE),
          channel: event.channel,
          program: state.program,
          pan: Math.max(-1, Math.min(1, (state.pan - PAN_CENTRE) / PAN_CENTRE)),
        }
        pending.set(key, entry)
        break
      }

      case 'off': {
        const key = (event.channel << 8) | event.note
        const started = pending.get(key)
        if (started) {
          close(started, seconds)
          pending.delete(key)
        }
        break
      }

      case 'end':
        break
    }
  }

  // Anything still held when the file runs out is closed at the end rather than
  // dropped: a truncated file should lose a duration, not a note.
  for (const entry of pending.values()) close(entry, endSeconds)

  notes.sort((a, b) => a.time - b.time || a.note - b.note)

  const lastNoteEnd = notes.reduce((longest, note) => Math.max(longest, note.time + note.duration), 0)
  return {
    notes,
    // End-of-track wins when it is later, which is what preserves trailing silence.
    duration: notes.length === 0 ? 0 : Math.max(endSeconds, lastNoteEnd),
  }
}

/** Where a theme's background track is served from. One file per audio theme id. */
export function midiPath(themeId: string): string {
  return `midi/${themeId}.mid`
}

/**
 * Fetch and decode a theme's background track, or `undefined` if it has none.
 *
 * A missing track is a normal state, not a failure: a theme without a file falls back
 * to the generated bed, so a 404 resolves to `undefined` rather than throwing. A file
 * that exists and won't decode *does* throw — that one is a mistake worth surfacing.
 */
export async function loadMidi(
  themeId: string,
  base = import.meta.env.BASE_URL
): Promise<MidiTrack | undefined> {
  const path = `${base}${midiPath(themeId)}`
  const response = await fetch(path)
  if (!response.ok) return undefined
  return parseMidi(new Uint8Array(await response.arrayBuffer()))
}
