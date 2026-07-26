import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@config/index.js'
import type {
  OhlcvBar,
  PositionState,
  StopInstanceSpec,
  StopPlugin,
} from '@shared/contracts/index.js'
import { createStopHost } from './stopHost.js'
import { createStopRegistry } from './registry.js'

const bar = (close: number): OhlcvBar => ({ o: close, h: close, l: close, c: close, v: 1, t: 0 })

const long = (overrides: Partial<PositionState> = {}): PositionState => ({
  size: 10,
  avgCost: 100,
  barsHeld: 1,
  bestPrice: 100,
  worstPrice: 100,
  entryBarIndex: 0,
  ...overrides,
})

const short = (overrides: Partial<PositionState> = {}): PositionState => ({
  ...long(),
  size: -10,
  ...overrides,
})

const host = (active: StopInstanceSpec[]) =>
  createStopHost({ active, registry: createStopRegistry() })

describe('fixed-percent', () => {
  it('sits below average entry when long', () => {
    const engine = host([{ typeId: 'fixed-percent', params: { percent: 5 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(100), long())
    expect(engine.levels[0]?.level).toBeCloseTo(95, 9)
  })

  it('sits above average entry when short', () => {
    // Direction inverts: the same code with a sign flip, not a second
    // implementation.
    const engine = host([{ typeId: 'fixed-percent', params: { percent: 5 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(100), short())
    expect(engine.levels[0]?.level).toBeCloseTo(105, 9)
  })

  it('follows average cost as the position scales in', () => {
    const engine = host([{ typeId: 'fixed-percent', params: { percent: 10 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(100), long({ avgCost: 100 }))
    expect(engine.levels[0]?.level).toBeCloseTo(90, 9)
    engine.computeLevels(bar(150), long({ avgCost: 120 }))
    expect(engine.levels[0]?.level).toBeCloseTo(108, 9)
  })

  it('uses its ParamSpec default when config omits the parameter', () => {
    const engine = host([{ typeId: 'fixed-percent', params: {}, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(100), long())
    expect(engine.levels[0]?.level).toBeCloseTo(95, 9)
  })
})

describe('trailing-percent', () => {
  it('trails the best price reached, not the entry', () => {
    const engine = host([{ typeId: 'trailing-percent', params: { percent: 10 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(150), long({ bestPrice: 150 }))
    expect(engine.levels[0]?.level).toBeCloseTo(135, 9)
  })

  it('never rewinds when price pulls back', () => {
    const engine = host([{ typeId: 'trailing-percent', params: { percent: 10 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(150), long({ bestPrice: 150 }))
    // bestPrice can't fall, but a plugin that recomputed from close would drop the
    // level here — the ratchet is this plugin's whole promise.
    engine.computeLevels(bar(120), long({ bestPrice: 150 }))
    expect(engine.levels[0]?.level).toBeCloseTo(135, 9)
  })

  it('ratchets downward for a short', () => {
    const engine = host([{ typeId: 'trailing-percent', params: { percent: 10 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(80), short({ bestPrice: 80 }))
    expect(engine.levels[0]?.level).toBeCloseTo(88, 9)
    engine.computeLevels(bar(60), short({ bestPrice: 60 }))
    expect(engine.levels[0]?.level).toBeCloseTo(66, 9)
  })

  it('drops the previous trade\u2019s ratchet on a new entry', () => {
    const engine = host([{ typeId: 'trailing-percent', params: { percent: 10 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(200), long({ bestPrice: 200 }))
    expect(engine.levels[0]?.level).toBeCloseTo(180, 9)
    engine.onExit()
    engine.onEntry()
    engine.computeLevels(bar(100), long({ bestPrice: 100 }))
    expect(engine.levels[0]?.level).toBeCloseTo(90, 9)
  })
})

describe('causality', () => {
  it('offers no level until one has been computed', () => {
    // Which is why a stop can never fire on the bar the position was opened on.
    const engine = host([{ typeId: 'fixed-percent', params: { percent: 5 }, advisory: false }])
    engine.onEntry()
    expect(engine.levels).toEqual([])
    expect(engine.evaluate(1, long()).triggered).toBeNull()
  })

  it('evaluates against the level computed on the previous bar', () => {
    const engine = host([{ typeId: 'fixed-percent', params: { percent: 5 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(100), long({ avgCost: 100 })) // level 95
    expect(engine.evaluate(94, long()).triggered).toMatchObject({ level: 95 })
  })

  it('clears the level on exit, so a stale level cannot fire on the next trade', () => {
    const engine = host([{ typeId: 'fixed-percent', params: { percent: 5 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(100), long())
    engine.onExit()
    expect(engine.levels).toEqual([])
    expect(engine.evaluate(1, long()).triggered).toBeNull()
  })
})

describe('trigger direction', () => {
  it('fires a long stop when the close falls to the level', () => {
    const engine = host([{ typeId: 'fixed-percent', params: { percent: 5 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(100), long())
    expect(engine.evaluate(96, long()).triggered).toBeNull()
    expect(engine.evaluate(95, long()).triggered).not.toBeNull()
  })

  it('fires a short stop when the close rises to the level', () => {
    const engine = host([{ typeId: 'fixed-percent', params: { percent: 5 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(100), short())
    expect(engine.evaluate(104, short()).triggered).toBeNull()
    expect(engine.evaluate(105, short()).triggered).not.toBeNull()
  })
})

describe('multiple active stops', () => {
  it('enforces the tightest binding level when two fire at once', () => {
    // How a trader stacking a hard stop under a trailing stop expects it to
    // behave. For a long, the tightest is the highest level.
    const engine = host([
      { typeId: 'fixed-percent', params: { percent: 20 }, advisory: false },
      { typeId: 'trailing-percent', params: { percent: 5 }, advisory: false },
    ])
    engine.onEntry()
    engine.computeLevels(bar(100), long({ bestPrice: 100 })) // levels 80 and 95
    const evaluation = engine.evaluate(70, long())
    expect(evaluation.triggered?.level).toBeCloseTo(95, 9)
    expect(evaluation.triggered?.stopId).toBe('trailing-percent')
  })

  it('picks the tightest the other way round for a short', () => {
    const engine = host([
      { typeId: 'fixed-percent', params: { percent: 20 }, advisory: false },
      { typeId: 'trailing-percent', params: { percent: 5 }, advisory: false },
    ])
    engine.onEntry()
    engine.computeLevels(bar(100), short({ bestPrice: 100 })) // levels 120 and 105
    expect(engine.evaluate(200, short()).triggered?.level).toBeCloseTo(105, 9)
  })

  it('has no stop that bar when every plugin returns null', () => {
    const engine = host([{ typeId: 'fixed-percent', params: { percent: 5 }, advisory: false }])
    engine.onEntry()
    engine.computeLevels(bar(100), { ...long(), size: 0 })
    expect(engine.levels).toEqual([])
  })
})

describe('advisory stops', () => {
  it('reports a breach and closes nothing', () => {
    const engine = host([{ typeId: 'fixed-percent', params: { percent: 5 }, advisory: true }])
    engine.onEntry()
    engine.computeLevels(bar(100), long())
    const evaluation = engine.evaluate(90, long())
    expect(evaluation.triggered).toBeNull()
    expect(evaluation.breaches).toHaveLength(1)
  })

  it('can be active alongside an enforcing stop', () => {
    // A tight advisory stop to practise reading exits, plus a wide enforcing
    // disaster stop as a backstop.
    const engine = host([
      { typeId: 'fixed-percent', params: { percent: 5 }, advisory: true },
      { typeId: 'trailing-percent', params: { percent: 20 }, advisory: false },
    ])
    engine.onEntry()
    engine.computeLevels(bar(100), long({ bestPrice: 100 }))
    const evaluation = engine.evaluate(70, long())
    expect(evaluation.breaches).toHaveLength(1)
    expect(evaluation.triggered?.stopId).toBe('trailing-percent')
  })

  it('reports whether any advisory rule exists, since the streak depends on it', () => {
    expect(host([{ typeId: 'fixed-percent', params: {}, advisory: true }]).hasAdvisoryRule).toBe(true)
    expect(host([{ typeId: 'fixed-percent', params: {}, advisory: false }]).hasAdvisoryRule).toBe(
      false
    )
    expect(host([]).hasAnyRule).toBe(false)
  })
})

describe('misbehaving plugins', () => {
  const nanStop: StopPlugin = {
    id: 'nan-stop',
    displayName: 'Returns NaN',
    params: [],
    createInstance: () => ({ reset() {}, onBar: () => Number.NaN }),
  }

  it('coerces a non-finite level to no level at all', () => {
    // A NaN level is worse than no stop: every comparison against it is false, so
    // the HUD would show a stop as active that can never fire.
    const engine = createStopHost({
      active: [{ typeId: 'nan-stop', params: {}, advisory: false }],
      registry: createStopRegistry([nanStop]),
    })
    engine.onEntry()
    engine.computeLevels(bar(100), long())
    expect(engine.levels).toEqual([])
    expect(engine.evaluate(Number.NaN, long()).triggered).toBeNull()
  })

  it('refuses to construct a host for an unregistered stop', () => {
    expect(() => host([{ typeId: 'chandelier', params: {}, advisory: false }])).toThrow(
      /no stop plugin registered/i
    )
  })

  const throwingStop: StopPlugin = {
    id: 'throwing-stop',
    displayName: 'Throws on every bar',
    params: [],
    createInstance: () => ({
      reset() {},
      onBar: () => {
        throw new Error('kaboom')
      },
    }),
  }

  it('disables a throwing stop and tells the player, rather than failing quiet', () => {
    // The single most important behaviour in this file. A stop that dies silently
    // removes risk protection while a position is open, and docs/stops.md calls
    // failing open on risk without telling anyone the worst available outcome.
    const onDisabled = vi.fn()
    const engine = createStopHost({
      active: [{ typeId: 'throwing-stop', params: {}, advisory: false }],
      registry: createStopRegistry([throwingStop]),
      onDisabled,
    })
    engine.onEntry()
    engine.computeLevels(bar(100), long())

    expect(onDisabled).toHaveBeenCalledExactlyOnceWith('throwing-stop', 'kaboom')
    expect(engine.levels).toEqual([])
  })

  it('reports a dead stop once, not on every bar for the rest of the run', () => {
    // A per-bar notification would be an exception storm dressed up as a warning,
    // and the player can only act on it once anyway.
    const onDisabled = vi.fn()
    const engine = createStopHost({
      active: [{ typeId: 'throwing-stop', params: {}, advisory: false }],
      registry: createStopRegistry([throwingStop]),
      onDisabled,
    })
    engine.onEntry()
    for (let i = 0; i < 20; i++) engine.computeLevels(bar(100 - i), long())
    expect(onDisabled).toHaveBeenCalledTimes(1)
  })

  it('does not take a healthy stop down with a broken one', () => {
    const onDisabled = vi.fn()
    const engine = createStopHost({
      active: [
        { typeId: 'throwing-stop', params: {}, advisory: false },
        { typeId: 'fixed-percent', params: { percent: 5 }, advisory: false },
      ],
      registry: createStopRegistry([throwingStop]),
      onDisabled,
    })
    engine.onEntry()
    engine.computeLevels(bar(100), long())

    expect(onDisabled).toHaveBeenCalledTimes(1)
    // The surviving stop still protects the position.
    expect(engine.levels).toEqual([{ stopId: 'fixed-percent', level: 95, advisory: false }])
    expect(engine.evaluate(94, long()).triggered?.stopId).toBe('fixed-percent')
  })
})

describe('the shipped default', () => {
  it('is one advisory trailing stop, so the streak has a rule to measure', () => {
    const engine = createStopHost({
      active: defaultConfig().stops.active,
      registry: createStopRegistry(),
    })
    expect(engine.hasAnyRule).toBe(true)
    expect(engine.hasAdvisoryRule).toBe(true)
  })
})
