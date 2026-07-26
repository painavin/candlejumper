import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@config/index.js'
import type { RunConfig } from '@config/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { flatPosition, isFlat } from '../position/position.js'
import { emptyStats } from '../scoring/stats.js'
import { initialStreak } from '../scoring/streak.js'
import { createNoStops } from '../stops/port.js'
import type { ActiveStopLevel, StopEngine, StopEvaluation } from '../stops/port.js'
import type { PositionEvent } from '../output/events.js'
import { tickBar } from './tick.js'
import type { TickState } from './tick.js'
import type { TradeAction } from './inputBuffer.js'

const bar = (close: number, index = 0): OhlcvBar => ({
  o: close,
  h: close,
  l: close,
  c: close,
  v: 1,
  t: 1_700_000_000 + index * 86_400,
})

const config = (overrides: Partial<RunConfig> = {}): RunConfig => ({
  ...defaultConfig(),
  allowShorting: true,
  stops: { active: [], plugins: { loaded: [] } },
  ...overrides,
})

function initialState(cfg: RunConfig, stops: StopEngine): TickState {
  return {
    position: flatPosition(),
    stats: emptyStats(),
    streak: initialStreak({
      config: cfg,
      hasAdvisoryRule: stops.hasAdvisoryRule,
      hasAnyRule: stops.hasAnyRule,
    }),
    inBreach: false,
    barsHeld: 0,
  }
}

/** Run a sequence of (close, actions) pairs through the pipeline. */
function run(
  steps: readonly {
    close: number
    actions?: readonly TradeAction[]
    forceClose?: 'end-of-data' | 'ended-early'
  }[],
  cfg: RunConfig = config(),
  stops: StopEngine = createNoStops()
) {
  let state = initialState(cfg, stops)
  const events: PositionEvent[] = []
  steps.forEach((step, index) => {
    const result = tickBar(
      state,
      {
        bar: bar(step.close, index),
        index,
        actions: step.actions ?? [],
        forceClose: step.forceClose,
      },
      { config: cfg, stops }
    )
    state = result.state
    events.push(...result.events)
  })
  return { state, events }
}

/** A stop engine that fires at a fixed level, for ordering tests. */
function stopAt(level: number, advisory = false): StopEngine {
  let armed = false
  return {
    observeBar() {},
    computeLevels() {
      armed = true
    },
    evaluate(close): StopEvaluation {
      if (!armed) return { triggered: null, breaches: [] }
      const hit = close <= level
      const active: ActiveStopLevel = { stopId: 'test-stop', level, advisory }
      if (!hit) return { triggered: null, breaches: [] }
      return advisory
        ? { triggered: null, breaches: [active] }
        : { triggered: { stopId: 'test-stop', level }, breaches: [] }
    },
    levels: [],
    onEntry() {
      armed = false
    },
    onExit() {
      armed = false
    },
    reset() {
      armed = false
    },
    hasAdvisoryRule: advisory,
    hasAnyRule: true,
  }
}

describe('order intent', () => {
  it('opens long on buy while flat', () => {
    const { state, events } = run([{ close: 100, actions: ['buy'] }])
    expect(state.position.shares).toBeGreaterThan(0)
    expect(events[0]).toMatchObject({ kind: 'positionOpened', direction: 'long' })
  })

  it('denies sell while flat when shorting is off, with a cue rather than silence', () => {
    // A press that reads as a dropped input is worse than a refusal.
    const { state, events } = run([{ close: 100, actions: ['sell'] }], config({ allowShorting: false }))
    expect(isFlat(state.position)).toBe(true)
    expect(events).toEqual([{ kind: 'actionDenied', reason: 'shorting-disabled' }])
  })

  it('opens short on sell while flat when shorting is on', () => {
    const { state } = run([{ close: 100, actions: ['sell'] }])
    expect(state.position.shares).toBeLessThan(0)
  })

  it('treats buy on a short as an exit, not an entry', () => {
    // The one counterintuitive cell in the matrix: it reduces by a unit rather
    // than deploying entrySize.
    const { state, events } = run([
      { close: 100, actions: ['sell', 'sell'] },
      { close: 90, actions: ['buy'] },
    ])
    expect(state.position.unitCount).toBe(1)
    expect(state.position.shares).toBeLessThan(0)
    expect(events.at(-1)).toMatchObject({ kind: 'positionClosed', direction: 'short' })
  })

  it('never flips through zero in one press', () => {
    // Flipping requires closing to flat and entering again — a deliberate
    // two-step that avoids an accidental reversal on a mistimed press.
    const { state } = run([
      { close: 100, actions: ['sell'] },
      { close: 100, actions: ['buy'] },
    ])
    expect(isFlat(state.position)).toBe(true)
  })

  it('applies both a buy and a sell on the same bar, in press order', () => {
    const { events } = run([{ close: 100, actions: ['buy', 'sell'] }])
    expect(events.map((event) => event.kind)).toEqual(['positionOpened', 'positionClosed'])
  })

  it('denies an exit press while flat', () => {
    const { events } = run([{ close: 100, actions: ['sell'] }], config({ allowShorting: false }))
    expect(events[0]).toMatchObject({ kind: 'actionDenied' })
  })
})

describe('flatten', () => {
  it('closes everything as one event, not N', () => {
    const { state, events } = run([
      { close: 100, actions: ['buy', 'buy', 'buy'] },
      { close: 120, actions: ['flatten'] },
    ])
    expect(isFlat(state.position)).toBe(true)
    const closes = events.filter((event) => event.kind === 'positionClosed')
    expect(closes).toHaveLength(1)
    expect(closes[0]).toMatchObject({ viaFlatten: true, unitsClosed: 3 })
  })

  it('is a silent no-op while flat, with no denied cue', () => {
    // "Make sure I'm out" is a reasonable reflex and shouldn't be punished.
    const { events } = run([{ close: 100, actions: ['flatten'] }])
    expect(events).toEqual([])
  })
})

describe('fill price', () => {
  it('fills at the close of the bar the character is standing on', () => {
    const { state } = run([{ close: 250, actions: ['buy'] }])
    expect(state.position.avgCost).toBe(250)
  })
})

describe('tick ordering', () => {
  it('lets a manual exit beat a stop that would fire on the same bar', () => {
    // Inputs resolve at step 3, stops at step 5, so the stop finds a flat
    // position. Manual action always overrides an enforcing stop.
    const { state, events } = run(
      [
        { close: 100, actions: ['buy'] },
        { close: 80, actions: ['sell'] },
      ],
      config(),
      stopAt(90)
    )
    expect(isFlat(state.position)).toBe(true)
    expect(events.some((event) => event.kind === 'stoppedOut')).toBe(false)
  })

  it('lets flatten beat a stop on the same bar too', () => {
    const { events } = run(
      [
        { close: 100, actions: ['buy', 'buy'] },
        { close: 80, actions: ['flatten'] },
      ],
      config(),
      stopAt(90)
    )
    expect(events.some((event) => event.kind === 'stoppedOut')).toBe(false)
  })

  it('never fires a stop on the bar the position was opened on', () => {
    // A level computed at bar N applies at bar N+1, so entry bar is always safe.
    const { state, events } = run([{ close: 50, actions: ['buy'] }], config(), stopAt(90))
    expect(events.some((event) => event.kind === 'stoppedOut')).toBe(false)
    expect(isFlat(state.position)).toBe(false)
  })

  it('fires a stop on the bar after the level was computed', () => {
    const { state, events } = run(
      [
        { close: 100, actions: ['buy'] },
        { close: 80 },
      ],
      config(),
      stopAt(90)
    )
    expect(events.some((event) => event.kind === 'stoppedOut')).toBe(true)
    expect(isFlat(state.position)).toBe(true)
  })

  it('closes the entire position when a stop fires, never a fraction', () => {
    // A partial stop-out would blur the "you got taken out" signal.
    const { state, events } = run(
      [
        { close: 100, actions: ['buy', 'buy', 'buy'] },
        { close: 80 },
      ],
      config(),
      stopAt(90)
    )
    expect(isFlat(state.position)).toBe(true)
    expect(state.position.unitCount).toBe(0)
    expect(events.filter((event) => event.kind === 'positionClosed')).toHaveLength(1)
  })

  it('feeds stop indicators every bar, including while flat', () => {
    // Otherwise a 14-bar ATR stop restarts warm-up on every entry and offers no
    // level for the first 14 bars of each trade.
    const observed: number[] = []
    const stops: StopEngine = {
      ...createNoStops(),
      observeBar: (b) => observed.push(b.c),
    }
    run([{ close: 100 }, { close: 110 }, { close: 120 }], config(), stops)
    expect(observed).toEqual([100, 110, 120])
  })
})

describe('advisory stops', () => {
  it('records a breach without closing anything', () => {
    const { state, events } = run(
      [
        { close: 100, actions: ['buy'] },
        { close: 80 },
      ],
      config(),
      stopAt(90, true)
    )
    expect(isFlat(state.position)).toBe(false)
    expect(events.some((event) => event.kind === 'advisoryBreached')).toBe(true)
    expect(events.some((event) => event.kind === 'stoppedOut')).toBe(false)
  })
})

describe('end of data', () => {
  it('force-closes an open position at the final bar and reports it distinctly', () => {
    // Neither a player decision nor a stop, so counting it as a normal exit would
    // quietly distort win-rate stats.
    const { state, events } = run([
      { close: 100, actions: ['buy'] },
      { close: 120, forceClose: 'end-of-data' },
    ])
    expect(isFlat(state.position)).toBe(true)
    expect(events.some((event) => event.kind === 'forceClosed')).toBe(true)
    expect(state.stats.stats.campaigns[0]?.forceClosed).toBe(true)
  })

  it('does nothing extra when the last bar arrives already flat', () => {
    const { events } = run([{ close: 100, forceClose: 'end-of-data' }])
    expect(events).toEqual([])
  })
})
