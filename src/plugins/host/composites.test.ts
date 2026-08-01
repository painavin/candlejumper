import { describe, expect, it } from 'vitest'
import type {
  IndicatorPlugin,
  IndicatorValues,
  OhlcvBar,
  PositionState,
} from '@shared/contracts/index.js'
import {
  breakoutIndicator,
  builtinIndicators,
  gapupBreakoutAtrPullbackIndicator,
} from '../builtin/index.js'
import { createIndicatorFeed } from './indicatorFeed.js'
import {
  MAX_INDICATOR_DEPTH,
  feedIndicatorNode,
  resetIndicatorNode,
  resolveIndicatorTree,
  warmupBarsFor,
} from './indicatorTree.js'
import { createIndicatorRegistry, createStopRegistry } from './registry.js'
import { createStopHost } from './stopHost.js'

const DAY = 24 * 60 * 60

interface BarShape {
  c: number
  h?: number
  l?: number
  t?: number
}

const bar = ({ c, h, l, t = 0 }: BarShape): OhlcvBar => ({
  o: c,
  h: h ?? c,
  l: l ?? c,
  c,
  v: 1,
  t,
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

/** A plugin that records what it was handed, for ordering and value assertions. */
function recorder(
  id: string,
  options: { requires?: { key: string; indicatorId: string }[]; log: string[] } & {
    value?: number
  }
): IndicatorPlugin {
  const { requires, log, value = 1 } = options
  return {
    id,
    displayName: id,
    paneKind: 'overlay',
    outputs: ['out'],
    params: [{ key: 'length', displayName: 'Length', type: 'int', default: 5, min: 1, max: 10 }],
    ...(requires
      ? { requires: () => requires.map((entry) => ({ ...entry, params: {} })) }
      : {}),
    createInstance: (params) => ({
      reset() {
        log.push(`${id}:reset`)
      },
      onBar(_bar, _isLastBar, indicators) {
        log.push(`${id}:${JSON.stringify(indicators)}`)
        return { out: value + (params.length ?? 0) }
      },
    }),
  }
}

describe('resolving an indicator tree', () => {
  it('feeds dependencies before the indicator that asked for them', () => {
    const log: string[] = []
    const registry = createIndicatorRegistry([
      recorder('leaf', { log, value: 7 }),
      recorder('root', { log, requires: [{ key: 'l', indicatorId: 'leaf' }] }),
    ])

    const node = resolveIndicatorTree({ indicatorId: 'root', params: {} }, registry)
    feedIndicatorNode(node, bar({ c: 100 }), false)

    // The ordering *is* the contract: the root must see this bar's leaf value, not the
    // previous bar's, and the only way to guarantee that is to feed the leaf first.
    expect(log[0]).toBe('leaf:{}')
    expect(log[1]).toBe('root:{"l":{"out":12}}')
  })

  it('fills a request from the dependency\'s own ParamSpec defaults', () => {
    // `requires()` names only what it cares about; `undefined` reaching a plugin's
    // arithmetic would produce NaN for the whole run.
    const log: string[] = []
    const registry = createIndicatorRegistry([recorder('leaf', { log, value: 0 })])
    const node = resolveIndicatorTree({ indicatorId: 'leaf', params: {} }, registry)
    expect(feedIndicatorNode(node, bar({ c: 1 }), false).out).toBe(5)
  })

  it('substitutes NaN for a declared output the plugin did not return', () => {
    const registry = createIndicatorRegistry([
      {
        id: 'forgetful',
        displayName: 'Forgetful',
        paneKind: 'overlay',
        outputs: ['a', 'b'],
        params: [],
        createInstance: () => ({ reset() {}, onBar: () => ({ a: 1 }) }),
      },
    ])
    const node = resolveIndicatorTree({ indicatorId: 'forgetful', params: {} }, registry)
    const values = feedIndicatorNode(node, bar({ c: 1 }), false)
    expect(values.a).toBe(1)
    expect(values.b).toBeNaN()
  })

  it('resets the whole branch, not just the root', () => {
    const log: string[] = []
    const registry = createIndicatorRegistry([
      recorder('leaf', { log }),
      recorder('root', { log, requires: [{ key: 'l', indicatorId: 'leaf' }] }),
    ])
    const node = resolveIndicatorTree({ indicatorId: 'root', params: {} }, registry)
    resetIndicatorNode(node)
    expect(log).toEqual(['root:reset', 'leaf:reset'])
  })

  it('refuses a cycle, naming the whole path', () => {
    const log: string[] = []
    const registry = createIndicatorRegistry([
      recorder('a', { log, requires: [{ key: 'b', indicatorId: 'b' }] }),
      recorder('b', { log, requires: [{ key: 'a', indicatorId: 'a' }] }),
    ])
    expect(() => resolveIndicatorTree({ indicatorId: 'a', params: {} }, registry)).toThrow(
      /cycle: a → b → a/
    )
  })

  it('refuses an indicator that requires itself', () => {
    const log: string[] = []
    const registry = createIndicatorRegistry([
      recorder('self', { log, requires: [{ key: 's', indicatorId: 'self' }] }),
    ])
    expect(() => resolveIndicatorTree({ indicatorId: 'self', params: {} }, registry)).toThrow(
      /cycle/
    )
  })

  it('allows two branches to use the same indicator', () => {
    // A diamond is not a cycle: the guard is per *path*, and forbidding this would
    // rule out the ordinary case of a composite using ATR twice at two lengths.
    const log: string[] = []
    const registry = createIndicatorRegistry([
      recorder('leaf', { log }),
      recorder('mid', { log, requires: [{ key: 'l', indicatorId: 'leaf' }] }),
      recorder('root', {
        log,
        requires: [
          { key: 'm', indicatorId: 'mid' },
          { key: 'l', indicatorId: 'leaf' },
        ],
      }),
    ])
    expect(() =>
      resolveIndicatorTree({ indicatorId: 'root', params: {} }, registry)
    ).not.toThrow()
  })

  it('refuses a chain deeper than the limit', () => {
    const log: string[] = []
    const chain = Array.from({ length: MAX_INDICATOR_DEPTH + 2 }, (_unused, index) =>
      recorder(
        `n${index}`,
        index === MAX_INDICATOR_DEPTH + 1
          ? { log }
          : { log, requires: [{ key: 'next', indicatorId: `n${index + 1}` }] }
      )
    )
    const registry = createIndicatorRegistry(chain)
    expect(() => resolveIndicatorTree({ indicatorId: 'n0', params: {} }, registry)).toThrow(
      /nest more than 8 deep/
    )
  })

  it('names the requiring chain when a dependency is missing', () => {
    const log: string[] = []
    const registry = createIndicatorRegistry([
      recorder('root', { log, requires: [{ key: 'gone', indicatorId: 'gone' }] }),
    ])
    expect(() => resolveIndicatorTree({ indicatorId: 'root', params: {} }, registry)).toThrow(
      /"gone".*required by root/
    )
  })

  it('resolves every built-in indicator', () => {
    // The one check that matters for shipped plugins: a composite whose dependency was
    // renamed would otherwise throw at run start, after the player pressed Start.
    const registry = createIndicatorRegistry()
    for (const plugin of builtinIndicators) {
      expect(() =>
        resolveIndicatorTree({ indicatorId: plugin.id, params: {} }, registry)
      ).not.toThrow()
    }
  })
})

describe('warmupBarsFor', () => {
  it('adds the root\'s own requirement to its deepest branch', () => {
    // The maximum, not the sum, across branches: the tree is fed one bar at a time in
    // parallel, so every branch warms simultaneously. GBAP asks for 2 of its own on top
    // of a breakout window of 20 and an ATR of 7 — so 22, not 29.
    const registry = createIndicatorRegistry()
    const warmup = warmupBarsFor(
      {
        indicatorId: 'gapup-breakout-atr-pullback',
        params: { breakoutLength: 20, atrLength: 7 },
      },
      registry
    )
    expect(warmup).toBe(22)
  })

  it('follows the params it is given, not the defaults', () => {
    const registry = createIndicatorRegistry()
    expect(warmupBarsFor({ indicatorId: 'sma', params: { length: 200 } }, registry)).toBe(200)
    expect(warmupBarsFor({ indicatorId: 'sma', params: {} }, registry)).toBe(20)
  })

  it('counts ATR as its window plus the seeding bar', () => {
    // The first bar's true range has no previous close to reach back to, so a 14-bar ATR
    // is usable from bar 15 rather than bar 14.
    const registry = createIndicatorRegistry()
    expect(warmupBarsFor({ indicatorId: 'atr', params: { length: 14 } }, registry)).toBe(15)
  })

  it('reports nothing for a plugin that declares nothing', () => {
    const log: string[] = []
    const registry = createIndicatorRegistry([recorder('quiet', { log })])
    expect(warmupBarsFor({ indicatorId: 'quiet', params: {} }, registry)).toBe(0)
  })

  it('returns what it measured instead of throwing on a broken tree', () => {
    // Deliberately tolerant where `resolveIndicatorTree` is strict: this decides a
    // preload count, and a broken dependency should stop the run from the place that owns
    // that error, not from a setting nobody was thinking about.
    const log: string[] = []
    const cyclic = createIndicatorRegistry([
      recorder('a', { log, requires: [{ key: 'b', indicatorId: 'b' }] }),
      recorder('b', { log, requires: [{ key: 'a', indicatorId: 'a' }] }),
    ])
    expect(() => warmupBarsFor({ indicatorId: 'a', params: {} }, cyclic)).not.toThrow()
    expect(warmupBarsFor({ indicatorId: 'missing', params: {} }, cyclic)).toBe(0)
  })

  it('ignores a nonsense number rather than poisoning the total', () => {
    // This feeds a bar count. NaN would preload the whole series; a negative would move
    // the cursor backwards.
    const registry = createIndicatorRegistry([
      {
        id: 'broken',
        displayName: 'Broken',
        paneKind: 'overlay',
        outputs: ['x'],
        params: [],
        warmupBars: () => Number.NaN,
        createInstance: () => ({ reset() {}, onBar: () => ({ x: 1 }) }),
      },
      {
        id: 'negative',
        displayName: 'Negative',
        paneKind: 'overlay',
        outputs: ['x'],
        params: [],
        warmupBars: () => -50,
        createInstance: () => ({ reset() {}, onBar: () => ({ x: 1 }) }),
      },
    ])
    expect(warmupBarsFor({ indicatorId: 'broken', params: {} }, registry)).toBe(0)
    expect(warmupBarsFor({ indicatorId: 'negative', params: {} }, registry)).toBe(0)
  })
})

describe('price breakout', () => {
  const feed = (closes: number[], length: number): { level: number; signal: number }[] => {
    const instance = breakoutIndicator.createInstance({ length })
    return closes.map((close) => {
      const values = instance.onBar(bar({ c: close }), false, {})
      return { level: values.level as number, signal: values.signal as number }
    })
  }

  it('says nothing until the window is full', () => {
    // Not cosmetic: without it, bar one is trivially the highest close so far and every
    // early bar would mark a breakout.
    const out = feed([10, 11, 12], 3)
    expect(out[0]?.level).toBeNaN()
    expect(out[0]?.signal).toBeNaN()
    expect(out[1]?.level).toBeNaN()
    expect(out[2]?.level).toBe(12)
  })

  it('holds the window high and marks the bar that sets a new one', () => {
    const out = feed([10, 11, 12, 11, 9, 13], 3)
    expect(out[2]).toEqual({ level: 12, signal: 12 })
    expect(out[3]?.level).toBe(12)
    expect(out[3]?.signal).toBeNaN()
    expect(out[5]).toEqual({ level: 13, signal: 13 })
  })

  it('lets the level fall once the high scrolls out of the window', () => {
    // The whole point of a rolling window: an old high stops being resistance.
    const out = feed([50, 10, 11, 12], 3)
    expect(out[2]?.level).toBe(50)
    expect(out[3]?.level).toBe(12)
  })

  it('marks a bar that only ties the window high', () => {
    const out = feed([10, 12, 11, 12], 3)
    expect(out[3]?.signal).toBe(12)
  })

  it('re-warms after a reset', () => {
    const instance = breakoutIndicator.createInstance({ length: 2 })
    instance.onBar(bar({ c: 10 }), false, {})
    instance.onBar(bar({ c: 20 }), false, {})
    instance.reset()
    expect(instance.onBar(bar({ c: 99 }), false, {}).level).toBeNaN()
  })
})

describe('gap-up breakout ATR pullback', () => {
  const params = {
    breakoutLength: 3,
    gapupPercent: 4,
    atrLength: 7,
    atrFactor: 2,
    atrTolerancePercent: 5,
  }

  const withAtr = (atr: number, signal = Number.NaN): IndicatorValues => ({
    atr: { atr },
    breakout: { signal },
  })

  it('says nothing while its ATR is still warming up', () => {
    // The rule that makes composition safe: an entry taken on a NaN ATR would pin the
    // retrace level at NaN for the rest of the run.
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(bar({ c: 100, t: 0 }), false, withAtr(Number.NaN))
    const out = instance.onBar(bar({ c: 110, t: DAY }), false, withAtr(Number.NaN, 110))
    for (const value of Object.values(out)) expect(value).toBeNaN()
  })

  it('enters on a breakout, and draws no level on the entry bar itself', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(bar({ c: 100, t: 0 }), false, withAtr(1))
    const entry = instance.onBar(bar({ c: 102, h: 103, l: 102, t: DAY }), false, withAtr(1, 102))

    expect(entry.breakout).toBe(103)
    // A bar cannot both open and close a signal, or one wide bar would produce a whole
    // trade nobody could have acted on.
    expect(entry.retrace).toBeNaN()
    expect(entry.stop).toBeNaN()
  })

  it('ratchets the retrace level upward and keeps the stop one ATR below it', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(bar({ c: 100, t: 0 }), false, withAtr(1))
    instance.onBar(bar({ c: 102, h: 103, l: 102, t: DAY }), false, withAtr(1, 102))

    // Entry set the level at 102 - 2 = 100. This bar's candidate is 101 - 2 = 99, and
    // a ratchet never gives ground.
    const held = instance.onBar(bar({ c: 101, h: 101, l: 101, t: 2 * DAY }), false, withAtr(1))
    expect(held.retrace).toBeCloseTo(100, 9)
    expect(held.stop).toBeCloseTo(99, 9)

    // 105 - 2 = 103 is higher, so the level follows price up.
    const risen = instance.onBar(bar({ c: 105, h: 105, l: 104, t: 3 * DAY }), false, withAtr(1))
    expect(risen.retrace).toBeCloseTo(103, 9)
    expect(risen.stop).toBeCloseTo(102, 9)
  })

  it('marks the bar whose low first reaches the tolerated level, and only that bar', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(bar({ c: 100, t: 0 }), false, withAtr(1))
    // Entry at 102 with ATR 1 → level 100, tolerated 100 + 5% of 1 = 100.05.
    instance.onBar(bar({ c: 102, h: 103, l: 102, t: DAY }), false, withAtr(1, 102))

    const first = instance.onBar(bar({ c: 101, h: 102, l: 100, t: 2 * DAY }), false, withAtr(1))
    expect(first.retraceHit).toBeCloseTo(100.05, 9)

    // Still sitting on the level: the mark is the *crossing*, so a slow drift along it
    // marks once rather than on every bar.
    const second = instance.onBar(bar({ c: 101, h: 102, l: 100, t: 3 * DAY }), false, withAtr(1))
    expect(second.retraceHit).toBeNaN()
  })

  it('closes the signal when a bar closes through the retrace level', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(bar({ c: 100, t: 0 }), false, withAtr(1))
    instance.onBar(bar({ c: 102, h: 103, l: 102, t: DAY }), false, withAtr(1, 102))
    instance.onBar(bar({ c: 99, h: 102, l: 99, t: 2 * DAY }), false, withAtr(1))

    // Out of the trade: no level on the following bar, absent a new signal.
    const after = instance.onBar(bar({ c: 99, h: 100, l: 98, t: 3 * DAY }), false, withAtr(1))
    expect(after.retrace).toBeNaN()
    expect(after.stop).toBeNaN()
  })

  it('reads a gap across an overnight break', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(bar({ c: 100, t: 0 }), false, withAtr(1))
    const out = instance.onBar(bar({ c: 110, h: 112, l: 109, t: DAY }), false, withAtr(1))
    expect(out.gapup).toBe(112)
  })

  it('does not read a gap between two bars of the same session', () => {
    // A 10% move over five minutes is a move, not a gap — there was no break for one
    // to form in.
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(bar({ c: 100, t: 0 }), false, withAtr(1))
    const out = instance.onBar(bar({ c: 110, h: 112, l: 109, t: 300 }), false, withAtr(1))
    expect(out.gapup).toBeNaN()
  })

  it('does not read a weekly period return as a gap', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(bar({ c: 100, t: 0 }), false, withAtr(1))
    const out = instance.onBar(bar({ c: 110, h: 112, l: 109, t: 7 * DAY }), false, withAtr(1))
    expect(out.gapup).toBeNaN()
  })

  it('marks a gap even while its own trade is open', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(bar({ c: 100, t: 0 }), false, withAtr(1))
    instance.onBar(bar({ c: 102, h: 103, l: 102, t: DAY }), false, withAtr(1, 102))
    const out = instance.onBar(bar({ c: 120, h: 121, l: 119, t: 2 * DAY }), false, withAtr(1))
    expect(out.gapup).toBe(121)
    // And the trade carries on rather than restarting.
    expect(out.retrace).toBeCloseTo(118, 9)
  })
})

describe('the composite through the displayed-indicator feed', () => {
  it('draws its own outputs and none of its dependencies', () => {
    const feed = createIndicatorFeed({
      active: [
        {
          instanceId: 'gbap-1',
          typeId: 'gapup-breakout-atr-pullback',
          params: { breakoutLength: 3, atrLength: 3 },
        },
      ],
      registry: createIndicatorRegistry(),
    })

    for (let index = 0; index < 8; index++) {
      feed.observeBar(bar({ c: 100 + index, h: 101 + index, l: 99 + index, t: index * DAY }), false)
    }

    const series = feed.series[0]
    // Five outputs, not seven: a composite's inputs are its own business, and drawing
    // ATR on the price scale would put a line near zero under the bars.
    expect(series?.outputs).toEqual(['breakout', 'gapup', 'retrace', 'stop', 'retraceHit'])
    expect(Object.keys(series?.history ?? {})).toHaveLength(5)
    expect(series?.history.retrace).toHaveLength(8)
    // Rising closes with a 3-bar window: it broke out and is holding a level.
    expect(series?.history.retrace?.some((value) => Number.isFinite(value))).toBe(true)
  })

  it('resolves the plugin\'s per-output styles into the series', () => {
    const feed = createIndicatorFeed({
      active: [{ instanceId: 'gbap-1', typeId: 'gapup-breakout-atr-pullback', params: {} }],
      registry: createIndicatorRegistry(),
    })
    const styles = feed.series[0]?.styles
    expect(styles?.breakout?.draw).toBe('dots')
    expect(styles?.retrace?.draw).toBe('dash')
    expect(styles?.stop?.draw).toBe('dots')
    // Left without a colour, so the instance's own applies — which is what keeps the
    // player's choice meaningful on a five-output indicator.
    expect(styles?.retrace?.colour).toBeUndefined()
    expect(styles?.stop?.colour).toBeUndefined()
    expect(styles?.breakout?.colour).toBeTypeOf('number')
    // A mark that flags a bar lifts clear of the candle; one that names a price doesn't.
    expect(styles?.breakout?.offsetPx).toBeTypeOf('number')
    expect(styles?.retraceHit?.offsetPx).toBeUndefined()
  })

  it('layers the player\'s overrides over the plugin\'s defaults', () => {
    const feed = createIndicatorFeed({
      active: [
        {
          instanceId: 'gbap-1',
          typeId: 'gapup-breakout-atr-pullback',
          params: {},
          colour: 0x112233,
          outputs: { breakout: { draw: 'none' }, retrace: { colour: 0xabcdef } },
        },
      ],
      registry: createIndicatorRegistry(),
    })
    const styles = feed.series[0]?.styles
    expect(styles?.breakout?.draw).toBe('none')
    // Overriding the style leaves the plugin's colour alone, and vice versa: the two
    // are separate overrides, so changing one can't quietly reset the other.
    expect(styles?.breakout?.colour).toBe(0x4fd6c8)
    expect(styles?.retrace?.colour).toBe(0xabcdef)
    expect(styles?.retrace?.draw).toBe('dash')
    // Untouched outputs keep the plugin's defaults rather than being frozen at whatever
    // they were when the override was stored.
    expect(styles?.stop?.draw).toBe('dots')
  })

  it('labels itself with two params rather than five', () => {
    const feed = createIndicatorFeed({
      active: [
        {
          instanceId: 'gbap-1',
          typeId: 'gapup-breakout-atr-pullback',
          params: { breakoutLength: 20, gapupPercent: 4, atrLength: 7, atrFactor: 2 },
        },
      ],
      registry: createIndicatorRegistry(),
    })
    expect(feed.series[0]?.displayName).toBe('GBAP 20 2')
  })
})

describe('pullback-stop', () => {
  const host = () =>
    createStopHost({
      active: [
        {
          typeId: 'pullback-stop',
          params: { breakoutLength: 3, atrLength: 3, atrFactor: 2, atrTolerancePercent: 5 },
          advisory: false,
        },
      ],
      registry: createStopRegistry(),
      indicators: createIndicatorRegistry(),
    })

  it('resolves a stop whose dependency is itself a composite', () => {
    // The deepest chain shipped: stop → composite → { breakout, ATR }. If resolution
    // only went one level, this would throw here.
    expect(() => host()).not.toThrow()
  })

  it('offers no level until the signal has a trade of its own', () => {
    const engine = host()
    engine.onEntry()
    engine.observeBar(bar({ c: 100, t: 0 }))
    engine.computeLevels(bar({ c: 100, t: 0 }), long())
    expect(engine.levels).toHaveLength(0)
  })

  it('reports the level the signal computed, once it has one', () => {
    const engine = host()
    engine.onEntry()
    // Rising closes so the 3-bar breakout fires, then a bar that holds the level.
    const closes = [100, 101, 102, 103, 104, 105]
    closes.forEach((close, index) => {
      const current = bar({ c: close, h: close + 1, l: close - 1, t: index * DAY })
      engine.observeBar(current)
      engine.computeLevels(current, long())
    })
    const level = engine.levels[0]?.level
    expect(level).toBeDefined()
    // One ATR below the retrace level, and below the close it was measured from.
    expect(level as number).toBeLessThan(105)
  })

  it('offers no level to a short position', () => {
    const engine = host()
    engine.onEntry()
    const closes = [100, 101, 102, 103, 104, 105]
    closes.forEach((close, index) => {
      const current = bar({ c: close, h: close + 1, l: close - 1, t: index * DAY })
      engine.observeBar(current)
      engine.computeLevels(current, long({ size: -10 }))
    })
    // The level sits below price by construction, so handing it to a short would place
    // the stop on the profitable side and fire it immediately.
    expect(engine.levels).toHaveLength(0)
  })

  it('keeps its indicators warm across trades', () => {
    const engine = host()
    engine.onEntry()
    const closes = [100, 101, 102, 103, 104, 105]
    closes.forEach((close, index) => {
      const current = bar({ c: close, h: close + 1, l: close - 1, t: index * DAY })
      engine.observeBar(current)
      engine.computeLevels(current, long())
    })
    const before = engine.levels[0]?.level

    // A new entry resets the stop, deliberately not its indicators — otherwise the
    // signal's own trade state would restart and there would be no level until the
    // next breakout.
    engine.onEntry()
    const next = bar({ c: 106, h: 107, l: 105, t: 6 * DAY })
    engine.observeBar(next)
    engine.computeLevels(next, long())
    expect(engine.levels[0]?.level).toBeGreaterThanOrEqual(before as number)
  })
})
