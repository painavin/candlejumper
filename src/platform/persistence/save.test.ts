import { describe, expect, it } from 'vitest'
import { createMemoryStore } from './store.js'
import { emptySave, loadSave, recordRun, writeSave, PERSISTENCE_VERSION } from './save.js'
import type { SaveData } from './save.js'

const FP = 1

const totals = { campaigns: 1, wins: 1, realized: 100, streakResets: 0, longestStreak: 0 }
const result = (percentReturn: number, extra: Partial<{ arcadeScore: number; endedEarly: boolean }> = {}) => ({
  percentReturn,
  arcadeScore: 0,
  endedEarly: false,
  at: 1_700_000_000_000,
  ...extra,
})

describe('loadSave', () => {
  it('returns an empty save when nothing is stored', async () => {
    const save = await loadSave(createMemoryStore(), FP)
    expect(save).toEqual(emptySave(FP))
  })

  it('round-trips a written save', async () => {
    const store = createMemoryStore()
    const save = emptySave(FP)
    save.lifetime.runs = 3
    await writeSave(store, save)
    expect((await loadSave(store, FP)).lifetime.runs).toBe(3)
  })

  it('falls back to defaults rather than crashing on garbage', async () => {
    // All persisted data is untrusted on read: a hand-edited file must not be
    // able to take the app down or inject a shape the rest of the app trusts.
    const store = createMemoryStore()
    await store.save('save', 'not an object')
    expect(await loadSave(store, FP)).toEqual(emptySave(FP))
  })

  it('discards a save written by an older schema version', async () => {
    const store = createMemoryStore()
    await store.save('save', { version: 0, personalBests: { abc: { percentReturn: 50 } } })
    expect((await loadSave(store, FP)).personalBests).toEqual({})
  })

  it('drops personal bests when the fingerprint version changes, keeping lifetime totals', async () => {
    // Adding a key to the fingerprint invalidates the buckets — an explicit
    // migration rather than silent loss of a player's whole history.
    const store = createMemoryStore()
    const save: SaveData = {
      version: PERSISTENCE_VERSION,
      fingerprintVersion: 1,
      personalBests: { abc: { percentReturn: 20, arcadeScore: 5, endedEarly: false, at: 1 } },
      lifetime: {
        runs: 9,
        campaigns: 20,
        wins: 12,
        realized: 500,
        streakResets: 2,
        cleanRuns: 4,
        bestStreak: 6,
      },
    }
    await writeSave(store, save)

    const migrated = await loadSave(store, 2)
    expect(migrated.personalBests).toEqual({})
    expect(migrated.lifetime.runs).toBe(9)
  })

  it('drops individual malformed entries but keeps the good ones', async () => {
    const store = createMemoryStore()
    await store.save('save', {
      version: PERSISTENCE_VERSION,
      fingerprintVersion: FP,
      personalBests: {
        good: { percentReturn: 12, arcadeScore: 3, endedEarly: false, at: 1 },
        bad: { percentReturn: 'lots' },
        alsoBad: null,
      },
      lifetime: { runs: 1 },
    })
    const save = await loadSave(store, FP)
    expect(Object.keys(save.personalBests)).toEqual(['good'])
    expect(save.lifetime.runs).toBe(1)
  })
})

describe('recordRun', () => {
  it('records a first run as a personal best', () => {
    const { save, isPersonalBest } = recordRun(emptySave(FP), 'fp1', result(10), totals)
    expect(isPersonalBest).toBe(true)
    expect(save.personalBests.fp1?.percentReturn).toBe(10)
  })

  it('keeps the better percent return', () => {
    let save = recordRun(emptySave(FP), 'fp1', result(10), totals).save
    const worse = recordRun(save, 'fp1', result(4), totals)
    expect(worse.isPersonalBest).toBe(false)
    expect(worse.save.personalBests.fp1?.percentReturn).toBe(10)
    save = worse.save
    const better = recordRun(save, 'fp1', result(25), totals)
    expect(better.isPersonalBest).toBe(true)
    expect(better.save.personalBests.fp1?.percentReturn).toBe(25)
  })

  it('tracks the best arcade score even on a run that was not a P&L best', () => {
    // arcadeScore is recorded alongside, never competing with the primary score.
    const first = recordRun(emptySave(FP), 'fp1', result(30, { arcadeScore: 100 }), totals)
    const second = recordRun(first.save, 'fp1', result(5, { arcadeScore: 400 }), totals)
    expect(second.isPersonalBest).toBe(false)
    expect(second.save.personalBests.fp1?.percentReturn).toBe(30)
    expect(second.save.personalBests.fp1?.arcadeScore).toBe(400)
  })

  it('keeps different fingerprints in different buckets', () => {
    // Two runs only compete if they were the same challenge.
    const easy = recordRun(emptySave(FP), 'slow', result(40), totals)
    const hard = recordRun(easy.save, 'fast', result(3), totals)
    expect(hard.isPersonalBest).toBe(true)
    expect(hard.save.personalBests.slow?.percentReturn).toBe(40)
    expect(hard.save.personalBests.fast?.percentReturn).toBe(3)
  })

  it('marks an early-ended run rather than excluding it', () => {
    // Ending early after a lucky opening is a real strategy; the flag keeps it
    // visible instead of either banning it or hiding it.
    const { save } = recordRun(emptySave(FP), 'fp1', result(15, {}), totals)
    expect(save.personalBests.fp1?.endedEarly).toBe(false)
    const early = recordRun(save, 'fp1', result(60), totals)
    expect(early.save.personalBests.fp1?.percentReturn).toBe(60)
  })

  it('accumulates lifetime totals across runs', () => {
    let save = emptySave(FP)
    for (let i = 0; i < 3; i++) save = recordRun(save, 'fp1', result(i), totals).save
    expect(save.lifetime.runs).toBe(3)
    expect(save.lifetime.campaigns).toBe(3)
    expect(save.lifetime.realized).toBe(300)
  })
})
