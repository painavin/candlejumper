import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@config/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import type { PositionEvent } from '@engine/output/index.js'
import { createRunController } from '@engine/run/runController.js'
import { createIndicatorRegistry, createStopRegistry, createStopHost } from '@plugins/host/index.js'

/**
 * The `pullback-stop` enforced by the real run controller, end to end.
 *
 * The unit tests pin the leg against the C# facts and the stop against the indicator's
 * level. This is the one that pins the *seam* — that the level the leg computes at bar N
 * is the level the engine tests at bar N+1's close, and that a close through it really
 * does close the player's position. A stop that displays a level it never enforces is
 * the failure this exists to catch.
 */

const DAY = 24 * 60 * 60

const bar = (index: number, c: number, h: number, l: number): OhlcvBar => ({
  o: c,
  h,
  l,
  c,
  v: 1_000,
  t: index * DAY,
})

/**
 * Bars 0–2 are the three-bar breakout window filling, at closes 100, 101, 102: bar 2
 * arms the leg at 102 − 2×2 = 98. Bar 3's low of 97 crosses that level, so the leg
 * enters at 98 on an ATR of 3 and its stop is 95. Then:
 *
 *   bar 4  closes 101 — holds
 *   bar 5  closes  96 — a low of 94 is through the stop, but the *close* is above it
 *   bar 6  closes  94 — a close through the stop, so the trade is over
 */
const BARS: OhlcvBar[] = [
  bar(0, 100, 101, 99),
  bar(1, 101, 102, 100),
  bar(2, 102, 103, 101),
  bar(3, 100, 101, 97),
  bar(4, 101, 102, 99),
  bar(5, 96, 97, 94),
  bar(6, 94, 96, 93),
  ...Array.from({ length: 12 }, (_, index) => bar(7 + index, 92 - index, 93 - index, 91 - index)),
]

function newRun(advisory: boolean) {
  const config = defaultConfig()
  config.stops.active = [
    {
      typeId: 'pullback-stop',
      params: {
        breakoutLength: 3,
        atrLength: 3,
        atrFactor: 2,
        atrTolerancePercent: 0,
        stopFactor: 1,
        trailFactor: 2,
        activationR: 2,
        tightenStopWithAtr: 0,
        trailAtRetraceDepth: 0,
      },
      advisory,
    },
  ]

  const stops = createStopHost({
    active: config.stops.active,
    registry: createStopRegistry(),
    indicators: createIndicatorRegistry(),
  })

  return createRunController({ bars: BARS, config, visibleBarCount: 5, stops })
}

/** Advance in small steps, collecting every event, until the cursor reaches `index`. */
function playTo(
  controller: ReturnType<typeof newRun>,
  index: number,
  events: PositionEvent[]
): void {
  for (let step = 0; step < 2_000 && controller.frame.currentIndex < index; step++) {
    events.push(...controller.advance(0.05).events)
  }
}

describe('pullback-stop in a run', () => {
  it('closes the position on the first close through the leg’s stop, and not on a wick', () => {
    const controller = newRun(false)
    const events: PositionEvent[] = []

    controller.advance(0)
    // Buy on the leg's entry bar, at its close of 100.
    playTo(controller, 3, events)
    controller.press('buy')

    // Bar 5's low is through 95 but its close is not: no exit.
    playTo(controller, 5, events)
    expect(events.some((event) => event.kind === 'stoppedOut')).toBe(false)
    expect(controller.frame.hud.shares).toBeGreaterThan(0)

    // Bar 6 closes at 94, at or through the 95 that bar 5 computed.
    playTo(controller, 7, events)
    const stopped = events.find((event) => event.kind === 'stoppedOut')
    expect(stopped).toMatchObject({
      kind: 'stoppedOut',
      direction: 'long',
      stopId: 'pullback-stop',
      level: 95,
      price: 94,
    })
    expect(controller.frame.hud.shares).toBe(0)
  })

  it('never fires on the bar the position opened on', () => {
    const controller = newRun(false)
    const events: PositionEvent[] = []

    controller.advance(0)
    // Bought on bar 6 — the bar that closes at 94, under where the stop would be. The
    // level the leg computed on bar 5 is not a level this position had when bar 6 closed.
    playTo(controller, 6, events)
    controller.press('buy')
    playTo(controller, 7, events)

    expect(events.some((event) => event.kind === 'stoppedOut')).toBe(false)
  })

  it('only advises when advisory, leaving the position open', () => {
    const controller = newRun(true)
    const events: PositionEvent[] = []

    controller.advance(0)
    playTo(controller, 3, events)
    controller.press('buy')
    playTo(controller, 8, events)

    expect(events.some((event) => event.kind === 'stoppedOut')).toBe(false)
    expect(events.some((event) => event.kind === 'advisoryBreached')).toBe(true)
    expect(controller.frame.hud.shares).toBeGreaterThan(0)
  })
})
