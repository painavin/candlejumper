import { describe, expect, it } from 'vitest'
import { boundaryBetween } from './landmarks.js'

/** Epoch **seconds**, like every bar timestamp in the codebase. */
const seconds = (iso: string): number => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000)
const day = 86_400

describe('boundaryBetween', () => {
  it('reports the strongest boundary crossed', () => {
    expect(boundaryBetween(seconds('2024-12-31'), seconds('2025-01-02'))).toBe('year')
    expect(boundaryBetween(seconds('2024-03-28'), seconds('2024-04-02'))).toBe('quarter')
    expect(boundaryBetween(seconds('2024-01-31'), seconds('2024-02-01'))).toBe('month')
  })

  it('reports nothing inside the same month', () => {
    expect(boundaryBetween(seconds('2024-01-15'), seconds('2024-01-16'))).toBeUndefined()
  })

  it('treats a year change as a year, not a quarter or a month', () => {
    // Dec → Jan crosses all three at once. Reporting the weakest would draw a faint
    // month tick where the most significant landmark in the run belongs.
    expect(boundaryBetween(seconds('2024-12-20'), seconds('2025-01-03'))).toBe('year')
  })

  it('handles a gap larger than a bar, since markets close for holidays', () => {
    expect(boundaryBetween(seconds('2024-06-28'), seconds('2024-06-28') + 4 * day)).toBe('quarter')
  })
})
