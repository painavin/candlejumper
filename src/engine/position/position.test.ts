import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@config/index.js'
import type { RunConfig } from '@config/index.js'
import {
  buyingPower,
  cashBalance,
  deployedAtCost,
  directionOf,
  flatPosition,
  flatten,
  isFlat,
  markBar,
  openOrAdd,
  percentReturn,
  reduceOneUnit,
  unrealizedPnl,
} from './position.js'
import type { Position } from './position.js'

/**
 * The trading engine gets real coverage because this is where a subtle sign
 * error silently produces wrong scores forever — so there is a short-side case
 * for every long-side case.
 */

const config = (overrides: Partial<RunConfig> = {}): RunConfig => ({
  ...defaultConfig(),
  allowShorting: true,
  ...overrides,
})

/** Open `units` units of `direction` at `price`. */
function open(
  direction: 'long' | 'short',
  price: number,
  units = 1,
  cfg: RunConfig = config()
): Position {
  let position = flatPosition()
  for (let i = 0; i < units; i++) {
    const result = openOrAdd(position, direction, price, cfg, i)
    if ('denied' in result) throw new Error(`entry ${i + 1} denied`)
    position = result.position
  }
  return position
}

describe('direction and flatness', () => {
  it('reads sign as direction', () => {
    expect(directionOf(flatPosition())).toBe('flat')
    expect(directionOf(open('long', 100))).toBe('long')
    expect(directionOf(open('short', 100))).toBe('short')
  })

  it('snaps a dust-sized position to flat', () => {
    const position: Position = { ...flatPosition(), shares: 1e-9, unitCount: 1 }
    expect(isFlat(position)).toBe(true)
  })
})

describe('entries', () => {
  it('deploys entrySize cash and derives shares from the fill price', () => {
    const position = open('long', 200) // 20% of $10,000 = $2,000 at $200
    expect(position.shares).toBeCloseTo(10, 9)
    expect(position.avgCost).toBe(200)
    expect(position.unitCount).toBe(1)
  })

  it('opens a short as negative shares, sized the same way', () => {
    const position = open('short', 200)
    expect(position.shares).toBeCloseTo(-10, 9)
    expect(position.avgCost).toBe(200)
  })

  it('blends cost basis on a weighted average when scaling in', () => {
    // $2,000 at $100 = 20 shares; $2,000 at $200 = 10 shares.
    // Weighted average = (100*20 + 200*10) / 30 = 133.33…
    let position = open('long', 100)
    const added = openOrAdd(position, 'long', 200, config(), 1)
    if ('denied' in added) throw new Error('denied')
    position = added.position
    expect(position.shares).toBeCloseTo(30, 9)
    expect(position.avgCost).toBeCloseTo(400 / 3, 9)
    expect(position.unitCount).toBe(2)
  })

  it('blends cost basis identically on the short side', () => {
    let position = open('short', 100)
    const added = openOrAdd(position, 'short', 200, config(), 1)
    if ('denied' in added) throw new Error('denied')
    position = added.position
    expect(position.shares).toBeCloseTo(-30, 9)
    expect(position.avgCost).toBeCloseTo(400 / 3, 9)
  })

  it('fills five units exactly at the 20% default', () => {
    const position = open('long', 100, 5)
    expect(position.unitCount).toBe(5)
    expect(buyingPower(position, config())).toBeCloseTo(0, 9)
  })

  it('denies a sixth unit once buying power is exhausted', () => {
    const position = open('long', 100, 5)
    expect(openOrAdd(position, 'long', 100, config(), 6)).toEqual({ denied: 'no-buying-power' })
  })

  it('clamps a partial entry and still counts it as one unit', () => {
    // entrySize 30% leaves 10% after three entries — a legitimate runt unit
    // rather than a denial that strands capital.
    const cfg = config({ entrySize: 0.3 })
    const position = open('long', 100, 3, cfg)
    const fourth = openOrAdd(position, 'long', 100, cfg, 4)
    if ('denied' in fourth) throw new Error('should have clamped, not denied')
    expect(fourth.deployed).toBeCloseTo(1_000, 6)
    expect(fourth.position.unitCount).toBe(4)
  })

  it('denies a dust entry rather than opening a unit worth pennies', () => {
    // Without this guard a player at full deployment can inflate unitCount with
    // meaningless presses and dilute every subsequent exit.
    const cfg = config({ entrySize: 0.3333 })
    const position = open('long', 100, 3, cfg)
    const remaining = buyingPower(position, cfg)
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThan(cfg.startingCapital * cfg.entrySize * 0.01)
    expect(openOrAdd(position, 'long', 100, cfg, 4)).toEqual({ denied: 'no-buying-power' })
  })
})

describe('exits', () => {
  it('reaches exactly flat on the Nth press for N entries', () => {
    // Unit-symmetric exits. A naive "close 25% of the remainder" decays
    // geometrically and would need 49 presses to reach the flat threshold.
    let position = open('long', 100, 5)
    for (let i = 0; i < 5; i++) position = reduceOneUnit(position, 110).position
    expect(isFlat(position)).toBe(true)
    expect(position.unitCount).toBe(0)
  })

  it('closes 1/5, then 1/4 of the remainder, and so on', () => {
    const position = open('long', 100, 5) // 100 shares total
    const first = reduceOneUnit(position, 100)
    expect(first.closedShares).toBeCloseTo(position.shares / 5, 9)
    const second = reduceOneUnit(first.position, 100)
    expect(second.closedShares).toBeCloseTo(first.position.shares / 4, 9)
  })

  it('realizes P&L against average cost on the long side', () => {
    const position = open('long', 100) // 20 shares at $100
    const exit = reduceOneUnit(position, 110)
    expect(exit.realized).toBeCloseTo(20 * 10, 9)
  })

  it('realizes a profit on a short closed below its average entry', () => {
    // The sign carries through with no separate formula: closedShares is
    // negative, so (exit − avg) negative gives a positive result.
    const position = open('short', 100) // −20 shares at $100
    const exit = reduceOneUnit(position, 90)
    expect(exit.realized).toBeCloseTo(20 * 10, 9)
  })

  it('realizes a loss on a short closed above its average entry', () => {
    const position = open('short', 100)
    expect(reduceOneUnit(position, 110).realized).toBeCloseTo(-200, 9)
  })

  it('leaves average cost alone when reducing', () => {
    const position = open('long', 100, 2)
    expect(reduceOneUnit(position, 500).position.avgCost).toBe(position.avgCost)
  })

  it('reaches flat in N exits even when units are unequal', () => {
    // The clamped runt unit must not break the invariant.
    const cfg = config({ entrySize: 0.3 })
    let position = open('long', 100, 3, cfg)
    const fourth = openOrAdd(position, 'long', 100, cfg, 4)
    if ('denied' in fourth) throw new Error('denied')
    position = fourth.position
    for (let i = 0; i < 4; i++) position = reduceOneUnit(position, 120).position
    expect(isFlat(position)).toBe(true)
  })
})

describe('flatten', () => {
  it('closes every unit as a single event', () => {
    const position = open('long', 100, 5)
    const result = flatten(position, 120)
    expect(result.wentFlat).toBe(true)
    expect(result.unitsClosed).toBe(5)
    expect(result.realized).toBeCloseTo(100 * 20, 9)
  })

  it('closes a short as readily as a long', () => {
    const position = open('short', 100, 3)
    const result = flatten(position, 80)
    expect(result.wentFlat).toBe(true)
    expect(result.realized).toBeGreaterThan(0)
  })
})

describe('buying power', () => {
  it('is capped at starting capital, so profits do not compound', () => {
    // entrySize keeps meaning "one fifth of a full deployment", which is what
    // makes unit counts comparable between runs.
    const position: Position = { ...flatPosition(), realizedPnl: 50_000 }
    expect(cashBalance(position, config())).toBe(60_000)
    expect(buyingPower(position, config())).toBe(10_000)
  })

  it('falls with realized losses, so lost money cannot be redeployed', () => {
    const position: Position = { ...flatPosition(), realizedPnl: -9_000 }
    expect(buyingPower(position, config())).toBe(1_000)
  })

  it('leaves a heavily-losing player able to open only a fraction of a unit', () => {
    // Losses reduce capacity rather than locking the player out: $100 left still
    // buys $100 of stock, which is a legitimate runt unit. Denial is reserved for
    // dust.
    const position: Position = { ...flatPosition(), realizedPnl: -9_900 }
    const result = openOrAdd(position, 'long', 100, config(), 1)
    if ('denied' in result) throw new Error('should have clamped, not denied')
    expect(result.deployed).toBeCloseTo(100, 6)
    expect(result.position.shares).toBeCloseTo(1, 6)
  })

  it('denies the entry once even the clamped amount is dust', () => {
    const position: Position = { ...flatPosition(), realizedPnl: -9_990 }
    expect(openOrAdd(position, 'long', 100, config(), 1)).toEqual({
      denied: 'no-buying-power',
    })
  })

  it('counts short notional against buying power, since proceeds are locked', () => {
    // Shorting $2,000 of stock must not hand the player $2,000 more to deploy,
    // or they could compound leverage indefinitely.
    const position = open('short', 100)
    expect(deployedAtCost(position)).toBeCloseTo(2_000, 6)
    expect(buyingPower(position, config())).toBeCloseTo(8_000, 6)
  })

  it('never goes negative', () => {
    const position: Position = { ...flatPosition(), realizedPnl: -20_000 }
    expect(buyingPower(position, config())).toBe(0)
  })
})

describe('P&L reporting', () => {
  it('marks an open long to market', () => {
    expect(unrealizedPnl(open('long', 100), 110)).toBeCloseTo(200, 9)
  })

  it('marks an open short to market with the opposite sign', () => {
    expect(unrealizedPnl(open('short', 100), 110)).toBeCloseTo(-200, 9)
    expect(unrealizedPnl(open('short', 100), 90)).toBeCloseTo(200, 9)
  })

  it('reports zero unrealized when flat', () => {
    expect(unrealizedPnl(flatPosition(), 999)).toBe(0)
  })

  it('expresses return as a percent of starting capital', () => {
    // Percent is what makes personal bests comparable across a $5 stock and a
    // $500 stock.
    const position: Position = { ...flatPosition(), realizedPnl: 1_240 }
    expect(percentReturn(position, config(), 100)).toBeCloseTo(12.4, 9)
  })

  it('cannot pass −100% on a fully realized loss, given the buying-power rule', () => {
    let position = open('long', 100, 5)
    position = flatten(position, 0.0001).position
    expect(percentReturn(position, config(), 0.0001)).toBeGreaterThan(-100.01)
  })
})

describe('markBar', () => {
  it('tracks the best and worst close for a long', () => {
    let position = open('long', 100)
    position = markBar(position, 120)
    position = markBar(position, 90)
    expect(position.bestPrice).toBe(120)
    expect(position.worstPrice).toBe(90)
  })

  it('inverts best and worst for a short', () => {
    // A trailing stop reads bestPrice, so getting this backwards would ratchet
    // the wrong way on every short.
    let position = open('short', 100)
    position = markBar(position, 120)
    position = markBar(position, 90)
    expect(position.bestPrice).toBe(90)
    expect(position.worstPrice).toBe(120)
  })

  it('does nothing while flat', () => {
    expect(markBar(flatPosition(), 100).bestPrice).toBe(0)
  })
})
