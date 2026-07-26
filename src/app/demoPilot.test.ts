import { describe, expect, it } from 'vitest'
import type { FrameState } from '@engine/output/index.js'
import { createDemoPilot } from './demoPilot.js'

/**
 * The autopilot is set dressing, but two things about it are worth pinning: it must
 * decide **once per bar** (a per-frame decision would deploy the whole account in a
 * fraction of a second) and it must be **deterministic** (the seeded-PRNG rule
 * applies to cosmetics too, or a snapshot test somewhere else starts flaking).
 */

function frame(index: number, direction: 'flat' | 'long', unrealized = 0, units = 0): FrameState {
  return {
    phase: 'playing',
    bars: [],
    bounds: { min: 0, max: 1 },
    barPhase: 0,
    currentBar: undefined,
    currentIndex: index,
    totalBars: 500,
    previousUnit: undefined,
    droppedBars: 0,
    stopLines: [],
    events: [],
    overlays: [],
    subPanes: [],
    hud: {
      direction,
      shares: direction === 'flat' ? 0 : 10,
      avgCost: 100,
      unitCount: units,
      realizedPnl: 0,
      unrealizedPnl: unrealized,
      totalPnl: 0,
      percentReturn: 0,
      buyingPower: 5000,
      stoppedOutThisBar: false,
      streak: { meter: 'live', streak: 0, multiplier: 1, arcadeScore: 0, maxMultiplier: 5 },
    },
  }
}

describe('createDemoPilot', () => {
  it('decides at most once per bar, however many frames that bar spans', () => {
    const pilot = createDemoPilot(7)
    // 40 frames on one bar is a realistic count at 60fps and 2 bars/sec.
    const decisions = Array.from({ length: 40 }, () => pilot.decide(frame(0, 'flat'))).filter(
      (action) => action !== undefined
    )
    expect(decisions.length).toBeLessThanOrEqual(1)
  })

  it('is deterministic for a seed', () => {
    const run = (): (string | undefined)[] => {
      const pilot = createDemoPilot(99)
      return Array.from({ length: 60 }, (_, index) => pilot.decide(frame(index, 'flat')))
    }
    expect(run()).toEqual(run())
  })

  it('does nothing at all before the run is playing', () => {
    const pilot = createDemoPilot(1)
    const waiting = { ...frame(0, 'flat'), phase: 'waiting-for-data' as const }
    expect(pilot.decide(waiting)).toBeUndefined()
  })

  it('eventually opens when flat, and eventually exits once holding', () => {
    const pilot = createDemoPilot(4)
    let opened = false
    for (let index = 0; index < 200 && !opened; index++) {
      opened = pilot.decide(frame(index, 'flat')) === 'buy'
    }
    expect(opened).toBe(true)

    const holder = createDemoPilot(4)
    let exited = false
    for (let index = 0; index < 200 && !exited; index++) {
      exited = holder.decide(frame(index, 'long', -5, 1)) === 'sell'
    }
    expect(exited).toBe(true)
  })

  it('never adds beyond the unit cap, so the ghost stack stays countable', () => {
    const pilot = createDemoPilot(11)
    const adds = Array.from({ length: 300 }, (_, index) =>
      pilot.decide(frame(index, 'long', 50, 3))
    ).filter((action) => action === 'buy')
    expect(adds).toEqual([])
  })
})
