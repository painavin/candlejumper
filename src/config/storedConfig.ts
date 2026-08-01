import type { IndicatorDrawStyle, IndicatorOutputStyle } from '@shared/contracts/index.js'
import type {
  BackgroundLayerName,
  IndicatorInstanceConfig,
  RunConfig,
  StopInstanceConfig,
} from './types.js'

/** Every accepted draw style, for validating what came out of storage. */
const DRAW_STYLES: readonly IndicatorDrawStyle[] = ['none', 'line', 'dots', 'dash']

/**
 * The persisted settings shape, and the untrusted read back out of it.
 *
 * Pure on purpose — no store, no clock, no DOM — so the awkward half of persistence
 * (a file written by an older build, or edited by hand) is testable headlessly. The
 * storage call lives in `app/configStore.ts`, because `config/` may only import
 * `@shared` and the store is a platform concern.
 *
 * ## Two rules, both inherited from the save file
 *
 * **Versioned from the first write**, so a later shape change is an explicit decision
 * rather than silent loss. **Untrusted on read**: every field is checked against its
 * own domain and falls back individually. That combination is what makes the loader
 * *permissive about missing fields and strict about wrong ones* — a config saved by an
 * older build is missing keys the new one has, and should keep everything it does
 * carry.
 *
 * ## What is deliberately not stored
 *
 * `visuals.reducedMotion` — the resolved value for the session. Persisting it would
 * silently override the OS `prefers-reduced-motion` setting, which is the one
 * preference whose entire purpose is to be honoured without being asked again. The
 * player's explicit choice is `visuals.motionOverride`, which *is* stored, and
 * `undefined` there means "follow the system".
 *
 * ## What is stored without filtering
 *
 * `stops.active` and `indicators.active` are shape-checked but **not** checked against
 * the plugin registries. A stop whose plugin is temporarily missing must not be
 * silently deleted: that changes the player's risk configuration without telling them,
 * in the dangerous direction. `validateConfig` already refuses to start a run and
 * names both the stop and the missing plugin, and the settings screen already marks
 * such a row "plugin missing". Refusing loudly beats disarming quietly.
 */

/** Bump when the *shape* changes incompatibly; a mismatch falls back to defaults. */
export const CONFIG_VERSION = 1

export interface StoredConfig {
  version: number
  /** A `RunConfig`-shaped object, minus the fields listed above. Untrusted. */
  config: unknown
}

/** The settings, ready to hand to a store. */
export function toStoredConfig(config: RunConfig): StoredConfig {
  const { reducedMotion: _resolved, ...visuals } = config.visuals
  return { version: CONFIG_VERSION, config: { ...config, visuals } }
}

export interface ParseOptions {
  defaults: RunConfig
  /** What `prefers-reduced-motion` says right now. */
  systemReducedMotion: boolean
}

/**
 * Stored settings → a usable config, falling back field by field.
 *
 * Never throws and never returns a partial config: the worst case is `defaults` with
 * motion resolved, which is exactly a first run.
 */
export function parseStoredConfig(raw: unknown, options: ParseOptions): RunConfig {
  const { defaults, systemReducedMotion } = options
  const stored = record(raw)
  const fresh = resolveMotion(defaults, systemReducedMotion)
  if (!stored || stored.version !== CONFIG_VERSION) return fresh

  const saved = record(stored.config)
  if (!saved) return fresh

  const merged: RunConfig = {
    startingCapital: num(saved.startingCapital, defaults.startingCapital, 1, 1e12),
    // A fraction of capital, so (0, 1] is the whole domain rather than a UI range.
    entrySize: num(saved.entrySize, defaults.entrySize, 1e-4, 1),
    allowShorting: bool(saved.allowShorting, defaults.allowShorting),
    costBasisMethod: oneOf(
      saved.costBasisMethod,
      ['weighted-average', 'fifo'] as const,
      defaults.costBasisMethod
    ),
    flattenHoldMs: num(saved.flattenHoldMs, defaults.flattenHoldMs, 50, 10_000),

    stops: { active: stops(record(saved.stops)?.active, defaults.stops.active) },

    scoring: {
      streakEnabled: bool(record(saved.scoring)?.streakEnabled, defaults.scoring.streakEnabled),
      maxMultiplier: num(record(saved.scoring)?.maxMultiplier, defaults.scoring.maxMultiplier, 1, 100),
    },

    scrollSpeed: num(saved.scrollSpeed, defaults.scrollSpeed, 0.1, 60),
    visibleBarCount: {
      landscape: int(
        record(saved.visibleBarCount)?.landscape,
        defaults.visibleBarCount.landscape,
        5,
        500
      ),
      portrait: int(
        record(saved.visibleBarCount)?.portrait,
        defaults.visibleBarCount.portrait,
        5,
        500
      ),
    },
    priceTransform: oneOf(saved.priceTransform, ['none', 'log10'] as const, defaults.priceTransform),
    normalizationMode: oneOf(
      saved.normalizationMode,
      ['visible-window-min-max', 'fixed-price-per-pixel', 'starting-price-relative'] as const,
      defaults.normalizationMode
    ),
    normalizationReference: num(
      saved.normalizationReference,
      defaults.normalizationReference,
      1e-6,
      1e12
    ),

    hud: {
      showStopLevelOnChart: bool(
        record(saved.hud)?.showStopLevelOnChart,
        defaults.hud.showStopLevelOnChart
      ),
    },

    indicators: {
      active: indicators(record(saved.indicators)?.active, defaults.indicators.active),
    },
    volume: { enabled: bool(record(saved.volume)?.enabled, defaults.volume.enabled) },

    background: { layers: layers(record(saved.background)?.layers, defaults.background.layers) },

    visuals: {
      theme: text(record(saved.visuals)?.theme, defaults.visuals.theme),
      // Non-negative integer: `mintSeed()` produces one, and a stored NaN would make
      // every generated world collapse to the same degenerate one.
      worldSeed: int(record(saved.visuals)?.worldSeed, defaults.visuals.worldSeed, 0, 2 ** 32),
      // Placeholder; `resolveMotion` below sets the real value.
      reducedMotion: false,
      motionOverride: optionalBool(record(saved.visuals)?.motionOverride),
      screenShake: bool(record(saved.visuals)?.screenShake, defaults.visuals.screenShake),
      pnlPalette: oneOf(
        record(saved.visuals)?.pnlPalette,
        ['blue-orange', 'red-green'] as const,
        defaults.visuals.pnlPalette
      ),
      barStyle: oneOf(
        record(saved.visuals)?.barStyle,
        ['candlestick', 'bollinger'] as const,
        defaults.visuals.barStyle
      ),
    },

    character: { selected: text(record(saved.character)?.selected, defaults.character.selected) },

    audio: {
      theme: text(record(saved.audio)?.theme, defaults.audio.theme),
      masterVolume: num(record(saved.audio)?.masterVolume, defaults.audio.masterVolume, 0, 1),
      musicVolume: num(record(saved.audio)?.musicVolume, defaults.audio.musicVolume, 0, 1),
      musicMuted: bool(record(saved.audio)?.musicMuted, defaults.audio.musicMuted),
      sfxVolume: num(record(saved.audio)?.sfxVolume, defaults.audio.sfxVolume, 0, 1),
      sfxMuted: bool(record(saved.audio)?.sfxMuted, defaults.audio.sfxMuted),
    },

    data: {
      source: text(record(saved.data)?.source, defaults.data.source),
      ticker: text(record(saved.data)?.ticker, defaults.data.ticker),
      dateRange: dateRange(record(saved.data)?.dateRange),
    },
  }

  return resolveMotion(merged, systemReducedMotion)
}

/**
 * Apply the motion override, or the OS setting when there isn't one.
 *
 * Exported because the same resolution has to happen when the player changes the
 * override mid-session — the renderers read `reducedMotion` and know nothing about the
 * override.
 */
export function resolveMotion(config: RunConfig, systemReducedMotion: boolean): RunConfig {
  return {
    ...config,
    visuals: {
      ...config.visuals,
      reducedMotion: config.visuals.motionOverride ?? systemReducedMotion,
    },
  }
}

// ── Field readers ──────────────────────────────────────────────────────────────

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = num(value, NaN, min, max)
  return Number.isInteger(parsed) ? parsed : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Absent *and* invalid both mean "no override" — there is no third thing to be. */
function optionalBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/** Numeric params only, which is what both plugin contracts accept. */
function params(value: unknown): Record<string, number> {
  const source = record(value)
  if (!source) return {}
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = entry
  }
  return out
}

/**
 * Per-output style overrides.
 *
 * Entries are dropped rather than corrected, and the map is omitted when nothing
 * survives: an absent override means "use the plugin's default", which is the right
 * answer for a corrupt entry too. Output *names* aren't checked against a registry
 * here for the same reason a missing plugin id survives — this reads storage, and
 * an override for an output that no longer exists costs nothing but is worth keeping
 * in case the plugin comes back.
 */
function outputStyles(value: unknown): Record<string, IndicatorOutputStyle> | undefined {
  const source = record(value)
  if (!source) return undefined
  const out: Record<string, IndicatorOutputStyle> = {}
  for (const [output, entry] of Object.entries(source)) {
    const style = record(entry)
    if (!style) continue
    const resolved: IndicatorOutputStyle = {}
    if (DRAW_STYLES.includes(style.draw as IndicatorDrawStyle)) {
      resolved.draw = style.draw as IndicatorDrawStyle
    }
    // Rejected rather than clamped, the persistence rule throughout this file: a
    // colour outside 24 bits is evidence of corruption, not of intent.
    if (
      typeof style.colour === 'number' &&
      Number.isInteger(style.colour) &&
      style.colour >= 0 &&
      style.colour <= 0xffffff
    ) {
      resolved.colour = style.colour
    }
    if (resolved.draw !== undefined || resolved.colour !== undefined) out[output] = resolved
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Configured stops, shape-checked but **not** registry-checked. See the note at the
 * top: a stop whose plugin is missing has to survive to be complained about.
 *
 * An entry with no `typeId` is dropped, because that names nothing at all and can't be
 * reported usefully either.
 */
function stops(value: unknown, fallback: StopInstanceConfig[]): StopInstanceConfig[] {
  if (!Array.isArray(value)) return fallback
  return value.flatMap((entry): StopInstanceConfig[] => {
    const stop = record(entry)
    const typeId = stop && typeof stop.typeId === 'string' ? stop.typeId : undefined
    if (!typeId) return []
    return [{ typeId, params: params(stop?.params), advisory: bool(stop?.advisory, true) }]
  })
}

function indicators(
  value: unknown,
  fallback: IndicatorInstanceConfig[]
): IndicatorInstanceConfig[] {
  if (!Array.isArray(value)) return fallback
  return value.flatMap((entry, index): IndicatorInstanceConfig[] => {
    const active = record(entry)
    const typeId = active && typeof active.typeId === 'string' ? active.typeId : undefined
    if (!typeId) return []
    const paneKind = active?.paneKind
    return [
      {
        typeId,
        params: params(active?.params),
        // A missing id would collide with its neighbours, and instance ids key the
        // engine's series output — so one is synthesised rather than left blank.
        instanceId: text(active?.instanceId, `${typeId}-${index + 1}`),
        colour: int(active?.colour, 0xffffff, 0, 0xffffff),
        outputs: outputStyles(active?.outputs),
        paneKind: paneKind === 'overlay' || paneKind === 'oscillator' ? paneKind : undefined,
      },
    ]
  })
}

function layers(
  value: unknown,
  fallback: RunConfig['background']['layers']
): RunConfig['background']['layers'] {
  const saved = record(value)
  if (!saved) return fallback
  const out = { ...fallback }
  for (const name of Object.keys(fallback) as BackgroundLayerName[]) {
    const layer = record(saved[name])
    out[name] = {
      enabled: bool(layer?.enabled, fallback[name].enabled),
      // Motion only, and fixed across themes — a stored value outside this range would
      // send a layer scrolling off at a speed nothing in the UI can undo.
      speedMultiplier: num(layer?.speedMultiplier, fallback[name].speedMultiplier, 0, 10),
    }
  }
  return out
}

/**
 * A playback window, or `undefined`.
 *
 * Dropped rather than clamped when it doesn't describe a range: it's a *narrowing* of
 * whatever series is selected, and the dataset behind a ticker can be replaced between
 * sessions. A range that no longer intersects its series would start a run with no
 * bars to play, which reads as a broken game rather than a stale setting. Whether it
 * still intersects is checked where the bars are — this only rejects nonsense.
 */
function dateRange(value: unknown): RunConfig['data']['dateRange'] {
  const range = record(value)
  if (!range) return undefined
  const from = num(range.from, NaN, 0, 1e12)
  const to = num(range.to, NaN, 0, 1e12)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return undefined
  return { from, to }
}
