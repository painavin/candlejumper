import type { RunConfig } from '@config/index.js'
import type { BarInterval, ParamSpec, TickerMeta, TouchHandlers } from '@shared/contracts/index.js'
import type { LifetimeStats } from '@platform/persistence/index.js'
import type { Summary } from '@engine/scoring/stats.js'

/**
 * Shared reactive state between `app/` (which owns the run) and `ui/` (which
 * draws menus).
 *
 * A `.svelte.ts` module so runes work outside a component. `app/` may import
 * everything and mutates this; `ui/` reads it. That keeps the composition root in
 * charge of the run lifecycle while the screens stay declarative.
 */

/**
 * Deep-clone a value out of Svelte's reactive proxy.
 *
 * `structuredClone()` on a `$state` proxy throws `DataCloneError`, so anything
 * taking a plain copy of reactive config — the settings draft, the config handed to
 * a run — has to unwrap it first. `$state.snapshot` only exists inside `.svelte` and
 * `.svelte.ts` modules, which is why this helper lives here rather than in `app/`.
 */
export function snapshot<T>(value: T): T {
  return $state.snapshot(value) as T
}

/**
 * Which layer owns the DOM.
 *
 * `title` is the landing screen rather than `settings`: a form is a poor first
 * impression, and the attract-mode backdrop needs somewhere to be looked at. See
 * docs/game-feel.md#new-depth--motion-refinements.
 */
export type Screen = 'title' | 'settings' | 'howto' | 'stats' | 'playing' | 'paused' | 'results'

export interface StopChoice {
  id: string
  displayName: string
  params: ParamSpec[]
  /** Player-supplied, so it runs in the worker sandbox. Worth showing. */
  sandboxed?: boolean
}

export interface IndicatorChoice {
  id: string
  displayName: string
  /** Short form for chart legends, e.g. `SMA`. Falls back to `displayName`. */
  abbreviation?: string
  paneKind: 'overlay' | 'oscillator'
  params: ParamSpec[]
  sandboxed?: boolean
}

export interface SourceChoice {
  id: string
  displayName: string
  /** Whether it can fetch new tickers, i.e. whether to offer a download control. */
  downloadable: boolean
}

/** Where the library can download from. */
export interface ProviderChoice {
  id: string
  displayName: string
  /**
   * Intervals this provider serves, finest first.
   *
   * Carried through to the UI so the interval picker only offers what the selected
   * provider can answer — Yahoo spans minutes to quarters, Stooq is daily only.
   */
  intervals: readonly BarInterval[]
}

/** What the last download or import is doing, or did. */
export interface DownloadState {
  busy: boolean
  /** The symbol currently being fetched. */
  symbol?: string
  notice?: string
  error?: string
  /**
   * Where to fetch this by hand, when doing so would help.
   *
   * Present on a CORS-shaped failure, because a tab the player opens is not subject to
   * the rule that stopped the app — so the response can be saved and imported. Absent
   * on failures a manual attempt would hit too, like a rate limit.
   */
  manualUrl?: string
}

export interface RunOutcome {
  summary: Summary
  percentReturn: number
  arcadeScore: number
  longestStreak: number
  streakResets: number
  meter: 'live' | 'automated' | 'dormant'
  endedEarly: boolean
  isPersonalBest: boolean
  personalBest: number | undefined
  /** Badges this run earned for the first time, for the results screen to announce. */
  newBadges: readonly string[]
}

export interface PauseInfo {
  buyingPower: number
  startingCapital: number
  ticker: string
  date: string
  progress: number
}

export class AppState {
  /**
   * Which screen owns the DOM. The canvas is always mounted underneath — during a
   * run it's the game, and between runs it's attract mode — and only the menu
   * layers come and go. None of them update per frame.
   */
  screen = $state<Screen>('title')
  config = $state<RunConfig | undefined>(undefined)
  tickers = $state<TickerMeta[]>([])
  /** Every registered price source, and whether it can download. */
  sources = $state<SourceChoice[]>([])
  /** Providers the library can fetch from, for the download picker. */
  providers = $state<ProviderChoice[]>([])
  /** Progress and outcome of the last ticker download. */
  download = $state<DownloadState>({ busy: false })
  stopChoices = $state<StopChoice[]>([])
  indicatorChoices = $state<IndicatorChoice[]>([])
  /** Best percent return for the *pending* config's fingerprint, if any. */
  personalBest = $state<{ percentReturn: number; arcadeScore: number } | undefined>(undefined)
  outcome = $state<RunOutcome | undefined>(undefined)
  pauseInfo = $state<PauseInfo | undefined>(undefined)
  error = $state<string | undefined>(undefined)
  /** Lifetime totals, for the stats screen. Recorded since the first run. */
  lifetime = $state<LifetimeStats | undefined>(undefined)
  /** Badge ids earned so far. Nothing is *gated* on these — see content/progression. */
  badges = $state<readonly string[]>([])
  /** Thumb-button handlers for the active run. Absent when not playing. */
  touch = $state<TouchHandlers | undefined>(undefined)
  /** True on a coarse pointer: shows the thumb buttons and hides key hints. */
  isTouch = $state(false)
  /** A stop plugin died mid-run and stopped protecting the position. */
  notice = $state<string | undefined>(undefined)
  /** Imported plugin files, with whatever the sandbox made of each. */
  plugins = $state<{ name: string; kind: 'stop' | 'indicator'; status: string }[]>([])
}

/** Callbacks `ui/` invokes; all of them are implemented in `app/`. */
export interface AppActions {
  start(config: RunConfig): void
  resume(): void
  restart(): void
  endRun(): void
  abandon(): void
  runAgain(): void
  toSettings(): void
  /** Keep the draft and return to the title. Takes effect immediately. */
  commitSettings(config: RunConfig): void
  /** Discard the draft, restore what was there before, return to the title. */
  cancelSettings(): void
  toTitle(): void
  toHowTo(): void
  toStats(): void
  /** Settings previewing a look: restarts the attract backdrop, nothing else. */
  preview(config: RunConfig): void
  dismissNotice(): void
  /** A random ticker and date window, so a series can't be memorised. */
  surprise(): void
  /** Opens a file picker; the chosen modules are validated in the sandbox. */
  importPlugins(kind: 'stop' | 'indicator'): void
  removePlugin(name: string): void
  /**
   * Fetch a ticker from a named provider into the library. Resolves with what was
   * stored, or `undefined` if it failed — the reason is in `state.download.error`.
   */
  downloadTicker(
    symbol: string,
    providerId: string,
    interval: BarInterval
  ): Promise<TickerMeta | undefined>
  /** Open a picker and adopt the chosen CSV or JSON files. Resolves with what landed. */
  importSeriesFiles(): Promise<TickerMeta[]>
  /** Drop a ticker from the library. */
  forgetTicker(symbol: string): Promise<void>
}

