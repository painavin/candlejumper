import { describe, expect, it, vi } from 'vitest'
import type { OhlcvBar, PositionState } from '@shared/contracts/index.js'
import type { StopEngine } from './port.js'
import { createNoStops } from './port.js'
import { createCompositeStopEngine } from './composite.js'

/**
 * The composite exists so a player can run a built-in stop and an imported one at
 * once. The property that makes it a composition rather than a policy of its own:
 * **combining engines must produce the same verdict as one engine holding all the
 * slots.** These tests pin that, in both directions, because "tightest binding
 * constraint" inverts for shorts and a sign error there would silently exit a short
 * at the wrong level.
 */

const bar: OhlcvBar = { t: 1, o: 100, h: 101, l: 99, c: 100, v: 1000 }

function stubEngine(level: number, advisory: boolean, direction: 'long' | 'short'): StopEngine {
  return {
    ...createNoStops(),
    evaluate: (close, position) => {
      const breached = position.size > 0 ? close <= level : close >= level
      if (!breached) return { triggered: null, breaches: [] }
      const entry = { stopId: `${direction}-${level}`, level, advisory }
      return advisory
        ? { triggered: null, breaches: [entry] }
        : { triggered: { stopId: entry.stopId, level }, breaches: [] }
    },
    levels: [{ stopId: `${direction}-${level}`, level, advisory }],
    hasAdvisoryRule: advisory,
    hasAnyRule: true,
  }
}

const long: PositionState = {
  size: 10,
  avgCost: 100,
  barsHeld: 3,
  bestPrice: 105,
  worstPrice: 95,
  entryBarIndex: 10,
}
const short: PositionState = { ...long, size: -10, bestPrice: 95, worstPrice: 105 }

describe('createCompositeStopEngine', () => {
  it('returns the single engine untouched rather than wrapping it', () => {
    const only = createNoStops()
    expect(createCompositeStopEngine([only])).toBe(only)
  })

  it('picks the tightest enforcing level when long', () => {
    // Long: the *higher* level binds first as price falls.
    const composite = createCompositeStopEngine([
      stubEngine(90, false, 'long'),
      stubEngine(95, false, 'long'),
    ])
    expect(composite.evaluate(89, long).triggered?.level).toBe(95)
  })

  it('picks the tightest enforcing level when short', () => {
    // Short: the *lower* level binds first as price rises. The inversion is the
    // whole reason this is tested on both sides.
    const composite = createCompositeStopEngine([
      stubEngine(110, false, 'short'),
      stubEngine(105, false, 'short'),
    ])
    expect(composite.evaluate(111, short).triggered?.level).toBe(105)
  })

  it('collects advisory breaches from every engine', () => {
    const composite = createCompositeStopEngine([
      stubEngine(95, true, 'long'),
      stubEngine(97, true, 'long'),
    ])
    const result = composite.evaluate(94, long)
    expect(result.triggered).toBeNull()
    expect(result.breaches.map((entry) => entry.level).sort()).toEqual([95, 97])
  })

  it('reports having a rule if any engine does, and advisory likewise', () => {
    const composite = createCompositeStopEngine([createNoStops(), stubEngine(95, true, 'long')])
    expect(composite.hasAnyRule).toBe(true)
    expect(composite.hasAdvisoryRule).toBe(true)

    const enforcingOnly = createCompositeStopEngine([createNoStops(), stubEngine(95, false, 'long')])
    expect(enforcingOnly.hasAnyRule).toBe(true)
    // Load-bearing: with no advisory rule the streak meter is "automated", and a
    // composite that over-reported this would measure discipline that can't be lost.
    expect(enforcingOnly.hasAdvisoryRule).toBe(false)
  })

  it('fans lifecycle calls out to every engine', () => {
    const spies = [createNoStops(), createNoStops()].map((engine) => ({
      engine,
      observeBar: vi.spyOn(engine, 'observeBar'),
      onEntry: vi.spyOn(engine, 'onEntry'),
      reset: vi.spyOn(engine, 'reset'),
    }))
    const composite = createCompositeStopEngine(spies.map((entry) => entry.engine))

    composite.observeBar(bar)
    composite.onEntry()
    composite.reset()

    for (const spy of spies) {
      expect(spy.observeBar).toHaveBeenCalledWith(bar)
      expect(spy.onEntry).toHaveBeenCalledTimes(1)
      expect(spy.reset).toHaveBeenCalledTimes(1)
    }
  })

  it('concatenates levels so the HUD draws every line', () => {
    const composite = createCompositeStopEngine([
      stubEngine(95, true, 'long'),
      stubEngine(90, false, 'long'),
    ])
    expect(composite.levels).toHaveLength(2)
  })
})
