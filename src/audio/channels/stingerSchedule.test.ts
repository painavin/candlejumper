import { describe, expect, it } from 'vitest'
import { audioThemes } from '@content/audioThemes/index.js'
import { MAX_DEFER, MIN_VOICE_GAP, stingerTimes } from './stingerSchedule.js'

/**
 * `stingers.ts` can't be tested — Tone.js needs a real `AudioContext` — so the
 * scheduling arithmetic lives here where it can be.
 *
 * These cover a crash that shipped: the stinger voices are monophonic and reused, and
 * two same-voice stingers inside one gesture's span both scheduled from the same
 * `Tone.now()`, so the second asked for a time in the past and Tone threw.
 */

describe('stingerTimes', () => {
  it('starts at now on an idle voice', () => {
    const times = stingerTimes({ now: 10, lastScheduled: undefined, noteCount: 3, step: 0.1 })
    expect(times).toEqual([10, 10.1, 10.2])
  })

  it('is strictly increasing, so a monophonic voice accepts every note', () => {
    const times = stingerTimes({ now: 5, lastScheduled: undefined, noteCount: 6, step: 0.07 })
    for (let i = 1; i < times.length; i++) {
      expect(times[i] as number).toBeGreaterThan(times[i - 1] as number)
    }
  })

  it('queues behind a gesture the voice is still committed to', () => {
    // The crash, directly: two exit presses on one bar emit two `positionClosed`
    // events in the same tick, so both read the same `now`. The first spread its
    // arpeggio over 200ms; the second must not ask for a time inside that.
    const first = stingerTimes({ now: 10, lastScheduled: undefined, noteCount: 3, step: 0.1 })
    const second = stingerTimes({
      now: 10,
      lastScheduled: first[first.length - 1],
      noteCount: 3,
      step: 0.1,
    })
    expect(second[0] as number).toBeGreaterThan(first[first.length - 1] as number)
  })

  it('never returns a time before now', () => {
    // A stale cursor from a voice that has been idle a while must not drag a stinger
    // into the past, which is just as invalid as scheduling it too early.
    const times = stingerTimes({ now: 100, lastScheduled: 20, noteCount: 2, step: 0.1 })
    expect(times[0]).toBe(100)
  })

  it('ignores a non-finite cursor rather than propagating NaN into the schedule', () => {
    const times = stingerTimes({ now: 10, lastScheduled: NaN, noteCount: 2, step: 0.1 })
    expect(times.every((time) => Number.isFinite(time))).toBe(true)
    expect(times[0]).toBe(10)
  })

  it('drops a stinger it would have to defer past usefulness', () => {
    // Under a flurry the tail is dropped rather than trailed: a cue arriving long
    // after its event reads as a stray noise, not as feedback.
    expect(
      stingerTimes({ now: 10, lastScheduled: 10 + MAX_DEFER + 0.01, noteCount: 2, step: 0.1 })
    ).toEqual([])
  })

  it('still plays one deferred just inside the limit', () => {
    const times = stingerTimes({ now: 10, lastScheduled: 10.1, noteCount: 1, step: 0.1 })
    expect(times).toHaveLength(1)
  })

  it('spaces notes even when a recipe asks for no gap at all', () => {
    // Zero spacing on a monophonic voice is the same crash by a different route.
    const times = stingerTimes({ now: 0, lastScheduled: undefined, noteCount: 3, step: 0 })
    expect(times[1] as number).toBeGreaterThanOrEqual(MIN_VOICE_GAP)
    expect(times[2] as number).toBeGreaterThan(times[1] as number)
  })

  it('returns nothing for a recipe with no notes', () => {
    expect(stingerTimes({ now: 1, lastScheduled: undefined, noteCount: 0, step: 0.1 })).toEqual([])
  })

  it('survives a flurry on one voice without ever going backwards', () => {
    // Flattening a five-unit position emits one close per unit, all in one tick.
    let cursor: number | undefined
    let played = 0
    for (let i = 0; i < 8; i++) {
      const times = stingerTimes({ now: 42, lastScheduled: cursor, noteCount: 3, step: 0.1 })
      if (times.length === 0) continue
      played += 1
      expect(times[0] as number).toBeGreaterThanOrEqual(cursor === undefined ? 42 : cursor)
      cursor = times[times.length - 1]
    }
    // Some got through and some were dropped — that's the intended behaviour, not a
    // silent failure to schedule anything.
    expect(played).toBeGreaterThan(0)
    expect(played).toBeLessThan(8)
  })
})

describe('the shipped stinger recipes', () => {
  it('schedules every recipe in every theme without going backwards', () => {
    // A theme is data, so a new one could ship a zero step or an empty note list.
    for (const theme of audioThemes) {
      for (const [key, recipe] of Object.entries(theme.stingers)) {
        const times = stingerTimes({
          now: 1,
          lastScheduled: undefined,
          noteCount: recipe.notes.length,
          step: recipe.step,
        })
        expect(times, `${theme.id}/${key}`).toHaveLength(recipe.notes.length)
        for (let i = 1; i < times.length; i++) {
          expect(times[i] as number, `${theme.id}/${key} note ${i}`).toBeGreaterThan(
            times[i - 1] as number
          )
        }
      }
    }
  })

  it('fires the same recipe twice in one tick, which is what crashed', () => {
    // Two exits on one bar. The invariant is that a repeat is either scheduled
    // strictly after the first gesture or dropped outright — never handed a time the
    // voice will reject.
    for (const theme of audioThemes) {
      for (const [key, recipe] of Object.entries(theme.stingers)) {
        const first = stingerTimes({
          now: 1,
          lastScheduled: undefined,
          noteCount: recipe.notes.length,
          step: recipe.step,
        })
        const second = stingerTimes({
          now: 1,
          lastScheduled: first[first.length - 1],
          noteCount: recipe.notes.length,
          step: recipe.step,
        })
        // Asserted rather than merely allowed: every shipped recipe is short enough
        // that its repeat fits inside MAX_DEFER. If a theme grows an arpeggio past
        // that, the repeat gets silently dropped instead — worth being told about.
        expect(second.length, `${theme.id}/${key} repeat was dropped`).toBe(
          recipe.notes.length
        )
        expect(second[0] as number, `${theme.id}/${key}`).toBeGreaterThan(
          first[first.length - 1] as number
        )
      }
    }
  })
})
