import { describe, expect, it } from 'vitest'
import { AtrRetraceLevel } from './atrRetraceLevel.js'
import type { TradeDirection } from './atrRetraceLevel.js'
import { RetraceLeg } from './retraceLeg.js'
import type { RetraceLegOptions, TradePhase } from './retraceLeg.js'

/**
 * Reference behaviour for the retrace lifecycle, ported from `RetraceLegFacts.cs` in the
 * Paisa library. The numbers are the C# facts' numbers, unchanged — that is the point of
 * the port: if a figure here has to change for a test to pass, the two implementations
 * have drifted, and the C# one is the authority.
 *
 * A leg is a plain object, so these drive it bar by bar with stated numbers rather than
 * going through a chart.
 *
 * Only the facts about the leg and its level are here. The C# file's two-leg indicator
 * facts (separate levels, sort keys, the breakdown mirror) belong to code that is not
 * ported: this runs one leg, long only through the indicator.
 */

const ATR = 10

/** Two ATR down for the entry, one for the stop, two for the trail. No tolerance. */
function newLeg(
  overrides: Partial<RetraceLegOptions> & { retraceOnExitBar?: boolean } = {}
): RetraceLeg {
  return new RetraceLeg({
    retraceFactor: 2,
    stopFactor: 1,
    trailFactor: 2,
    tolerancePct: 0,
    activationR: 2,
    ...overrides,
  })
}

const newShortLeg = (): RetraceLeg => newLeg({ direction: 'short' })

function update(
  leg: RetraceLeg,
  close: number,
  extreme: number,
  prevExtreme: number,
  atr = ATR,
  armed = false
): void {
  leg.update(close, extreme, prevExtreme, atr, armed)
}

/** Armed at 100, then a low of 79 through the 80 level: entered at 80, stop at 70. */
function enterAt80(leg: RetraceLeg): void {
  update(leg, 100, 100, 100, ATR, true)
  update(leg, 85, 79, 100)
}

describe('the touch tolerance', () => {
  it.each([
    [0, 80],
    [20, 82],
    [100, 90],
  ])('is %d%% of ATR above a long’s level → %d', (tolerancePct, expected) => {
    const level = new AtrRetraceLevel(2, tolerancePct)
    level.arm(100, ATR)
    // Armed two ATR under the close, so the raw level is 80.
    expect(level.level).toBe(80)
    expect(level.toleratedLevel(ATR)).toBe(expected)
  })

  it.each([
    [0, 120],
    [20, 118],
    [100, 110],
  ])('is the same distance below a short’s level at %d%% → %d', (tolerancePct, expected) => {
    const level = new AtrRetraceLevel(2, tolerancePct, 'short')
    level.arm(100, ATR)
    expect(level.level).toBe(120)
    expect(level.toleratedLevel(ATR)).toBe(expected)
  })

  it('widens the level toward price so a shortfall still touches', () => {
    // A low of 81.5 stops short of the 80 level, the intraday near-miss the tolerance
    // exists for.
    const tight = new AtrRetraceLevel(2, 0)
    tight.arm(100, ATR)
    expect(tight.touched(81.5, 90, ATR)).toBe(false)

    const slack = new AtrRetraceLevel(2, 20)
    slack.arm(100, ATR)
    expect(slack.touched(81.5, 90, ATR)).toBe(true)

    // Still a cross rather than a state: the previous low inside the tolerated band
    // means this bar is not the one that first reached it.
    expect(slack.touched(81.5, 81.8, ATR)).toBe(false)
  })
})

describe('stop-outs and retraces', () => {
  it('ends the cycle on a stop-out, so the next pullback does not re-enter', () => {
    const leg = newLeg()

    update(leg, 100, 100, 100, ATR, true)
    expect(leg.phase).toBe('monitoring')
    expect(leg.retraceLevel).toBe(80)

    // Low crosses 80 from above — the entry.
    update(leg, 85, 79, 100)
    expect(leg.phase).toBe('entered')
    expect(leg.isSignalled).toBe(true)
    expect(leg.signalCount).toBe(1)
    expect(leg.entryPrice).toBe(80)
    expect(leg.initialStopPrice).toBe(70)

    // Closed through the stop at 70.
    update(leg, 69, 69, 79)
    expect(leg.phase).toBe('idle')

    // A re-entry off the stop-out close would chase the decline down; without a fresh
    // breakout nothing fires.
    update(leg, 70, 68, 69)
    update(leg, 52, 49, 68)
    expect(leg.phase).toBe('idle')
    expect(leg.isSignalled).toBe(false)
    expect(leg.signalCount).toBe(1)
  })

  it('is not ended by an intraday spike through the stop', () => {
    const leg = newLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    expect(leg.initialStopPrice).toBe(70)

    // Well through the stop intraday, but closed back above it.
    update(leg, 78, 61, 79)
    expect(leg.phase).toBe('entered')
  })

  it('measures an idle leg’s stop from today’s close, not the old level', () => {
    const leg = newLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    update(leg, 69, 69, 79)
    update(leg, 40, 38, 69)
    expect(leg.phase).toBe('idle')

    // The stop a cycle armed at 40 would carry: 40 − 2×10, then one ATR under.
    expect(leg.stopPrice(ATR)).toBe(10)
  })

  it('counts a pullback to the stop that holds as a retrace', () => {
    const leg = newLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)

    // Lower, but not yet back to the stop at 70.
    update(leg, 78, 75, 79)
    expect(leg.isRetraced).toBe(false)

    // Down to the stop and closed above it — the second chance.
    update(leg, 75, 70, 75)
    expect(leg.isRetraced).toBe(true)
    expect(leg.retraceTouchPrice).toBe(70)
    expect(leg.isSignalled).toBe(false)
    expect(leg.signalCount).toBe(2)

    // The trade it is a second chance at is unchanged.
    expect(leg.phase).toBe('entered')
    expect(leg.entryPrice).toBe(80)
    expect(leg.initialStopPrice).toBe(70)

    // Still sitting on the stop is the same approach, not another one.
    update(leg, 74, 70, 70)
    expect(leg.isRetraced).toBe(false)
    expect(leg.signalCount).toBe(2)
  })

  it('measures a retrace to the trail while trailing', () => {
    const leg = newLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)

    // +2R at 100 arms the trail at 105 − 2×10.
    update(leg, 105, 100, 79)
    expect(leg.phase).toBe('trailing')
    expect(leg.stopPrice(ATR)).toBe(85)

    // Back to the trail, well above the initial stop at 70.
    update(leg, 88, 85, 100)
    expect(leg.isRetraced).toBe(true)
    expect(leg.phase).toBe('trailing')
    expect(leg.signalCount).toBe(2)
  })

  it.each([
    [false, 1],
    [true, 2],
  ])('counts a touch that closes through the stop only when asked (%s → %d)', (onExit, count) => {
    const leg = newLeg({ retraceOnExitBar: onExit })
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    update(leg, 69, 69, 79)

    expect(leg.phase).toBe('idle')
    expect(leg.isRetraced).toBe(onExit)
    expect(leg.signalCount).toBe(count)
  })
})

describe('ATR frozen at entry', () => {
  it('keeps the stop and the target on the ATR they were risked at', () => {
    const leg = newLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    expect(leg.initialStopPrice).toBe(70)

    // Volatility triples while the trade is open. Re-reading ATR here would move the
    // stop of a trade already on, so it does not.
    update(leg, 90, 85, 79, 30)
    expect(leg.phase).toBe('entered')
    expect(leg.initialStopPrice).toBe(70)

    // The target is +2R off the entry ATR, so 80 + 2×10 rather than anything derived
    // from the 30 above.
    update(leg, 100, 95, 85, 30)
    expect(leg.phase).toBe('trailing')

    // Trail is peak − 2×10 = 80. On the live ATR it would have been 100 − 2×30 = 40,
    // floored back to the 70 stop.
    expect(leg.trailStopPrice).toBe(80)
  })
})

describe('the floor under the trail', () => {
  it('never lets the trail sit below the stop already accepted', () => {
    // Four ATR of trail against one of stop. Above three, the unfloored trail at
    // activation is below the initial stop, which would widen the risk at the moment the
    // trade started working.
    const leg = newLeg({ trailFactor: 4 })
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    expect(leg.initialStopPrice).toBe(70)

    // Activates at 80 + 2×10. Unfloored the trail would be 100 − 4×10.
    update(leg, 100, 95, 79)
    expect(leg.phase).toBe('trailing')
    expect(leg.trailStopPrice).toBe(70)
    expect(leg.trailStopPrice).toBe(leg.initialStopPrice)
  })

  it('ratchets up and never down', () => {
    const leg = newLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    update(leg, 100, 95, 79)
    expect(leg.trailStopPrice).toBe(80)

    // A higher peak lifts the trail.
    update(leg, 110, 105, 95)
    expect(leg.trailStopPrice).toBe(90)

    // A lower close does not lower it.
    update(leg, 105, 100, 105)
    expect(leg.trailStopPrice).toBe(90)

    // Closed through it — the move is spent, so this needs a fresh breakout.
    update(leg, 89, 89, 100)
    expect(leg.phase).toBe('idle')
  })
})

describe('where the trail arms', () => {
  it('moves with activationR', () => {
    // Arms at +3R rather than the default +2R, with a 1R wide trail.
    const leg = newLeg({ trailFactor: 1, activationR: 3 })
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    expect(leg.entryPrice).toBe(80)
    expect(leg.initialStopPrice).toBe(70)

    // +2R would have armed here. It does not.
    update(leg, 100, 95, 79)
    expect(leg.phase).toBe('entered')

    // +3R does. And because the trail is 1R wide against an activation of 3R, it arms
    // 2R above the entry rather than at breakeven.
    update(leg, 112, 108, 95)
    expect(leg.phase).toBe('trailing')
    expect(leg.trailStopPrice).toBe(102)
    expect(
      (leg.trailStopPrice - leg.entryPrice) / (leg.entryPrice - leg.initialStopPrice)
    ).toBeGreaterThanOrEqual(2)
  })

  it('arms at breakeven when the activation equals the trail width', () => {
    const leg = newLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)

    // Peak lands exactly on the activation, so the trail lands exactly on the entry.
    update(leg, 100, 95, 79)
    expect(leg.phase).toBe('trailing')
    expect(leg.trailStopPrice).toBe(leg.entryPrice)
  })
})

describe('reset', () => {
  it('returns a leg to its constructed state', () => {
    const leg = newLeg()
    enterAt80(leg)
    expect(leg.phase).toBe('entered')

    leg.reset()

    expect(leg.phase).toBe('idle')
    expect(leg.signalCount).toBe(0)
    expect(leg.entryPrice).toBe(0)
    expect(leg.initialStopPrice).toBe(0)
    expect(leg.trailStopPrice).toBe(0)
    expect(leg.retraceLevel).toBe(0)
    expect(leg.isSignalled).toBe(false)
  })
})

describe('a new cycle does not carry the last trade’s figures', () => {
  it('clears the finished trade’s entry and stop when a cycle arms', () => {
    const leg = newLeg()
    enterAt80(leg)
    expect(leg.entryPrice).toBe(80)
    expect(leg.initialStopPrice).toBe(70)

    update(leg, 69, 69, 79)
    expect(leg.phase).toBe('idle')

    // A fresh breakout far below, so the new cycle's numbers cannot be confused with
    // the old one's.
    update(leg, 50, 50, 69, ATR, true)

    expect(leg.phase).toBe('monitoring')
    expect(leg.inPosition).toBe(false)
    expect(leg.retraceLevel).toBe(30)

    // No trade in this cycle yet, so there is no entry and no stop for one.
    expect(leg.entryPrice).toBe(0)
    expect(leg.initialStopPrice).toBe(0)
    expect(leg.trailStopPrice).toBe(0)
    expect(leg.riskPct).toBe(0)

    // What the armed leg does report: the stop the next entry would carry.
    expect(leg.stopPrice(ATR)).toBe(20)
  })

  it('clears the entry and stop on a stop-out too', () => {
    const leg = newLeg()
    enterAt80(leg)
    expect(leg.entryPrice).toBe(80)

    update(leg, 69, 69, 79)

    expect(leg.phase).toBe('idle')
    expect(leg.inPosition).toBe(false)
    expect(leg.entryPrice).toBe(0)
    expect(leg.initialStopPrice).toBe(0)
  })
})

describe('the retrace level stays current', () => {
  it('keeps ratcheting while a trade is on, without moving the trade', () => {
    // Three ATR of stop, so the +2R target is far enough away that the trade stays in
    // Entered while price rises.
    const leg = newLeg({ stopFactor: 3 })
    enterAt80(leg)
    expect(leg.phase).toBe('entered')
    expect(leg.entryPrice).toBe(80)
    expect(leg.initialStopPrice).toBe(50)

    // Price runs up. A level frozen for the life of the trade plots as a flat line, so
    // it tracks price here — 105 − 2×10.
    update(leg, 105, 100, 79)
    expect(leg.phase).toBe('entered')
    expect(leg.retraceLevel).toBe(85)

    // The trade itself does not move with it.
    expect(leg.entryPrice).toBe(80)
    expect(leg.initialStopPrice).toBe(50)
  })
})

describe('tightening the stop as ATR contracts', () => {
  const newTighteningLeg = (trailFactor = 2, direction: TradeDirection = 'long') =>
    newLeg({ trailFactor, direction, tightenStopWithAtr: true })

  it('tightens the stop but not the accepted one', () => {
    const leg = newTighteningLeg()
    enterAt80(leg)
    expect(leg.phase).toBe('entered')
    expect(leg.initialStopPrice).toBe(70)
    expect(leg.stopFloorPrice).toBe(70)

    // ATR contracts to 6, so the stop moves up to 80 − 6.
    update(leg, 86, 84, 79, 6)
    expect(leg.stopFloorPrice).toBe(74)

    // The accepted stop is what the position was sized against, so it is not rewritten.
    expect(leg.initialStopPrice).toBe(70)
    expect(leg.riskPct).toBeCloseTo(12.5, 9)
  })

  it('never loosens when ATR expands again', () => {
    const leg = newTighteningLeg()
    enterAt80(leg)
    update(leg, 86, 84, 79, 6)
    expect(leg.stopFloorPrice).toBe(74)

    // Volatility triples. The stop is anchored to the lowest ATR since entry, so the
    // quiet stretch keeps the risk it earned.
    update(leg, 87, 85, 84, 30)
    expect(leg.stopFloorPrice).toBe(74)
  })

  it('is off by default', () => {
    const leg = newLeg()
    enterAt80(leg)
    update(leg, 86, 84, 79, 6)
    expect(leg.initialStopPrice).toBe(70)
    expect(leg.stopFloorPrice).toBe(70)
  })

  it('exits a trade the accepted stop would hold', () => {
    const frozen = newLeg()
    const tightening = newTighteningLeg()

    for (const leg of [frozen, tightening]) {
      enterAt80(leg)
      update(leg, 86, 84, 79, 6)
      update(leg, 73, 73, 84, 6)
    }

    // 73 is under the tightened 74 but above the accepted 70.
    expect(tightening.phase).toBe('idle')
    expect(frozen.phase).toBe('entered')
  })

  it('floors the trail at the tightened stop, not the accepted one', () => {
    const leg = newTighteningLeg(4)
    enterAt80(leg)

    // Contracts to 6 and reaches the +2R activation on the same bar.
    update(leg, 100, 95, 79, 6)

    expect(leg.phase).toBe('trailing')
    expect(leg.stopFloorPrice).toBe(74)
    expect(leg.trailStopPrice).toBe(74)
  })

  it('tightens downward for a short', () => {
    const leg = newTighteningLeg(2, 'short')
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 115, 121, 100)
    expect(leg.entryPrice).toBe(120)
    expect(leg.initialStopPrice).toBe(130)

    // Tighter is downward on this side — 120 + 6, not 120 − 6.
    update(leg, 114, 118, 121, 6)
    expect(leg.stopFloorPrice).toBe(126)
    expect(leg.initialStopPrice).toBe(130)
    expect(leg.riskPct).toBeGreaterThan(0)
  })
})

describe('trailing at the retrace depth', () => {
  // 1R = 5 at a 10 ATR, and the cap sits 2 ATR back from the best close. activationR is
  // parked out of reach so the cap is provably what arms the trail.
  const newRetraceDepthLeg = (direction: TradeDirection = 'long', tightenStopWithAtr = false) =>
    newLeg({
      stopFactor: 0.5,
      activationR: 10,
      direction,
      tightenStopWithAtr,
      trailAtRetraceDepth: true,
    })

  it('holds at the initial stop until the cap clears it', () => {
    const leg = newRetraceDepthLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    expect(leg.entryPrice).toBe(80)
    expect(leg.initialStopPrice).toBe(75)

    // Cap is 65 at a best close of 85, well under the stop, so nothing moves.
    update(leg, 90, 88, 79)
    expect(leg.phase).toBe('entered')
    expect(leg.stopFloorPrice).toBe(75)
  })

  it('takes over with no activation once the cap clears the stop', () => {
    const leg = newRetraceDepthLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)

    // Cap 76 clears the 75 stop. activationR wants 130, so the cap armed this itself.
    update(leg, 96, 94, 88)
    expect(leg.phase).toBe('trailing')
    expect(leg.trailStopPrice).toBe(76)
  })

  it('does not lower the cap on a pullback after a high', () => {
    const leg = newRetraceDepthLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)

    // Runs to 110, so the cap is 110 − 20.
    update(leg, 110, 108, 79)
    expect(leg.phase).toBe('trailing')
    expect(leg.trailStopPrice).toBe(90)

    // Pulls back to 100. The cap is ratcheted, so it holds at 90 rather than dropping.
    update(leg, 100, 98, 108)
    expect(leg.trailStopPrice).toBe(90)
  })

  it('does not drag the cap up to the frozen peak as ATR contracts', () => {
    const leg = newRetraceDepthLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)

    // Peak close 110 set at a 10 ATR, so the cap is 90.
    update(leg, 110, 108, 79)
    expect(leg.trailStopPrice).toBe(90)

    // Pairing the frozen peak with a live ATR would put the cap at 110 − 4 = 106, above
    // the close, ending a trade price never threatened. Each close carries its own ATR,
    // so it is 95 − 4 = 91.
    update(leg, 95, 93, 108, 2)
    expect(leg.phase).toBe('trailing')
    expect(leg.trailStopPrice).toBe(91)
  })

  it('freezes the cap rather than loosening it when ATR expands', () => {
    const leg = newRetraceDepthLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    update(leg, 110, 108, 79)
    expect(leg.trailStopPrice).toBe(90)

    // Live, the cap would drop to 70. The ratchet holds it at 90.
    update(leg, 112, 110, 108, 20)
    expect(leg.trailStopPrice).toBe(90)
  })

  it('follows the live ATR down as volatility contracts', () => {
    const leg = newRetraceDepthLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    update(leg, 110, 108, 79)
    expect(leg.trailStopPrice).toBe(90)

    // ATR halves on a flat close, so 2 ATR back from 110 is now 100.
    update(leg, 110, 109, 108, 5)
    expect(leg.trailStopPrice).toBe(100)
  })

  it('caps the ATR-contraction ratchet at the retrace depth too', () => {
    const leg = newRetraceDepthLeg('long', true)
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    expect(leg.stopFloorPrice).toBe(75)

    // Ratchet wants 79.5, cap allows 83, so the ratchet wins.
    update(leg, 85, 84, 79, 1)
    expect(leg.stopFloorPrice).toBeCloseTo(79.5, 9)

    // Cap now the tighter of the two, and it bounds the floor.
    update(leg, 85, 84, 84, 0.2)
    expect(leg.stopFloorPrice).toBeLessThanOrEqual(84.6 + 1e-9)
  })

  it('caps a short above the low-water close', () => {
    const leg = newRetraceDepthLeg('short')

    // Broke down from 100, so the entry is 2 ATR up at 120.
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 115, 121, 100)
    expect(leg.entryPrice).toBe(120)
    expect(leg.initialStopPrice).toBe(125)

    // Falls to 90, so the cap is 2 ATR *above* the low-water close.
    update(leg, 90, 92, 121)
    expect(leg.phase).toBe('trailing')
    expect(leg.trailStopPrice).toBe(110)

    // Bounces to 100. Measured off the best close, so the cap holds.
    update(leg, 100, 102, 92)
    expect(leg.trailStopPrice).toBe(110)
  })

  it('is off by default, so the trail stays on trailFactor', () => {
    // Without the mode, trailFactor off the frozen ATR behind the activationR gate, so
    // nothing arms at 96.
    const leg = newLeg({ stopFactor: 0.5, activationR: 10 })
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 85, 79, 100)
    update(leg, 96, 94, 79)

    expect(leg.phase).toBe('entered')
    expect(leg.stopFloorPrice).toBe(75)
  })
})

describe('short legs are long legs reflected', () => {
  const mirror = (price: number): number => 200 - price

  it('reflects every level and phase of a long leg', () => {
    const longLeg = newLeg()
    const shortLeg = newShortLeg()

    // A breakout, an entry, a retrace of the stop, the trail arming, a retrace of the
    // trail, a close through it, and a fresh breakout.
    const bars: [number, number, number, boolean][] = [
      [100, 100, 100, true],
      [85, 79, 100, false],
      [75, 70, 79, false],
      [105, 100, 70, false],
      [88, 85, 100, false],
      [84, 84, 85, false],
      [110, 110, 84, true],
    ]

    const phasesSeen = new Set<TradePhase>()

    for (const [close, extreme, prevExtreme, armed] of bars) {
      longLeg.update(close, extreme, prevExtreme, ATR, armed)
      shortLeg.update(mirror(close), mirror(extreme), mirror(prevExtreme), ATR, armed)

      phasesSeen.add(longLeg.phase)

      expect(shortLeg.phase).toBe(longLeg.phase)
      expect(shortLeg.isSignalled).toBe(longLeg.isSignalled)
      expect(shortLeg.isRetraced).toBe(longLeg.isRetraced)
      expect(shortLeg.signalCount).toBe(longLeg.signalCount)
      expect(shortLeg.inPosition).toBe(longLeg.inPosition)
      expect(shortLeg.isPendingEntry).toBe(longLeg.isPendingEntry)

      expect(shortLeg.retraceLevel).toBeCloseTo(mirror(longLeg.retraceLevel), 9)
      expect(shortLeg.stopPrice(ATR)).toBeCloseTo(mirror(longLeg.stopPrice(ATR)), 9)

      // Only once a trade has set them; both sit at zero before that, which is not a
      // price and so does not reflect.
      if (longLeg.entryPrice === 0) continue

      expect(shortLeg.entryPrice).toBeCloseTo(mirror(longLeg.entryPrice), 9)
      expect(shortLeg.initialStopPrice).toBeCloseTo(mirror(longLeg.initialStopPrice), 9)

      // Risk is a percentage of two different entry prices, so it is the sign that has
      // to agree rather than the value.
      expect(shortLeg.riskPct > 0).toBe(longLeg.riskPct > 0)
    }

    // Guards against the whole sequence having sat in one phase.
    expect(phasesSeen.size).toBe(4)
  })

  it('enters on a pullup and stops out above', () => {
    const leg = newShortLeg()

    // Armed at 100, so the level is 100 + 2×10 — above price, not below.
    update(leg, 100, 100, 100, ATR, true)
    expect(leg.phase).toBe('monitoring')
    expect(leg.retraceLevel).toBe(120)

    // The high crosses 120 from below — the entry.
    update(leg, 115, 121, 100)
    expect(leg.phase).toBe('entered')
    expect(leg.isSignalled).toBe(true)
    expect(leg.entryPrice).toBe(120)
    expect(leg.initialStopPrice).toBe(130)
    expect(leg.riskPct).toBeGreaterThan(0)

    // An intraday spike above the stop that closes back under it is not an exit here
    // either.
    update(leg, 128, 139, 121)
    expect(leg.phase).toBe('entered')

    // Closed above it, so out.
    update(leg, 131, 131, 139)
    expect(leg.phase).toBe('idle')
  })

  it('ratchets the trail down and never up', () => {
    const leg = newShortLeg()
    update(leg, 100, 100, 100, ATR, true)
    update(leg, 115, 121, 100)

    // Arms at 120 − 2×10, and the trail lands 2×10 above the trough, which for the
    // default pairing is the entry itself.
    update(leg, 100, 105, 121)
    expect(leg.phase).toBe('trailing')
    expect(leg.trailStopPrice).toBe(leg.entryPrice)

    // A lower trough pulls the trail down with it.
    update(leg, 90, 95, 105)
    expect(leg.trailStopPrice).toBe(110)

    // A higher close does not lift it back.
    update(leg, 95, 100, 95)
    expect(leg.trailStopPrice).toBe(110)

    update(leg, 111, 111, 100)
    expect(leg.phase).toBe('idle')
  })
})
