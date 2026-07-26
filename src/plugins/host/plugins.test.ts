import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { atrIndicator, smaIndicator } from '../builtin/index.js'
import { createIndicatorRegistry, createStopRegistry } from './registry.js'
import { createStopHost } from './stopHost.js'
import { validatePluginModule } from './validate.js'
import { createIndicatorFeed } from './indicatorFeed.js'
import { instanceLabel } from '@shared/contracts/index.js'
import { DEFAULT_INDICATOR_COLOUR, INDICATOR_COLOURS } from '@shared/palette/index.js'
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

describe('several instances of one indicator', () => {
  /**
   * The case the settings screen now supports: SMA 20 / 50 / 200 at once. It was
   * always possible in the engine — the UI hardcoded `instanceId: 'sma-1'`, which
   * capped it at one — so these guard the parts that had never been exercised.
   */
  const feedOf = (...lengths: number[]) =>
    createIndicatorFeed({
      active: lengths.map((length, index) => ({
        instanceId: `sma-${index + 1}`,
        typeId: 'sma',
        params: { length },
        colour: INDICATOR_COLOURS[index]?.value,
      })),
      registry: createIndicatorRegistry(),
    })

  it('keeps a separate history per instance', () => {
    const feed = feedOf(2, 4)
    for (const close of [10, 20, 30, 40]) feed.observeBar(bar(close), false)

    const [fast, slow] = feed.series
    expect(fast?.history.sma?.at(-1)).toBe(35)
    expect(slow?.history.sma?.at(-1)).toBe(25)
  })

  it('warms each instance up on its own schedule', () => {
    // A shared accumulator would warm both at the shorter length and quietly emit a
    // wrong long average for the first bars.
    const feed = feedOf(2, 4)
    feed.observeBar(bar(10), false)
    feed.observeBar(bar(20), false)

    const [fast, slow] = feed.series
    expect(fast?.history.sma?.at(-1)).toBe(15)
    expect(slow?.history.sma?.at(-1)).toBeNaN()
  })

  it('names each instance by its own parameters', () => {
    // Three lines in three colours are only readable if each says which it is.
    const labels = feedOf(20, 50, 200).series.map((series) => series.displayName)
    expect(labels).toEqual(['SMA 20', 'SMA 50', 'SMA 200'])
  })

  it('carries each instance its own line colour', () => {
    // Chosen per instance rather than derived from list position, so removing one
    // indicator can't recolour the lines below it.
    const colours = feedOf(20, 50, 200).series.map((series) => series.colour)
    expect(colours).toEqual([
      INDICATOR_COLOURS[0]?.value,
      INDICATOR_COLOURS[1]?.value,
      INDICATOR_COLOURS[2]?.value,
    ])
    expect(new Set(colours).size).toBe(3)
  })

  it('falls back to the palette default when a spec carries no colour', () => {
    const feed = createIndicatorFeed({
      active: [{ instanceId: 'sma-1', typeId: 'sma', params: { length: 20 } }],
      registry: createIndicatorRegistry(),
    })
    expect(feed.series[0]?.colour).toBe(DEFAULT_INDICATOR_COLOUR)
  })

  it('resets every instance independently', () => {
    const feed = feedOf(2, 4)
    for (const close of [10, 20, 30, 40]) feed.observeBar(bar(close), false)
    feed.reset()
    expect(feed.series.every((series) => series.history.sma?.length === 0)).toBe(true)
    feed.observeBar(bar(10), false)
    expect(feed.series[0]?.history.sma?.at(-1)).toBeNaN()
  })
})

describe('per-instance pane choice', () => {
  const feedWith = (typeId: string, paneKind?: 'overlay' | 'oscillator') =>
    createIndicatorFeed({
      active: [{ instanceId: `${typeId}-1`, typeId, params: {}, paneKind }],
      registry: createIndicatorRegistry(),
    })

  it('follows the plugin when the player expressed no preference', () => {
    expect(feedWith('sma').series[0]?.paneKind).toBe('overlay')
    expect(feedWith('atr').series[0]?.paneKind).toBe('oscillator')
  })

  it('lets the player move an overlay into its own pane', () => {
    expect(feedWith('sma', 'oscillator').series[0]?.paneKind).toBe('oscillator')
  })

  it('lets the player move a pane indicator onto the main chart', () => {
    // Legitimate because `paneKind` is documented as a *rendering hint* — the same
    // indicator is consumed as bare numbers by stop plugins, so it never depended on
    // having a pane of its own.
    expect(feedWith('atr', 'overlay').series[0]?.paneKind).toBe('overlay')
  })

  it('changes nothing but the pane', () => {
    // The override is presentation only: the arithmetic, the warm-up, and the label
    // must be identical either way, or "where do I draw this" would quietly become
    // "what does this compute".
    const onChart = feedWith('atr', 'overlay')
    const ownPane = feedWith('atr', 'oscillator')
    for (const feed of [onChart, ownPane]) {
      for (const close of [100, 101, 102, 103]) feed.observeBar(bar(close, close + 2, close - 2), false)
    }
    expect(onChart.series[0]?.history.atr).toEqual(ownPane.series[0]?.history.atr)
    expect(onChart.series[0]?.displayName).toBe(ownPane.series[0]?.displayName)
  })
})

describe('instanceLabel', () => {
  it('prefers the abbreviation, so a legend stays legible', () => {
    expect(instanceLabel(smaIndicator, { length: 20 })).toBe('SMA 20')
  })

  it('falls back to the display name when a plugin declares no abbreviation', () => {
    // Optional on the contract, so an existing user plugin keeps working.
    const anonymous = { displayName: 'Custom Thing', params: smaIndicator.params }
    expect(instanceLabel(anonymous, { length: 9 })).toBe('Custom Thing 9')
  })

  it('uses the spec default when a param is missing', () => {
    expect(instanceLabel(smaIndicator, {})).toBe('SMA 20')
  })

  it('appends every param in declaration order', () => {
    // What makes this work for an indicator with more than one, e.g. MACD(12, 26, 9),
    // without that plugin having to know about the labelling at all.
    const multi = {
      displayName: 'MACD',
      abbreviation: 'MACD',
      params: [
        { key: 'fast', displayName: 'Fast', type: 'int' as const, default: 12 },
        { key: 'slow', displayName: 'Slow', type: 'int' as const, default: 26 },
        { key: 'signal', displayName: 'Signal', type: 'int' as const, default: 9 },
      ],
    }
    expect(instanceLabel(multi, { fast: 12, slow: 26, signal: 9 })).toBe('MACD 12 26 9')
  })

  it('keeps decimals for a non-integer param instead of collapsing it', () => {
    const fractional = {
      displayName: 'Band',
      abbreviation: 'BB',
      params: [{ key: 'sigma', displayName: 'Sigma', type: 'float' as const, default: 2.5 }],
    }
    expect(instanceLabel(fractional, { sigma: 2.5 })).toBe('BB 2.50')
  })

  it('names a param-less indicator with no trailing space', () => {
    expect(instanceLabel({ displayName: 'Thing', params: [] }, {})).toBe('Thing')
  })

  it('marks a non-finite value rather than printing NaN', () => {
    expect(instanceLabel(smaIndicator, { length: Number.NaN })).toBe('SMA ?')
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
