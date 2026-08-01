import type { RunConfig } from '@config/index.js'
import type { IndicatorDrawStyle, OhlcvBar } from '@shared/contracts/index.js'
import type {
  ChartFrame,
  FrameState,
  OverlayLine,
  StopLine,
  SubPane,
} from '../output/frameState.js'
import type { PositionEvent } from '../output/events.js'
import {
  buyingPower,
  directionOf,
  flatPosition,
  isFlat,
  percentReturn,
  totalPnl,
  unrealizedPnl,
} from '../position/position.js'
import { DEFAULT_INDICATOR_COLOUR } from '@shared/palette/index.js'
import { createInputBuffer } from '../pipeline/inputBuffer.js'
import type { TradeAction } from '../pipeline/inputBuffer.js'
import { tickBar } from '../pipeline/tick.js'
import type { TickState } from '../pipeline/tick.js'
import { emptyStats, summarize } from '../scoring/stats.js'
import type { Summary } from '../scoring/stats.js'
import { initialStreak } from '../scoring/streak.js'
import type { StopEngine } from '../stops/port.js'
import { createNoStops } from '../stops/port.js'
import { createNoIndicators } from '../indicators/feed.js'
import { steppedSpeed } from './speed.js'
import type { SpeedDirection } from './speed.js'
import type { IndicatorFeed, IndicatorSeries } from '../indicators/feed.js'
import { createPlayback } from './playback.js'
import type { Playback } from './playback.js'

/**
 * The run: playback, the tick pipeline, and input, composed into one object that
 * emits a `FrameState` per frame.
 *
 * Steps 1 and 8 of the tick pipeline (growth completes, advance) belong to
 * playback; steps 2–7 to `tickBar`. This is where they meet, and where the two
 * rules needing a whole-run view live: the one-bar stopped-out transient, and
 * clearing buffered input on pause.
 */

export interface RunController {
  advance(dt: number): FrameState
  readonly frame: FrameState
  /** Enqueue a press. Dropped rather than queued while input is blocked. */
  press(action: TradeAction): void
  /** True during the stopped-out transient and while paused. */
  isInputBlocked(): boolean
  pause(): void
  resume(): void
  readonly isPaused: boolean
  /**
   * Step the scroll speed one rung up or down, and report the speed now in force.
   *
   * Mid-run and deliberately: reaction time is the lever a player reaches for when a run
   * gets away from them, and making them open the settings screen to find it means
   * abandoning the run. It is **not** part of the run fingerprint — see the note in
   * `config/fingerprint.ts` — so using it costs nothing on the record.
   *
   * Ignored while paused. Retiming a frozen run would take effect invisibly on resume,
   * and the pause screen has nothing that would show it.
   */
  changeSpeed(direction: SpeedDirection): number
  /** "End run" from the pause menu: force-close at the current bar and record. */
  endRun(): void
  readonly summary: Summary
  readonly state: TickState
}

export interface RunControllerOptions {
  bars: readonly OhlcvBar[]
  config: RunConfig
  visibleBarCount: number
  /** Defaults to the no-stops implementation; the plugin host supplies a real one. */
  stops?: StopEngine
  /** Displayed indicators. Separate instances from anything a stop owns. */
  indicators?: IndicatorFeed
  /**
   * Bars consumed before play starts, resolved from `config.preloadBars` by the caller
   * — `'auto'` is already a number by the time it reaches here.
   *
   * Fed to the indicator feed and to the stop engine, and to **nothing else**: the
   * trading tick never sees them, so no position opens, no trade is scored, and the
   * streak is untouched. All they do is move the starting cursor and leave the
   * indicators warm when the player arrives.
   */
  preloadBars?: number
  /** Volume gets a permanently-available pane using the same mechanism. */
  showVolume?: boolean
  /** Concurrent sub-panes are capped: 3 on desktop, 1 on mobile. */
  maxSubPanes?: number
}

export function createRunController({
  bars,
  config,
  visibleBarCount,
  stops = createNoStops(),
  indicators = createNoIndicators(),
  preloadBars = 0,
  showVolume = false,
  maxSubPanes = 3,
}: RunControllerOptions): RunController {
  /**
   * Clamped so at least one bar remains playable, whatever the caller asked for.
   *
   * Pre-run validation refuses a preload that would leave a run too short to be worth
   * playing, and `'auto'` is clamped by the caller before it gets here — this is the
   * backstop that keeps the invariant local rather than borrowed.
   */
  const startIndex = Math.min(
    Math.max(0, Math.floor(preloadBars)),
    Math.max(0, bars.length - 1)
  )
  const playback: Playback = createPlayback({ bars, config, visibleBarCount, startIndex })
  const buffer = createInputBuffer()
  stops.reset()
  indicators.reset()

  /**
   * Warm the indicators over the preloaded bars, before the first frame exists.
   *
   * Both feeds, deliberately: a chart line that appears immediately while the ATR stop
   * behind it is still NaN would be the worse half of the feature, since that's the one
   * where a cold indicator costs the player protection rather than a picture.
   *
   * `runTick` is *not* called, which is the whole point — these bars produce no fills,
   * no realized P&L, and no streak movement. `isLastBar` is false throughout: the last
   * preloaded bar is not the last bar of anything, and telling an indicator otherwise
   * would let it emit a final value it should keep to itself.
   */
  for (let index = 0; index < startIndex; index++) {
    const bar = bars[index]
    if (!bar) continue
    indicators.observeBar(bar, false)
    stops.observeBar(bar)
  }

  let state: TickState = {
    position: flatPosition(),
    stats: emptyStats(),
    streak: initialStreak({
      config,
      hasAdvisoryRule: stops.hasAdvisoryRule,
      hasAnyRule: stops.hasAnyRule,
    }),
    inBreach: false,
    barsHeld: 0,
  }

  /** Events from the bar that just closed, surfaced for the frames after it. */
  let lastEvents: readonly PositionEvent[] = []
  /**
   * The stopped-out transient lasts exactly one bar — long enough to read the
   * feedback, short enough not to feel like a lockout. Presses during it are
   * dropped rather than queued, so a panicked double-tap doesn't immediately
   * re-enter a position the player was just stopped out of.
   */
  let blockedThroughIndex = -1

  const runTick = (bar: OhlcvBar, index: number, forceClose?: 'end-of-data' | 'ended-early') => {
    const result = tickBar(
      state,
      { bar, index, actions: buffer.drain(), forceClose },
      { config, stops }
    )
    state = result.state
    lastEvents = result.events
    if (result.events.some((event) => event.kind === 'stoppedOut')) {
      blockedThroughIndex = index + 1
    }
  }

  playback.onBarClosed((bar, index) => {
    // Displayed indicators are fed by the same per-bar mechanism, in the same order,
    // so a stop's values and the chart's values can never disagree about bar N.
    indicators.observeBar(bar, index >= bars.length - 1)
    runTick(bar, index, index >= bars.length - 1 ? 'end-of-data' : undefined)
  })

  function stopLines(): readonly StopLine[] {
    if (isFlat(state.position)) return []
    return stops.levels.map((level) => ({
      stopId: level.stopId,
      level: level.level,
      unit: playback.unitOf(level.level),
      advisory: level.advisory,
      breached: level.advisory && state.inBreach,
    }))
  }

  /** The slice of history matching the bars currently on screen. */
  function windowOf(values: readonly number[], chart: ChartFrame): (number | null)[] {
    const first = chart.bars[0]?.index ?? 0
    const last = chart.currentIndex
    const out: (number | null)[] = []
    for (let index = first; index <= last; index++) {
      const value = values[index]
      // NaN means "warming up" — the renderer skips it rather than drawing to zero.
      out.push(value === undefined || !Number.isFinite(value) ? null : value)
    }
    return out
  }

  /**
   * How one output is drawn, with the instance's colour filled in.
   *
   * The host has already layered the player's overrides onto the plugin's defaults;
   * what's left is the one substitution only this side can make — an output with no
   * colour of its own takes the instance's. `null` means the player set it to `none`,
   * and the caller drops the output entirely rather than drawing an invisible line and
   * listing it in the legend.
   */
  function styleOf(
    series: IndicatorSeries,
    output: string
  ): { colour: number; draw: Exclude<IndicatorDrawStyle, 'none'>; offsetPx?: number } | null {
    const style = series.styles?.[output]
    if (style?.draw === 'none') return null
    return {
      colour: style?.colour ?? series.colour,
      draw: style?.draw ?? 'line',
      offsetPx: style?.offsetPx,
    }
  }

  /**
   * Overlay values as unit heights, with everything off the chart taken out.
   *
   * The chart's bounds come from the visible **bars**, so an overlay is free to sit
   * outside them — a 50-bar average in a strong run is below the window's low for as long
   * as the run keeps going. Passing those through the clamped conversion pinned them to
   * exactly 0, which drew a flat line along the chart floor: a line asserting a price it
   * never had, on top of the ground line, reading as a rendering fault rather than as
   * data.
   *
   * Two different answers, because the two kinds of output mean different things:
   *
   * - A **mark** off the chart is dropped outright. Its whole content is *this bar, this
   *   price*, and a dot held at the edge names a price that isn't its own.
   * - A **line** drops its off-chart run but keeps the point where it crosses the edge,
   *   clamped. So it runs off the bottom and stops, which is the thing that happened;
   *   ending it at the last in-range bar instead would look identical to an indicator
   *   that hadn't warmed up yet.
   */
  function unitsFor(
    values: readonly (number | null)[],
    draw: Exclude<IndicatorDrawStyle, 'none'>
  ): (number | null)[] {
    const raw = values.map((value) =>
      value === null ? null : playback.unclampedUnitOf(value)
    )
    const onChart = (index: number): boolean => {
      const unit = raw[index]
      return unit !== undefined && unit !== null && unit >= 0 && unit <= 1
    }
    return raw.map((unit, index) => {
      if (unit === null) return null
      if (onChart(index)) return unit
      if (draw === 'dots') return null
      // The crossing: kept only when a neighbour is on the chart, so a run that is off
      // the chart from end to end draws nothing at all rather than a stub at each edge.
      return onChart(index - 1) || onChart(index + 1) ? Math.min(1, Math.max(0, unit)) : null
    })
  }

  function overlaysFor(chart: ChartFrame): OverlayLine[] {
    const lines: OverlayLine[] = []
    for (const series of indicators.series) {
      if (series.paneKind !== 'overlay') continue
      for (const output of series.outputs) {
        const style = styleOf(series, output)
        if (!style) continue
        const values = windowOf(series.history[output] ?? [], chart)
        lines.push({
          instanceId: series.instanceId,
          ...style,
          // `displayName` is already per-instance, built from the plugin's params by
          // the feed — see `instanceLabel`.
          label: series.outputs.length > 1 ? `${series.displayName} ${output}` : series.displayName,
          output,
          // Through the *same* normalizer the poles used, so the line sits on them.
          units: unitsFor(values, style.draw),
        })
      }
    }
    return lines
  }

  /** Normalize within the pane: an oscillator has its own scale, not the price one. */
  function paneFor(series: IndicatorSeries, chart: ChartFrame): SubPane {
    // Hidden outputs are dropped before the bounds are measured, so setting one to
    // `none` also stops it stretching the pane's scale — an invisible outlier squashing
    // everything else into a band would be worse than drawing it.
    const windows = series.outputs.flatMap((output) => {
      const style = styleOf(series, output)
      return style ? [{ output, style, values: windowOf(series.history[output] ?? [], chart) }] : []
    })

    let min = series.fixedRange?.[0] ?? Number.POSITIVE_INFINITY
    let max = series.fixedRange?.[1] ?? Number.NEGATIVE_INFINITY
    if (!series.fixedRange) {
      for (const entry of windows) {
        for (const value of entry.values) {
          if (value === null) continue
          if (value < min) min = value
          if (value > max) max = value
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      min = 0
      max = 1
    }
    const span = max - min

    return {
      instanceId: series.instanceId,
      title: series.displayName,
      series: windows.map((entry) => ({
        output: entry.output,
        ...entry.style,
        units: entry.values.map((value) => (value === null ? null : (value - min) / span)),
      })),
      min,
      max,
      histogram: false,
    }
  }

  /**
   * Volume is structurally identical to an oscillator pane, so it uses the same
   * mechanism rather than a bespoke system. One renderer serves both.
   */
  function volumePane(chart: ChartFrame): SubPane {
    let max = 0
    for (const visible of chart.bars) max = Math.max(max, visible.bar.v)
    const span = max > 0 ? max : 1
    return {
      instanceId: 'volume',
      title: 'Volume',
      series: [
        {
          output: 'volume',
          // Never actually used: `directions` is present, so the renderer colours every
          // bar individually. Kept as the fallback for a bar with no direction.
          colour: DEFAULT_INDICATOR_COLOUR,
          draw: 'line',
          units: chart.bars.map((visible) => visible.bar.v / span),
          // Leading preloaded bars, so the histogram dims in step with the poles above
          // it. A bright bar under a greyed candle would read as a bug.
          contextBefore: chart.bars.filter((visible) => visible.preloaded).length,
          // Volume is the one pane whose points correspond one-for-one with price
          // bars, so each can be coloured like the candle above it. That reads as
          // "heavy selling" versus "heavy buying" at a glance, which a single-colour
          // histogram cannot say at all.
          directions: chart.bars.map((visible) => visible.direction),
        },
      ],
      min: 0,
      max: span,
      histogram: true,
    }
  }

  function subPanesFor(chart: ChartFrame): SubPane[] {
    const panes: SubPane[] = []
    if (showVolume) panes.push(volumePane(chart))
    for (const series of indicators.series) {
      if (series.paneKind === 'oscillator') panes.push(paneFor(series, chart))
    }
    // Beyond the cap each pane is too short to read anything from, so extras queue
    // rather than shrinking the set further.
    return panes.slice(0, Math.max(0, maxSubPanes))
  }

  function frameFrom(chart: ChartFrame): FrameState {
    // Mark against the bar being traded. Falling back to avgCost means a flat
    // position reports zero unrealized rather than a spurious number.
    const mark = chart.currentBar?.c ?? state.position.avgCost
    return {
      ...chart,
      hud: {
        direction: directionOf(state.position),
        shares: state.position.shares,
        avgCost: state.position.avgCost,
        unitCount: state.position.unitCount,
        realizedPnl: state.position.realizedPnl,
        unrealizedPnl: unrealizedPnl(state.position, mark),
        totalPnl: totalPnl(state.position, mark),
        percentReturn: percentReturn(state.position, config, mark),
        buyingPower: buyingPower(state.position, config),
        streak: {
          meter: state.streak.meter,
          streak: state.streak.streak,
          multiplier: state.streak.multiplier,
          arcadeScore: state.streak.arcadeScore,
          maxMultiplier: config.scoring.maxMultiplier,
        },
        scrollSpeed: playback.scrollSpeed,
        stoppedOutThisBar: lastEvents.some((event) => event.kind === 'stoppedOut'),
      },
      stopLines: stopLines(),
      events: lastEvents,
      overlays: overlaysFor(chart),
      subPanes: subPanesFor(chart),
    }
  }

  let snapshot: FrameState = frameFrom(playback.frame)

  const controller: RunController = {
    advance(dt) {
      snapshot = frameFrom(playback.advance(dt))
      return snapshot
    },

    get frame() {
      return snapshot
    },

    press(action) {
      if (controller.isInputBlocked()) return
      buffer.push(action)
    },

    isInputBlocked() {
      if (playback.isPaused) return true
      return playback.frame.currentIndex <= blockedThroughIndex
    },

    pause() {
      playback.pause()
      // Presses buffered during the interrupted bar must not land on the bar that
      // resolves after a resume — the same mis-assignment bug as banking stalled
      // bars, arriving through a different door.
      buffer.clear()
    },

    resume() {
      playback.resume()
    },

    get isPaused() {
      return playback.isPaused
    },

    changeSpeed(direction) {
      if (playback.isPaused) return playback.scrollSpeed
      playback.setScrollSpeed(steppedSpeed(playback.scrollSpeed, direction))
      return playback.scrollSpeed
    },

    endRun() {
      const bar = playback.frame.currentBar
      if (!bar) return
      // Routed through the pipeline rather than mutating the position here, so
      // there is exactly one place a position can change.
      buffer.clear()
      runTick(bar, playback.frame.currentIndex, 'ended-early')
      snapshot = frameFrom(playback.frame)
    },

    get summary() {
      return summarize(state.stats)
    },

    get state() {
      return state
    },
  }

  return controller
}
