import type { RunConfig } from './types.js'

/**
 * Pre-run validation.
 *
 * Two categories, deliberately kept apart:
 *
 *   - **Range/shape problems** are the settings UI's job to prevent, but are
 *     checked here too because persisted config is untrusted on read — a
 *     hand-edited or migrated file must fall back rather than crash.
 *   - **Resolution problems** (a stop asking for an indicator that isn't in the
 *     registry) must refuse to start the run. That's deliberately not the
 *     mid-run auto-disable path: an unresolvable dependency is knowable before
 *     the first bar, and starting a run whose stop silently doesn't exist is the
 *     failure mode worth spending a blocking error on. See
 *     docs/stops.md#a-missing-indicator-fails-the-run-before-it-starts.
 */

export interface ConfigProblem {
  /** Dotted path, e.g. `stops.active[0].params.percent`. */
  path: string
  message: string
}

/** Registries the run needs in order to resolve what config refers to. */
export interface ValidationContext {
  stopIds: ReadonlySet<string>
  indicatorIds: ReadonlySet<string>
  sourceIds: ReadonlySet<string>
  /**
   * Indicators each configured stop declares it needs, already resolved from
   * its own params by the plugin host. Keyed by index into `stops.active`.
   */
  stopRequirements?: ReadonlyMap<number, readonly { key: string; indicatorId: string }[]>
  /**
   * How many bars the run actually has, so `preloadBars` can be checked against it.
   *
   * Absent when there is nothing loaded to check against — the caller validates before
   * fetching in some paths, and "we don't know yet" must not read as "zero bars".
   */
  barCount?: number
}

/**
 * The shortest run worth starting.
 *
 * A handful of bars isn't a run — there's no time to enter, be wrong, and adjust, which
 * is the whole exercise. Refusing at twenty says so before the player watches a
 * three-second run instead of after.
 */
export const MIN_PLAYABLE_BARS = 20

/**
 * Whether a preload leaves a run behind it, given how many bars there actually are.
 *
 * Exported separately because of *when* it can be answered: the rest of this file
 * validates before a series is fetched, and the bar count only exists afterwards. So the
 * caller runs the general pass first and this one once the data has landed — rather than
 * `barCount` being an optional field that silently skips the only check that needed it.
 *
 * A typed preload that can't leave a run is **refused**, not clamped, which is the
 * opposite of what the settings field itself does. Deliberately: a number in a box is
 * intent, and quietly playing 200 bars when the player asked for 280 hides the fact that
 * the dataset is too short. `'auto'` is clamped instead, by whoever resolves it — nobody
 * asked for that number, so refusing to start over it would punish a player for their
 * own SMA(200).
 */
export function preloadProblem(
  config: RunConfig,
  barCount: number | undefined
): ConfigProblem | undefined {
  if (config.preloadBars === 'auto' || barCount === undefined) return undefined
  if (!Number.isInteger(config.preloadBars) || config.preloadBars <= 0) return undefined

  const playable = barCount - config.preloadBars
  if (playable >= MIN_PLAYABLE_BARS) return undefined
  return {
    path: 'preloadBars',
    message: `preloading ${config.preloadBars} of ${barCount} bars leaves ${Math.max(0, playable)} to play, and a run needs at least ${MIN_PLAYABLE_BARS}`,
  }
}

const NORMALIZATION_MODES = new Set([
  'visible-window-min-max',
  'fixed-price-per-pixel',
  'starting-price-relative',
])

export function validateConfig(config: RunConfig, context: ValidationContext): ConfigProblem[] {
  const problems: ConfigProblem[] = []
  const fail = (path: string, message: string) => problems.push({ path, message })

  const positive = (path: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) fail(path, `must be a positive number, got ${value}`)
  }

  positive('startingCapital', config.startingCapital)
  if (!(config.entrySize > 0 && config.entrySize <= 1)) {
    fail('entrySize', `must be a fraction in (0, 1], got ${config.entrySize}`)
  }
  positive('flattenHoldMs', config.flattenHoldMs)

  if (typeof config.preloadBars === 'number' && !Number.isInteger(config.preloadBars)) {
    fail('preloadBars', `must be a whole number of bars, got ${config.preloadBars}`)
  }
  const preload = preloadProblem(config, context.barCount)
  if (preload) problems.push(preload)

  if (config.costBasisMethod === 'fifo') {
    // A documented config option that was never implemented; better to say so
    // than to silently compute weighted-average and report FIFO.
    fail('costBasisMethod', 'fifo lot tracking is not implemented — use weighted-average')
  }

  if (!(config.scrollSpeed >= 0.5 && config.scrollSpeed <= 10)) {
    fail('scrollSpeed', `must be between 0.5 and 10 bars/sec, got ${config.scrollSpeed}`)
  }
  for (const orientation of ['landscape', 'portrait'] as const) {
    const count = config.visibleBarCount[orientation]
    if (!Number.isInteger(count) || count < 5) {
      fail(`visibleBarCount.${orientation}`, `must be an integer >= 5, got ${count}`)
    }
  }
  if (!NORMALIZATION_MODES.has(config.normalizationMode)) {
    fail(
      'normalizationMode',
      `${config.normalizationMode} is not a causal mode; only ${[...NORMALIZATION_MODES].join(', ')} are implemented`
    )
  }

  if (!Number.isInteger(config.scoring.maxMultiplier) || config.scoring.maxMultiplier < 1) {
    fail('scoring.maxMultiplier', `must be an integer >= 1, got ${config.scoring.maxMultiplier}`)
  }

  config.stops.active.forEach((stop, index) => {
    const at = `stops.active[${index}]`
    if (!context.stopIds.has(stop.typeId)) {
      fail(`${at}.typeId`, `no stop plugin registered with id "${stop.typeId}"`)
      return
    }
    for (const required of context.stopRequirements?.get(index) ?? []) {
      if (!context.indicatorIds.has(required.indicatorId)) {
        fail(
          `${at}.requires.${required.key}`,
          `stop "${stop.typeId}" needs indicator "${required.indicatorId}", which is not in the registry`
        )
      }
    }
  })

  config.indicators.active.forEach((indicator, index) => {
    if (!context.indicatorIds.has(indicator.typeId)) {
      fail(
        `indicators.active[${index}].typeId`,
        `no indicator plugin registered with id "${indicator.typeId}"`
      )
    }
  })

  if (!context.sourceIds.has(config.data.source)) {
    fail('data.source', `no price series source registered with id "${config.data.source}"`)
  }

  const range = config.data.dateRange
  if (range && !(range.from < range.to)) {
    fail('data.dateRange', `from (${range.from}) must be before to (${range.to})`)
  }

  for (const [name, volume] of [
    ['masterVolume', config.audio.masterVolume],
    ['musicVolume', config.audio.musicVolume],
    ['sfxVolume', config.audio.sfxVolume],
  ] as const) {
    if (!(volume >= 0 && volume <= 1)) fail(`audio.${name}`, `must be 0..1, got ${volume}`)
  }

  return problems
}

/** Format problems for the blocking pre-run error. */
export function describeProblems(problems: readonly ConfigProblem[]): string {
  return problems.map((p) => `  ${p.path}: ${p.message}`).join('\n')
}
