import { describe, expect, it } from 'vitest'
import { earnedUnlocks, isUnlocked, nextUnlock, unlocks } from './index.js'

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

  it('starts with nothing earned but the starting set still usable', () => {
    expect(earnedUnlocks(lifetime())).toEqual([])
    expect(isUnlocked('character:robin', [])).toBe(true)
    expect(isUnlocked('theme:jolly', [])).toBe(true)
    expect(isUnlocked('character:bear', [])).toBe(false)
  })

  it('gates the bear on discipline, not on profit', () => {
    // The point of the whole progression design: a hugely profitable run that broke
    // the player's own rule earns nothing here.
    const profitable = lifetime({ runs: 20, campaigns: 40, realized: 99_999, streakResets: 12 })
    expect(earnedUnlocks(profitable)).not.toContain('character:bear')

    const disciplined = lifetime({ runs: 1, campaigns: 3, cleanRuns: 1 })
    expect(earnedUnlocks(disciplined)).toContain('character:bear')
  })

  it('recomputes from lifetime stats, so an unlock is never lost', () => {
    const context = lifetime({ runs: 5, campaigns: 60, cleanRuns: 6, bestStreak: 7 })
    expect(earnedUnlocks(context)).toEqual(unlocks.map((unlock) => unlock.id))
    expect(nextUnlock(context)).toBeUndefined()
  })

  it('names the next goal while anything is outstanding', () => {
    expect(nextUnlock(lifetime())?.id).toBe('character:bull')
  })
})
