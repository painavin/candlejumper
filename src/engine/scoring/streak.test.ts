import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@config/index.js'
import type { RunConfig } from '@config/index.js'
import type { PositionEvent } from '../output/events.js'
import { applyStreak, initialStreak } from './streak.js'
import type { StreakState } from './streak.js'

const config = (overrides: Partial<RunConfig> = {}): RunConfig => ({
  ...defaultConfig(),
  ...overrides,
})

const closed = (realized: number, extra: Partial<Extract<PositionEvent, { kind: 'positionClosed' }>> = {}): PositionEvent => ({
  kind: 'positionClosed',
  direction: 'long',
  price: 100,
  realized,
  profitable: realized > 0,
  unitsClosed: 1,
  viaFlatten: false,
  wentFlat: true,
  ...extra,
})

const breach: PositionEvent = {
  kind: 'advisoryBreached',
  stopId: 'trailing-percent',
  level: 90,
  price: 88,
}

const live = (cfg = config()): StreakState =>
  initialStreak({ config: cfg, hasAdvisoryRule: true, hasAnyRule: true })

const step = (
  state: StreakState,
  events: readonly PositionEvent[],
  inBreach = false,
  cfg = config()
): StreakState => applyStreak(state, events, { config: cfg, inBreach })

describe('meter state', () => {
  it('is live when an advisory stop is configured', () => {
    expect(live().meter).toBe('live')
  })

  it('is automated when only enforcing stops are configured', () => {
    // The streak cannot be lost — the engine closes at the level, so holding past
    // it is impossible. Labelled rather than shown full, so nobody is misled.
    const state = initialStreak({ config: config(), hasAdvisoryRule: false, hasAnyRule: true })
    expect(state.meter).toBe('automated')
  })

  it('is dormant with no stop configured, because there is no rule to measure', () => {
    const state = initialStreak({ config: config(), hasAdvisoryRule: false, hasAnyRule: false })
    expect(state.meter).toBe('dormant')
  })

  it('is dormant when the streak is switched off', () => {
    const cfg = config({ scoring: { streakEnabled: false, maxMultiplier: 5 } })
    expect(initialStreak({ config: cfg, hasAdvisoryRule: true, hasAnyRule: true }).meter).toBe(
      'dormant'
    )
  })
})

describe('what builds the streak', () => {
  it('builds on a LOSING close that respected the rule', () => {
    // The whole reframing: a loss taken because your own rule said to exit is a
    // success. A win-streak implementation would reset here.
    const state = step(live(), [closed(-150)])
    expect(state.streak).toBe(1)
    expect(state.multiplier).toBe(2)
  })

  it('builds on a winning close too', () => {
    expect(step(live(), [closed(200)]).streak).toBe(1)
  })

  it('builds once per close event, so partial exits each tick', () => {
    let state = live()
    state = step(state, [closed(50)])
    state = step(state, [closed(-20)])
    state = step(state, [closed(80)])
    expect(state.streak).toBe(3)
  })

  it('caps the multiplier', () => {
    let state = live()
    for (let i = 0; i < 20; i++) state = step(state, [closed(10)])
    expect(state.multiplier).toBe(5)
    expect(state.streak).toBe(20)
  })

  it('honours a lowered cap', () => {
    const cfg = config({ scoring: { streakEnabled: true, maxMultiplier: 3 } })
    let state = live(cfg)
    for (let i = 0; i < 10; i++) state = step(state, [closed(10)], false, cfg)
    expect(state.multiplier).toBe(3)
  })
})

describe('what breaks the streak', () => {
  it('resets at the breach, not at the eventual exit', () => {
    // The feedback belongs at the moment the player fails to act, not several
    // bars later when they finally do.
    let state = step(live(), [closed(100), closed(100)])
    expect(state.streak).toBe(2)
    state = step(state, [breach], true)
    expect(state.streak).toBe(0)
    expect(state.resets).toBe(1)
  })

  it('does not tick on a close event while still in breach', () => {
    let state = step(live(), [closed(100)])
    state = step(state, [breach], true)
    state = step(state, [closed(-50)], true)
    expect(state.streak).toBe(0)
  })

  it('lets a recovered position start rebuilding', () => {
    // Breach is a per-bar state, not a latch — a trailing level ratchets and
    // price crossing back inside it is ordinary.
    let state = step(live(), [breach], true)
    state = step(state, [closed(20)], false)
    expect(state.streak).toBe(1)
  })
})

describe('what leaves the streak alone', () => {
  it('is unchanged when an enforcing stop fires', () => {
    // The rule worked, but the engine acted, not the player.
    const state = step(live(), [
      { kind: 'stoppedOut', direction: 'long', price: 90, level: 90, stopId: 's' },
      closed(-100),
    ])
    expect(state.streak).toBe(1) // the close still counts; the stop-out itself is neutral
  })

  it('is unchanged by a force-close at end of data', () => {
    let state = step(live(), [closed(100)])
    const before = state.streak
    state = step(state, [{ kind: 'forceClosed', reason: 'end-of-data', price: 100 }])
    expect(state.streak).toBe(before)
  })

  it('is unchanged by a denied action', () => {
    const state = step(live(), [{ kind: 'actionDenied', reason: 'no-buying-power' }])
    expect(state.streak).toBe(0)
  })
})

describe('arcadeScore', () => {
  it('multiplies profitable closes only', () => {
    // Discipline builds the multiplier, profit collects on it.
    let state = live()
    state = step(state, [closed(100)]) // ×1 → 100
    state = step(state, [closed(100)]) // ×2 → 200
    expect(state.arcadeScore).toBeCloseTo(300, 9)
  })

  it('counts losses at ×1, however long the streak', () => {
    let state = live()
    for (let i = 0; i < 4; i++) state = step(state, [closed(10)])
    const before = state.arcadeScore
    state = step(state, [closed(-100)])
    expect(state.arcadeScore).toBeCloseTo(before - 100, 9)
  })

  it('earns nothing from farming compliance with scratch trades', () => {
    // Entering and immediately exiting is perfectly compliant and will climb the
    // meter — but it must not pay.
    let state = live()
    for (let i = 0; i < 10; i++) state = step(state, [closed(0)])
    expect(state.streak).toBe(10)
    expect(state.arcadeScore).toBe(0)
  })

  it('equals raw realized P&L when the meter is dormant', () => {
    const dormant = initialStreak({ config: config(), hasAdvisoryRule: false, hasAnyRule: false })
    let state = step(dormant, [closed(100)])
    state = step(state, [closed(-40)])
    expect(state.arcadeScore).toBeCloseTo(60, 9)
    expect(state.streak).toBe(0)
    expect(state.multiplier).toBe(1)
  })
})

describe('longest streak', () => {
  it('remembers the high-water mark after a reset', () => {
    let state = live()
    for (let i = 0; i < 3; i++) state = step(state, [closed(10)])
    state = step(state, [breach], true)
    expect(state.longest).toBe(3)
    expect(state.streak).toBe(0)
  })
})
