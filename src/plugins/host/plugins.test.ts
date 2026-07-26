import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { atrIndicator, smaIndicator } from '../builtin/index.js'
import { createIndicatorRegistry, createStopRegistry } from './registry.js'
import { createStopHost } from './stopHost.js'
import { validatePluginModule } from './validate.js'
import type { OhlcvBar, PositionState, StopPlugin } from '@shared/contracts/index.js'

const bar = (close: number, high = close, low = close): OhlcvBar => ({
  o: close,
  h: high,
  l: low,
  c: close,
  v: 1,
  t: 0,
})

const long = (overrides: Partial<PositionState> = {}): PositionState => ({
  size: 10,
  avgCost: 100,
  barsHeld: 1,
  bestPrice: 100,
  worstPrice: 100,
  entryBarIndex: 0,
  ...overrides,
})

describe('the trust boundary', () => {
  it('imports nothing but shared/', () => {
    // The worker bundle IS the trust boundary, and a boundary is only as good as its
    // import graph. A lint rule enforces this; this test makes it visible as a
    // deliberate property rather than a config detail someone could relax.
    const dir = fileURLToPath(new URL('../worker/', import.meta.url))
    if (!existsSync(dir)) return

    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(`${dir}${file}`, 'utf8')
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] as string)
      const zoneImports = imports.filter((specifier) => specifier.startsWith('@'))
      for (const specifier of zoneImports) {
        expect(specifier.startsWith('@shared/'), `${file} imports ${specifier}`).toBe(true)
      }
    }
  })
})

describe('validatePluginModule', () => {
  it('accepts the built-ins', () => {
    for (const plugin of createStopRegistry().values()) {
      expect(validatePluginModule(plugin, 'stop'), plugin.id).toMatchObject({ ok: true })
    }
    for (const plugin of createIndicatorRegistry().values()) {
      expect(validatePluginModule(plugin, 'indicator'), plugin.id).toMatchObject({ ok: true })
    }
  })

  it('rejects a plugin with no createInstance', () => {
    const result = validatePluginModule({ id: 'x', displayName: 'X', params: [] }, 'stop')
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toMatch(/createInstance/)
  })

  it('rejects a numeric ParamSpec with no range', () => {
    // The settings UI renders controls straight from these, so a malformed spec
    // breaks the panel rather than the plugin.
    const result = validatePluginModule(
      {
        id: 'x',
        displayName: 'X',
        createInstance: () => ({ reset() {}, onBar: () => null }),
        params: [{ key: 'p', displayName: 'P', type: 'float', default: 1 }],
      },
      'stop'
    )
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toMatch(/numeric min/)
  })

  it('rejects an indicator with no paneKind or outputs', () => {
    const result = validatePluginModule(
      { id: 'x', displayName: 'X', params: [], createInstance: () => ({}) },
      'indicator'
    )
    expect(result.problems.join()).toMatch(/paneKind/)
    expect(result.problems.join()).toMatch(/outputs/)
  })

  it('rejects an inverted fixedRange', () => {
    const result = validatePluginModule(
      {
        id: 'x',
        displayName: 'X',
        paneKind: 'oscillator',
        outputs: ['x'],
        params: [],
        createInstance: () => ({}),
        fixedRange: [100, 0],
      },
      'indicator'
    )
    expect(result.problems.join()).toMatch(/fixedRange/)
  })
})

describe('simple moving average', () => {
  it('returns NaN until it is warmed up', () => {
    const instance = smaIndicator.createInstance({ length: 3 })
    expect(instance.onBar(bar(10), false).sma).toBeNaN()
    expect(instance.onBar(bar(20), false).sma).toBeNaN()
    expect(instance.onBar(bar(30), false).sma).toBe(20)
  })

  it('matches a known-good reference value', () => {
    const instance = smaIndicator.createInstance({ length: 4 })
    for (const close of [1, 2, 3]) instance.onBar(bar(close), false)
    expect(instance.onBar(bar(4), false).sma).toBe(2.5)
    expect(instance.onBar(bar(5), false).sma).toBe(3.5)
  })

  it('re-warms after reset', () => {
    const instance = smaIndicator.createInstance({ length: 2 })
    instance.onBar(bar(10), false)
    instance.onBar(bar(20), false)
    instance.reset()
    expect(instance.onBar(bar(50), false).sma).toBeNaN()
  })
})

describe('average true range', () => {
  it('returns NaN until warmed up, then a positive range', () => {
    const instance = atrIndicator.createInstance({ length: 3 })
    expect(instance.onBar(bar(100, 102, 98), false).atr).toBeNaN()
    instance.onBar(bar(101, 103, 99), false)
    const warmed = instance.onBar(bar(102, 104, 100), false).atr
    expect(Number.isFinite(warmed)).toBe(true)
    expect(warmed).toBeGreaterThan(0)
  })
})

describe('indicator-consuming stops', () => {
  const host = () =>
    createStopHost({
      active: [{ typeId: 'atr-stop', params: { atrLength: 3, multiple: 2 }, advisory: false }],
      registry: createStopRegistry(),
      indicators: createIndicatorRegistry(),
    })

  it('feeds stop-owned indicators from the first bar of the run, while flat', () => {
    // The non-obvious rule. If indicators were fed only during a position, a 14-bar
    // ATR stop would restart warm-up on every entry and offer no level for the first
    // 14 bars of each trade — precisely the bars where a position is most exposed.
    const engine = host()
    engine.reset()
    engine.observeBar(bar(100, 102, 98))
    engine.observeBar(bar(101, 103, 99))
    engine.observeBar(bar(102, 104, 100))

    // Only now does a position open — the ATR is already warm.
    engine.onEntry()
    engine.computeLevels(bar(103, 105, 101), long())
    expect(engine.levels).toHaveLength(1)
    expect(engine.levels[0]?.level).toBeLessThan(103)
  })

  it('returns no level while its indicator is still warming', () => {
    // Warm-up must produce null, never a NaN level: every comparison against NaN is
    // false, so a NaN level is a stop the HUD shows as active that can never fire.
    const engine = host()
    engine.reset()
    engine.observeBar(bar(100, 102, 98))
    engine.onEntry()
    engine.computeLevels(bar(101, 103, 99), long())
    expect(engine.levels).toEqual([])
  })

  it('does not reset its indicators when a new position opens', () => {
    const engine = host()
    engine.reset()
    for (const close of [100, 101, 102, 103]) engine.observeBar(bar(close, close + 2, close - 2))

    engine.onEntry()
    engine.computeLevels(bar(104, 106, 102), long())
    const first = engine.levels[0]?.level

    engine.onExit()
    engine.onEntry()
    // Straight back in: still warm, so there is a level on the very first bar.
    engine.computeLevels(bar(104, 106, 102), long())
    expect(engine.levels[0]?.level).toBeCloseTo(first as number, 9)
  })

  it('re-warms from scratch on a full reset, as on a ticker change', () => {
    const engine = host()
    engine.reset()
    for (const close of [100, 101, 102]) engine.observeBar(bar(close, close + 2, close - 2))
    engine.reset()
    engine.onEntry()
    engine.computeLevels(bar(103, 105, 101), long())
    expect(engine.levels).toEqual([])
  })

  it('inverts the level for a short', () => {
    const engine = host()
    engine.reset()
    for (const close of [100, 101, 102]) engine.observeBar(bar(close, close + 2, close - 2))
    engine.onEntry()
    engine.computeLevels(bar(103, 105, 101), long({ size: -10 }))
    expect(engine.levels[0]?.level).toBeGreaterThan(103)
  })

  it('refuses to build when a required indicator is not registered', () => {
    // Deliberately blocking: an unresolvable dependency is knowable before the first
    // bar, and starting a run whose stop silently doesn't exist is the failure worth
    // spending an error on.
    expect(() =>
      createStopHost({
        active: [{ typeId: 'atr-stop', params: {}, advisory: false }],
        registry: createStopRegistry(),
        indicators: new Map(),
      })
    ).toThrow(/needs indicator "atr"/)
  })

  it('gives each stop its own indicator instance, never a shared one', () => {
    // If a stop shared an instance with a displayed indicator, hiding an overlay
    // could alter — or kill — the stop driving the player's exits.
    const counted: StopPlugin[] = [...createStopRegistry().values()]
    const engine = createStopHost({
      active: [
        { typeId: 'atr-stop', params: { atrLength: 3, multiple: 1 }, advisory: false },
        { typeId: 'atr-stop', params: { atrLength: 3, multiple: 4 }, advisory: true },
      ],
      registry: createStopRegistry(),
      indicators: createIndicatorRegistry(),
    })
    expect(counted.length).toBeGreaterThan(0)
    engine.reset()
    for (const close of [100, 101, 102]) engine.observeBar(bar(close, close + 2, close - 2))
    engine.onEntry()
    engine.computeLevels(bar(103, 105, 101), long())
    // Two instances of the same stop with different multiples must give different
    // levels — proof they aren't sharing state.
    const levels = engine.levels.map((level) => level.level)
    expect(levels).toHaveLength(2)
    expect(levels[0]).not.toBeCloseTo(levels[1] as number, 6)
  })
})
