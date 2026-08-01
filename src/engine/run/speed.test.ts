import { describe, expect, it } from 'vitest'
import { SPEED_STEPS, steppedSpeed } from './speed.js'

/**
 * The mid-run speed ladder.
 *
 * Pure, and worth testing separately from the clock: every case here is a press a player
 * can make, and the two that matter — an off-ladder starting speed, and a press at the
 * limit — are the ones a plain `index + 1` gets wrong.
 */

describe('stepping the speed', () => {
  it('moves one rung at a time in both directions', () => {
    expect(steppedSpeed(2, 'faster')).toBe(3)
    expect(steppedSpeed(3, 'slower')).toBe(2)
  })

  it('stays put at either end rather than wrapping', () => {
    // Wrapping from 10 back to 0.5 would be a twentyfold speed change from one tap.
    expect(steppedSpeed(10, 'faster')).toBe(10)
    expect(steppedSpeed(0.5, 'slower')).toBe(0.5)
  })

  it('moves an off-ladder speed in the direction asked for', () => {
    // The settings slider reaches 2.5, so this is a normal starting state, not an edge
    // case. Snapping to the nearest rung regardless of direction would make the first
    // press feel like it went the wrong way.
    expect(steppedSpeed(2.5, 'faster')).toBe(3)
    expect(steppedSpeed(2.5, 'slower')).toBe(2)
    expect(steppedSpeed(7.5, 'faster')).toBe(8)
    expect(steppedSpeed(7.5, 'slower')).toBe(6)
  })

  it('pulls a speed beyond the ladder back into range', () => {
    // Nothing should produce these, but the ladder is also the clamp — and a speed of 40
    // means one bar every 25ms, which no display can show.
    expect(steppedSpeed(40, 'slower')).toBe(10)
    expect(steppedSpeed(40, 'faster')).toBe(10)
    expect(steppedSpeed(0.1, 'faster')).toBe(0.5)
    expect(steppedSpeed(0.1, 'slower')).toBe(0.5)
  })

  it('does not skip a rung because of floating-point drift', () => {
    // 2.0000000000000004 is what repeated scaling produces; read as "above 2" it would
    // step to 4 and silently double the intended change.
    expect(steppedSpeed(2.0000000000000004, 'faster')).toBe(3)
    expect(steppedSpeed(1.9999999999999998, 'slower')).toBe(1)
  })

  it('falls back to the slowest rung for a value that is not a number', () => {
    expect(steppedSpeed(Number.NaN, 'faster')).toBe(0.5)
  })

  it('covers exactly the range validateConfig allows', () => {
    // If these drift apart, the keyboard becomes a way to reach a speed a config file
    // would be refused for.
    expect(SPEED_STEPS[0]).toBe(0.5)
    expect(SPEED_STEPS[SPEED_STEPS.length - 1]).toBe(10)
    expect([...SPEED_STEPS].sort((a, b) => a - b)).toEqual([...SPEED_STEPS])
  })
})
