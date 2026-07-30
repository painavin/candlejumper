import { describe, expect, it } from 'vitest'
import { earnedUnlocks, nextUnlock, unlocks } from './index.js'

describe('progression', () => {
  const lifetime = (overrides: Partial<Parameters<typeof earnedUnlocks>[0]['lifetime']> = {}) => ({
    lifetime: {
      runs: 0,
      campaigns: 0,
      wins: 0,
      realized: 0,
      streakResets: 0,
      cleanRuns: 0,
      bestStreak: 0,
      ...overrides,
    },
  })

  it('starts with nothing earned', () => {
    expect(earnedUnlocks(lifetime())).toEqual([])
  })

  it('gates nothing — no achievement id names a character or a theme', () => {
    // Cosmetics used to be locked behind these, which is the wrong trade for a
    // trainer: hiding a finished jumper behind a grind helps nobody learn anything.
    for (const unlock of unlocks) {
      expect(unlock.id.startsWith('badge:')).toBe(true)
    }
  })

  it('rewards discipline, not profit', () => {
    // A hugely profitable run that broke the player's own rule earns nothing.
    const profitable = lifetime({ runs: 20, campaigns: 40, realized: 99_999, streakResets: 12 })
    expect(earnedUnlocks(profitable)).not.toContain('badge:clean-sheet')

    const disciplined = lifetime({ runs: 1, campaigns: 3, cleanRuns: 1 })
    expect(earnedUnlocks(disciplined)).toContain('badge:clean-sheet')
  })

  it('recomputes from lifetime stats, so an unlock is never lost', () => {
    const context = lifetime({ runs: 5, campaigns: 60, cleanRuns: 6, bestStreak: 7 })
    expect(earnedUnlocks(context)).toEqual(unlocks.map((unlock) => unlock.id))
    expect(nextUnlock(context)).toBeUndefined()
  })

  it('names the next goal while anything is outstanding', () => {
    expect(nextUnlock(lifetime())?.id).toBe('badge:regular')
  })
})
