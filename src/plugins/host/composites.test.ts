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
  /**
   * The breakout scan's settings with the tolerance and the retrace-depth trail off, so
   * the arithmetic below is the plain one: one ATR of risk, a two-ATR trail armed at two
   * R. `RetraceLeg`'s own facts (retraceLeg.test.ts) cover the lifecycle exhaustively;
   * these cover the wiring — the ATR, the gap, and what each output says.
   */
  const params = {
    breakoutLength: 3,
    gapupPercent: 10,
    atrLength: 3,
    atrFactor: 2,
    atrTolerancePercent: 0,
    stopFactor: 1,
    trailFactor: 2,
    activationR: 2,
    tightenStopWithAtr: 0,
    trailAtRetraceDepth: 0,
  }

  const signal = (value: number): IndicatorValues => ({ breakout: { signal: value } })
  const quiet: IndicatorValues = { breakout: { signal: Number.NaN } }

  /** A bar one point either side of its close, on consecutive days. */
  const day = (index: number, c: number, h = c + 1, l = c - 1) =>
    bar({ c, h, l, t: index * DAY })

  /**
   * Armed on bar 1, entered on bar 2, with the ATR worked by hand:
   *
   *   true ranges   2, 2, 5, 5, 3   (bar 0 has no previous close, so high − low)
   *   ATR(3)        –, 2, 3, 4, 4.33   (an average of what exists until the window fills)
   *
   * Bar 1 arms at 101 − 2×2 = 97. Bar 2's low of 96 crosses it, so the entry is 97 and
   * the stop is one *entry-bar* ATR (3) beyond it: 94.
   */
  const entered = () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    const outs = [
      instance.onBar(day(0, 100), false, quiet),
      instance.onBar(day(1, 101, 102, 100), false, signal(101)),
      instance.onBar(day(2, 99, 100, 96), false, quiet),
    ]
    return { instance, outs }
  }

  it('says nothing on its first bar', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    const out = instance.onBar(day(0, 100), false, signal(100))
    for (const value of Object.values(out)) expect(value).toBeNaN()
  })

  it('arms on a breakout, drawing the entry level and no stop yet', () => {
    const { outs } = entered()
    const armed = outs[1] as Record<string, number>

    // Marked at the high, where the cycle began.
    expect(armed.breakout).toBe(102)
    // 101 − 2×2: the level a pullback has to reach. No position, so no stop.
    expect(armed.retrace).toBe(97)
    expect(armed.stop).toBeNaN()
    expect(armed.retraceHit).toBeNaN()
  })

  it('enters when the low crosses the level, with the stop one ATR beyond it', () => {
    const { outs } = entered()
    const entry = outs[2] as Record<string, number>

    // The entry is booked at the level, not at the low that crossed it.
    expect(entry.retraceHit).toBe(97)
    // The signal bar still carries its trigger, so the entry has a price on the chart.
    expect(entry.retrace).toBe(97)
    // The ATR on the entry bar is 3 — (2 + 2 + 5) / 3 — so 97 − 3. A Wilder-smoothed ATR
    // would give a different number for the same bars, which is the point of computing
    // it here.
    expect(entry.stop).toBe(94)
  })

  it('stops drawing the trigger once the trade is on, and holds the stop', () => {
    const { instance } = entered()

    // Close 95 holds above the stop at 94; the low of 94 only touches it.
    const held = instance.onBar(day(3, 95, 96, 94), false, quiet)
    expect(held.retrace).toBeNaN()
    expect(held.stop).toBe(94)
    // A pullback to the stop that holds is a second chance at the entry, marked at the
    // stop it touched.
    expect(held.retraceHit).toBe(94)
  })

  it('ends the trade on a close through the stop, and then says nothing', () => {
    const { instance } = entered()
    instance.onBar(day(3, 95, 96, 94), false, quiet)

    // The close is what exits, so a bar that wicks through but closes back above does not.
    const out = instance.onBar(day(4, 93, 95, 92), false, quiet)
    expect(out.stop).toBeNaN()
    expect(out.retrace).toBeNaN()
    expect(out.retraceHit).toBeNaN()

    // And it needs a fresh breakout: nothing re-enters on the way down.
    const after = instance.onBar(day(5, 90, 91, 85), false, quiet)
    expect(after.stop).toBeNaN()
    expect(after.retrace).toBeNaN()
  })

  it('averages true range rather than smoothing it', () => {
    // True ranges 2, 2, 6, 2, 2. A simple average of the last three is 3.33; Wilder's
    // smoothing of the same bars is 2.59. The level is 2 ATR below the close, so the two
    // disagree by more than a point and a half.
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(day(0, 100), false, quiet)
    instance.onBar(day(1, 100), false, quiet)
    instance.onBar(day(2, 100, 103, 97), false, quiet)
    instance.onBar(day(3, 100), false, quiet)
    const armed = instance.onBar(day(4, 100), false, signal(100))

    expect(armed.retrace).toBeCloseTo(100 - 2 * (10 / 3), 9)
  })

  it('marks a breakout only where a cycle starts', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(day(0, 100), false, quiet)
    const first = instance.onBar(day(1, 101), false, signal(101))
    // A second breakout while the cycle is already running is not the start of one.
    const second = instance.onBar(day(2, 102), false, signal(102))

    expect(first.breakout).toBe(102)
    expect(second.breakout).toBeNaN()
  })

  it('reads a close-to-close jump across an overnight break as a gap, and arms on it', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(day(0, 100), false, quiet)
    const out = instance.onBar(day(1, 115, 117, 114), false, quiet)

    expect(out.gapup).toBe(117)
    // A gap arms the leg like a breakout, though it is not itself marked as one.
    expect(out.breakout).toBeNaN()
    expect(out.retrace).toBeDefined()
    expect(Number.isFinite(out.retrace)).toBe(true)
  })

  it('reads the move between two intraday bars as a gap too', () => {
    // The original gates on the bar being daily or shorter, not on there having been a
    // session break, so a 10% close-to-close move five minutes apart counts.
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(bar({ c: 100, h: 101, l: 99, t: 0 }), false, quiet)
    const out = instance.onBar(bar({ c: 115, h: 117, l: 114, t: 300 }), false, quiet)
    expect(out.gapup).toBe(117)
  })

  it('does not read a weekly period return as a gap', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(day(0, 100), false, quiet)
    const out = instance.onBar(bar({ c: 115, h: 117, l: 114, t: 7 * DAY }), false, quiet)
    expect(out.gapup).toBeNaN()
  })

  it('does not read a move below the threshold as a gap', () => {
    const instance = gapupBreakoutAtrPullbackIndicator.createInstance(params)
    instance.onBar(day(0, 100), false, quiet)
    const out = instance.onBar(day(1, 109, 110, 108), false, quiet)
    expect(out.gapup).toBeNaN()
  })

  it('marks a gap even while its own trade is open, and the trade carries on', () => {
    const { instance } = entered()
    const out = instance.onBar(day(3, 130, 131, 129), false, quiet)

    expect(out.gapup).toBe(131)
    // Entered at 97 with an entry ATR of 3, so +2R is 103 and 130 arms the trail:
    // 130 − 2×3 = 124. The trade was not restarted by the gap.
    expect(out.stop).toBe(124)
  })

  it('forgets everything on reset', () => {
    const { instance } = entered()
    instance.reset()

    // Back to a first bar: nothing to compare with, so nothing to say.
    const out = instance.onBar(day(0, 100), false, signal(100))
    for (const value of Object.values(out)) expect(value).toBeNaN()

    // And the next bar behaves as a second bar would, from a clean ATR.
    const armed = instance.onBar(day(1, 101, 102, 100), false, signal(101))
    expect(armed.retrace).toBe(97)
  })

  it('declares exactly what it preloads: the larger of the two windows', () => {
    const registry = createIndicatorRegistry()
    // ATR(100) outlasts a 20-bar breakout window, so it sets the preload; 100 + the
    // seeding bar.
    expect(
      warmupBarsFor(
        {
          indicatorId: 'gapup-breakout-atr-pullback',
          params: { breakoutLength: 20, atrLength: 100 },
        },
        registry
      )
    ).toBe(101)
  })

  it('runs on the breakout scan’s settings by default', () => {
    const defaults = Object.fromEntries(
      gapupBreakoutAtrPullbackIndicator.params.map((spec) => [spec.key, spec.default])
    )
    expect(defaults).toEqual({
      breakoutLength: 20,
      gapupPercent: 10,
      atrLength: 7,
      atrFactor: 2,
      atrTolerancePercent: 20,
      stopFactor: 1,
      trailFactor: 2,
      activationR: 2,
      tightenStopWithAtr: 0,
      trailAtRetraceDepth: 1,
    })
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
          advisory: false,
        },
      ],
      registry: createStopRegistry(),
      indicators: createIndicatorRegistry(),
    })

  /**
   * Bars 0–2 close 100, 101, 102 with a point either side: the three-bar window fills on
   * bar 2, which breaks out and arms the leg at 102 − 2×2 = 98. Bar 3's low of 97 crosses
   * it from a prior low of 101, so the leg enters at 98 on an ATR of 3 — (2 + 2 + 5) / 3 —
   * with its stop at 95. Bar 4 holds above it.
   */
  const bars = [
    bar({ c: 100, h: 101, l: 99, t: 0 }),
    bar({ c: 101, h: 102, l: 100, t: DAY }),
    bar({ c: 102, h: 103, l: 101, t: 2 * DAY }),
    bar({ c: 100, h: 101, l: 97, t: 3 * DAY }),
    bar({ c: 101, h: 102, l: 99, t: 4 * DAY }),
  ]

  const feed = (engine: ReturnType<typeof host>, upTo: number, position = long()) => {
    for (const current of bars.slice(0, upTo)) {
      engine.observeBar(current)
      engine.computeLevels(current, position)
    }
  }

  it('resolves a stop whose dependency is itself a composite', () => {
    // The deepest chain shipped: stop → composite → breakout. If resolution only went
    // one level, this would throw here.
    expect(() => host()).not.toThrow()
  })

  it('offers no level until the signal has a trade of its own', () => {
    const engine = host()
    engine.onEntry()
    feed(engine, 3)
    // Armed and waiting for a pullback: the leg has no position, so it has no stop.
    expect(engine.levels).toHaveLength(0)
  })

  it('reports the leg’s stop once it has entered', () => {
    const engine = host()
    engine.onEntry()
    feed(engine, 4)

    // The leg entered at 98 and risks one entry-bar ATR beyond it.
    expect(engine.levels).toHaveLength(1)
    expect(engine.levels[0]?.level).toBe(95)
    expect(engine.levels[0]?.advisory).toBe(false)
  })

  it('closes the position on a close at or through that level, on the next bar', () => {
    const engine = host()
    engine.onEntry()
    feed(engine, 5)
    expect(engine.levels[0]?.level).toBe(95)

    // Enforced against the *next* bar's close, as the leg itself would test it. A wick
    // through the level that closes back above it does not exit; a close on it does.
    expect(engine.evaluate(95.01, long()).triggered).toBeNull()
    expect(engine.evaluate(95, long()).triggered?.level).toBe(95)
    expect(engine.evaluate(90, long()).triggered?.stopId).toBe('pullback-stop')
  })

  it('offers no level to a short position', () => {
    const engine = host()
    engine.onEntry()
    // The level sits below price by construction, so handing it to a short would place
    // the stop on the profitable side and fire it immediately.
    feed(engine, 5, long({ size: -10 }))
    expect(engine.levels).toHaveLength(0)
  })

  it('keeps its indicators warm across trades', () => {
    const engine = host()
    engine.onEntry()
    feed(engine, 5)
    const before = engine.levels[0]?.level

    // A new entry resets the stop, deliberately not its indicators — otherwise the
    // signal's own trade state would restart and there would be no level until the next
    // breakout.
    engine.onEntry()
    expect(engine.levels).toHaveLength(0)
    const next = bar({ c: 102, h: 103, l: 100, t: 5 * DAY })
    engine.observeBar(next)
    engine.computeLevels(next, long())
    expect(engine.levels[0]?.level).toBe(before)
  })
})
