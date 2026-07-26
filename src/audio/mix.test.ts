import { describe, expect, it } from 'vitest'
import { toGain } from './mix.js'

describe('toGain', () => {
  it('passes a slider value straight through', () => {
    expect(toGain(1, false)).toBe(1)
    expect(toGain(0.5, false)).toBe(0.5)
  })

  it('mutes to exactly zero, not to something quiet', () => {
    // A mute that leaves −60dB of signal is audible in a quiet room, and gets
    // reported as "the mute button doesn't work".
    expect(toGain(1, true)).toBe(0)
    expect(toGain(0.8, true)).toBe(0)
  })

  it('treats a zero slider as silence too', () => {
    expect(toGain(0, false)).toBe(0)
  })

  it('clamps above 1 rather than letting a bad config distort the output', () => {
    expect(toGain(4, false)).toBe(1)
  })

  it('refuses a non-finite or negative value instead of passing NaN into the graph', () => {
    // A NaN gain silences a Web Audio node permanently and is near-impossible to
    // diagnose from the symptom.
    expect(toGain(Number.NaN, false)).toBe(0)
    expect(toGain(-0.5, false)).toBe(0)
  })
})
