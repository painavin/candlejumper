import { mount, unmount } from 'svelte'
import type { FingerprintInputs, RunConfig } from '@config/index.js'
import {
  defaultConfig,
  describeProblems,
  resolveMotion,
  runFingerprint,
  validateConfig,
  FINGERPRINT_VERSION,
} from '@config/index.js'
import { BUNDLED_SOURCE_ID, createSourceRegistry } from '@data/index.js'
import {
  createStopHost,
  createStopRegistry,
  createIndicatorRegistry,
  createPluginWorkerClient,
  createWorkerStopHost,
  createWorkerIndicatorFeed,
  validateDescriptor,
} from '@plugins/host/index.js'
import { createIndicatorFeed } from '@plugins/host/indicatorFeed.js'
import { createCompositeStopEngine } from '@engine/stops/composite.js'
import {
  importPluginFiles,
  loadStoredPlugins,
  mergePlugins,
  storePlugins,
} from '@platform/pluginLoading/index.js'
import type { PluginFile } from '@platform/pluginLoading/index.js'
import type { ParamSpec, PluginDescriptor, TickerMeta } from '@shared/contracts/index.js'
import { isDownloadable } from '@shared/contracts/index.js'
import { earnedUnlocks } from '@content/progression/index.js'
import { createHaptics } from '@platform/haptics/index.js'
import { createBrowserTransport } from '@platform/http/index.js'
import { pickTextFiles, SERIES_FILE_ACCEPT } from '@platform/fileImport/index.js'
import {
  createLocalStorageStore,
  loadSave,
  recordRun,
  writeSave,
} from '@platform/persistence/index.js'
import type { SaveData } from '@platform/persistence/index.js'
import { mintSeed, createPrng } from '@shared/math/index.js'
import type { OhlcvBar } from '@shared/contracts/index.js'
import { AppState, snapshot } from '@ui/appState.svelte.js'
import type { AppActions } from '@ui/appState.svelte.js'
import App from '@ui/screens/App.svelte'
import { createDatasetCache } from './datasetCache.js'
import { readStoredConfig, writeStoredConfig } from './configStore.js'
import { startRunSession } from './runSession.js'
import type { RunSession } from './runSession.js'

/**
 * The composition root: screen routing and the run lifecycle.
 *
 *   Title ──► Settings ──start──► Playing ──data exhausted──► Results ──► Settings
 *     ▲                            │  ▲                          ▲
 *     │                       Esc/P│  │resume                    │
 *     ├── How to play              ▼  │                          │
 *     └── Record                  Paused ──end run───────────────┘
 *                                  │  │
 *                                  │  └──restart──► Playing (same config, fresh run)
 *                                  └──abandon──► Title  (nothing recorded)
 *
 * The two quit paths are deliberately separate: **end run** records and is
 * eligible for a personal best (marked `endedEarly`), **abandon** records nothing.
 * Collapsing them forces a bad trade-off either way — see
 * docs/controls.md#pause-menu-options-and-their-effects.
 *
 * **The canvas is never empty.** Whenever no run is in progress, an attract-mode
 * session plays behind the menus. That's what makes the title screen a game screen
 * rather than a web page, and it's why every menu transition also has to decide
 * what the backdrop is doing.
 */

export interface Shell {
  destroy(): void
}

/** Minimum gap between effects-preview cues while a slider is being dragged. */
const SFX_PREVIEW_THROTTLE_MS = 220

/**
 * Where each price provider lives under `npm run dev`. Must match the proxy table in
 * vite.config.ts — these two lists are the same fact stated twice, and the second
 * statement has to be here because only the composition root chooses a base URL.
 */
const DEV_PROXY_PATHS: Readonly<Record<string, string>> = {
  yahoo: '/yahoo',
  stooq: '/stooq',
}

export async function createShell(canvasHost: HTMLElement, uiHost: HTMLElement): Promise<Shell> {
  const store = createLocalStorageStore()
  /**
   * The downloading source's dependencies, supplied here because this is the only zone
   * that may know about both `platform/` and `data/`.
   *
   * `baseUrls` is the interesting one. Yahoo sends no `Access-Control-Allow-Origin`,
   * so a browser will not hand its response to script; in dev the Vite server proxies
   * both providers to same-origin paths, which is the one configuration that needs
   * nothing installed. A built bundle has no proxy and so needs a CORS extension for
   * those hosts — see docs/data-sources.md.
   */
  const sources = createSourceRegistry({
    downloads: {
      transport: createBrowserTransport(),
      cache: createDatasetCache(store),
      baseUrls: import.meta.env.DEV ? DEV_PROXY_PATHS : undefined,
    },
  })
  const stopRegistry = createStopRegistry()
  const indicatorRegistry = createIndicatorRegistry()
  const haptics = createHaptics()

  /**
   * The plugin sandbox, created once for the app's lifetime rather than per run.
   *
   * One worker means one place untrusted code can be running, and it survives
   * between runs so a plugin's blob `import()` — by far its slowest moment — is paid
   * once instead of on every Start press.
   */
  const pluginWorker = createPluginWorkerClient()
  /** Descriptors of plugins living in the worker, keyed by their own declared id. */
  const sandboxed = new Map<string, PluginDescriptor>()
  let pluginFiles: PluginFile[] = []

  let save: SaveData = await loadSave(store, FINGERPRINT_VERSION)
  const state = new AppState()
  /**
   * Defaults for now; the stored settings are read further down, **after** the plugin
   * host has registered what the player imported. Order matters: `stops.active` and
   * `indicators.active` name plugins by id, and validating them against a registry
   * that hasn't loaded the sandboxed ones yet would report every imported plugin as
   * missing on the first frame after boot.
   */
  state.config = resolveMotion(defaultConfig(), prefersReducedMotion())
  state.isTouch = isCoarsePointer()
  state.lifetime = save.lifetime
  state.badges = earnedUnlocks({ lifetime: save.lifetime })

  let session: RunSession | undefined
  /** The config the current run was started with — never the editable draft. */
  let running: RunConfig | undefined
  /**
   * The committed config as it was when the settings screen opened.
   *
   * The screen previews live, which means it mutates the committed config as the
   * player scrolls through moods — so Cancel needs somewhere to restore *from*.
   * Without this, backing out of the screen would silently keep every change made
   * while looking around.
   */
  let configBeforeSettings: RunConfig | undefined
  let runVisibleBarCount = 0
  /**
   * The dataset behind the running config's ticker, frozen at run start for the same
   * reason `runVisibleBarCount` is: both are fingerprint inputs, and a value that
   * moved between Start and the results screen would record the run in a different
   * bucket from the one its personal best was read out of.
   */
  let runSeries: FingerprintInputs['series'] = { barCount: 0, lastBarTime: 0 }
  let endedEarly = false

  state.sources = [...sources.values()].map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    downloadable: isDownloadable(entry),
  }))
  // Where the library can fetch from. Passed through state because `ui/` may not
  // import `data/`, and the picker belongs beside the Download button.
  state.providers = [...sources.values()].flatMap((entry) =>
    isDownloadable(entry) ? [...entry.providers] : []
  )

  /**
   * Re-read the active source's catalogue.
   *
   * Called on start, whenever the chosen source changes, and after every download —
   * the downloading source's catalogue *is* its cache, so it changes under the app
   * rather than being fixed at build time.
   */
  async function refreshTickers(): Promise<void> {
    const active = state.config ? sources.get(state.config.data.source) : undefined
    try {
      state.tickers = active ? await active.listTickers() : []
    } catch {
      // A source that can't list is a source with nothing to offer, not a crash.
      state.tickers = []
    }
  }
  await refreshTickers()

  /**
   * Load plugin sources into the worker and publish whatever validates.
   *
   * Validation runs against the **descriptor**, not the module: the module never
   * leaves the sandbox. A plugin that fails is listed with its problems rather than
   * dropped in silence — a plugin the player imported and cannot find is worse than
   * one that says why it was rejected.
   */
  async function registerPlugins(files: readonly PluginFile[]): Promise<void> {
    const listed: { name: string; kind: 'stop' | 'indicator'; status: string }[] = []

    for (const file of files) {
      const response = await pluginWorker.send({
        type: 'load',
        kind: file.kind,
        source: file.source,
      })
      if (response.type !== 'loaded') {
        listed.push({
          name: file.name,
          kind: file.kind,
          status: response.type === 'failed' ? response.message : 'did not load',
        })
        continue
      }
      const validation = validateDescriptor(response.descriptor)
      if (!validation.ok) {
        listed.push({ name: file.name, kind: file.kind, status: validation.problems.join('; ') })
        continue
      }
      sandboxed.set(response.descriptor.id, response.descriptor)
      listed.push({ name: file.name, kind: file.kind, status: `loaded as ${response.descriptor.id}` })
    }

    state.plugins = listed
    publishChoices()
  }

  /** Built-ins and sandboxed plugins in one list; nothing downstream tells them apart. */
  function publishChoices(): void {
    state.stopChoices = [
      ...[...stopRegistry.values()].map((plugin) => ({
        id: plugin.id,
        displayName: plugin.displayName,
        params: plugin.params,
      })),
      ...[...sandboxed.values()]
        .filter((descriptor) => descriptor.kind === 'stop')
        .map((descriptor) => ({
          id: descriptor.id,
          displayName: descriptor.displayName,
          params: descriptor.params as ParamSpec[],
          sandboxed: true,
        })),
    ]
    state.indicatorChoices = [
      ...[...indicatorRegistry.values()].map((plugin) => ({
        id: plugin.id,
        displayName: plugin.displayName,
        abbreviation: plugin.abbreviation,
        paneKind: plugin.paneKind,
        params: plugin.params,
      })),
      ...[...sandboxed.values()]
        .filter((descriptor) => descriptor.kind === 'indicator')
        .map((descriptor) => ({
          id: descriptor.id,
          displayName: descriptor.displayName,
          abbreviation: descriptor.abbreviation,
          paneKind: descriptor.paneKind ?? 'overlay',
          params: descriptor.params as ParamSpec[],
          sandboxed: true,
        })),
    ]
  }

  pluginFiles = await loadStoredPlugins(store)
  if (pluginFiles.length > 0) await registerPlugins(pluginFiles)
  // Unconditionally, and *not* only from `registerPlugins`. That's where it used to
  // live, which meant a player with no imported plugin files — the normal case — got
  // empty choice lists: no indicators in the Chart section and no stops in Risk
  // rules, even though the registries had been seeded with the built-ins all along.
  // The built-ins were unreachable from the UI entirely.
  publishChoices()

  /**
   * Stored settings, applied now that the plugin registries are complete.
   *
   * Deliberately after `registerPlugins` — see the note on `state.config` above.
   * `refreshTickers` runs again because the stored source is very likely not the
   * default one, and the ticker list belongs to whichever source is selected.
   */
  state.config = await readStoredConfig(store, {
    defaults: defaultConfig(),
    systemReducedMotion: prefersReducedMotion(),
  })
  await refreshTickers()
  /**
   * A stored ticker the active source no longer offers falls back to one it does.
   *
   * The likely case is a downloaded series the player removed. Unlike a missing stop
   * plugin — which must survive to be complained about, because silently disarming a
   * risk rule is dangerous — a missing ticker has a harmless default to land on, and
   * refusing to boot over it would be theatre.
   */
  if (state.tickers.length > 0 && !state.tickers.some((t) => t.symbol === state.config?.data.ticker)) {
    state.config.data.ticker = state.tickers[0]!.symbol
    state.config.data.dateRange = undefined
  }

  /**
   * What the active source currently holds for a config's ticker.
   *
   * Read from the *catalogue* rather than from a loaded bar array, so the value is
   * identical before a run and after it — `refreshPersonalBest` has no bars to look
   * at, and a fingerprint that disagreed with itself across those two moments would
   * show a best from one bucket and record into another.
   */
  function seriesOf(config: RunConfig): FingerprintInputs['series'] {
    const meta = state.tickers.find((entry) => entry.symbol === config.data.ticker)
    return { barCount: meta?.barCount ?? 0, lastBarTime: meta?.lastBarTime ?? 0 }
  }

  const fingerprintOf = (
    config: RunConfig,
    visibleBarCount: number,
    series: FingerprintInputs['series']
  ): string => runFingerprint(config, { visibleBarCount, series })

  const refreshPersonalBest = (): void => {
    if (!state.config) return
    const key = fingerprintOf(
      state.config,
      resolveVisibleBarCount(state.config.visibleBarCount),
      seriesOf(state.config)
    )
    state.personalBest = save.personalBests[key]
  }
  refreshPersonalBest()

  // ── Attract mode ─────────────────────────────────────────────────────────────

  /** The backdrop session, and the settings it was built from. */
  let attract: RunSession | undefined
  let attractKey = ''
  /** Guards against two overlapping starts while a series is loading. */
  let attractStarting = false
  /**
   * Whether a user gesture has happened yet.
   *
   * Browsers refuse to start an audio context before one, so the title screen's bed
   * cannot simply play on load — it waits for the first click or keypress anywhere.
   * Once the context is running it stays running, so later attract sessions start
   * their bed immediately.
   */
  let audioUnlocked = false
  /** The last mix pushed from the settings screen, so a change can be detected. */
  let lastMix: { sfxVolume: number; sfxMuted: boolean } | undefined
  let lastSfxPreviewAt = 0
  /**
   * A config that arrived while a start was already in flight.
   *
   * Without this, clicking through themes faster than a series loads drops every
   * change but the first — the settings effect won't fire again, because the draft
   * hasn't changed since.
   */
  let pendingAttract: RunConfig | undefined

  /**
   * Only the settings that a restart is the *only* way to apply.
   *
   * Rebuilding the Pixi scene and the audio graph on every capital-slider drag would
   * be pointless and expensive, so this key decides whether a restart is warranted at
   * all. Volume deliberately isn't here — a mix change moves a gain on the running
   * session instead, since restarting would drop the music back to the top of the
   * progression on every pixel of slider travel.
   *
   * `audio.theme` *is* here: a different theme means a different progression and
   * possibly a different bed engine, so there's nothing to adjust in place.
   */
  const backdropKey = (config: RunConfig): string =>
    [
      config.visuals.theme,
      config.audio.theme,
      config.visuals.worldSeed,
      // Bar style and P&L palette are read once when the pole layer is built, so a
      // change to either needs the scene rebuilt to be visible.
      config.visuals.barStyle,
      config.visuals.pnlPalette,
      config.character.selected,
      config.data.source,
      config.data.ticker,
      config.visibleBarCount.landscape,
      config.visibleBarCount.portrait,
      config.scrollSpeed,
      config.normalizationMode,
      config.priceTransform,
      String(config.volume.enabled),
    ].join('|')

  /**
   * Start the backdrop's bed on the first gesture.
   *
   * Deliberately listening for `pointerdown` rather than `click`: the gesture that
   * unlocks audio is usually the same one that presses a menu button, and starting on
   * the down-stroke means the bed is already fading in by the time the screen changes.
   */
  const unlockAudio = (): void => {
    if (audioUnlocked) return
    audioUnlocked = true
    document.removeEventListener('pointerdown', unlockAudio)
    document.removeEventListener('keydown', unlockAudio)
    void attract?.startAudio()
  }
  document.addEventListener('pointerdown', unlockAudio)
  document.addEventListener('keydown', unlockAudio)

  function stopAttract(): void {
    attract?.stop()
    attract = undefined
    attractKey = ''
    // Dropped rather than kept: a run is starting, and the queued backdrop would
    // otherwise take the canvas back the moment the load finished.
    pendingAttract = undefined
  }

  /**
   * Start (or restart) the backdrop from a config.
   *
   * A fresh world seed each time it loops, so a player sitting on the title screen
   * sees variety rather than the same hillside forever — but the seed the *player*
   * chose is respected when it came from the settings screen, since previewing a
   * seed you can't see is useless.
   */
  async function startAttract(config: RunConfig, reseed = false): Promise<void> {
    if (session) return
    if (attractStarting) {
      pendingAttract = config
      return
    }
    const wanted = reseed
      ? { ...snapshot(config), visuals: { ...config.visuals, worldSeed: mintSeed() } }
      : snapshot(config)
    const key = backdropKey(wanted)
    if (attract && key === attractKey && !reseed) return

    attractStarting = true
    try {
      const bars = await attractBars(wanted)
      /**
       * No series to draw. Returns *without* stopping what's already playing, which
       * is the difference between switching to an empty source and staring at a black
       * canvas: selecting the downloading source before anything is downloaded used to
       * tear the backdrop down and leave nothing behind it.
       */
      if (!bars || bars.length === 0) return
      // A run may have started while the series was loading.
      if (session) return

      stopAttract()
      attractKey = key
      attract = await startRunSession({
        host: canvasHost,
        config: wanted,
        bars: attractSlice(bars, wanted.visuals.worldSeed),
        visibleBarCount: resolveVisibleBarCount(wanted.visibleBarCount),
        mode: 'attract',
        // Loop with a new world rather than freezing on the last bar.
        onFinished: () => void startAttract(wanted, true),
      })
      // A gesture already happened — a theme change from the settings screen, say —
      // so this session's bed can start straight away.
      if (audioUnlocked) void attract.startAudio()
    } catch {
      // Building the session itself failed, so there is a half-made one to clear. A
      // backdrop that fails must never block the menus — the screens are legible
      // without it, they just sit on the page background instead.
      stopAttract()
    } finally {
      attractStarting = false
      const queued = pendingAttract
      pendingAttract = undefined
      if (queued && !session) void startAttract(queued)
    }
  }

  /**
   * Bars for the backdrop: the chosen source, or the bundled one if it has nothing.
   *
   * "The canvas is never empty" is the premise the whole title screen is built on, and
   * the downloading source breaks it by design — its catalogue starts empty, so a
   * player who selects it has chosen a source that cannot yet draw anything. Borrowing
   * a bundled series keeps a world on screen until they download one.
   *
   * Safe to borrow precisely because attract mode records nothing: there is no
   * fingerprint, no personal best, and no trade. It is scenery, and scenery from
   * another ticker is still scenery. A *run* never does this — `begin` reports the
   * missing download as an error instead.
   */
  async function attractBars(config: RunConfig): Promise<readonly OhlcvBar[] | undefined> {
    const chosen = sources.get(config.data.source)
    if (chosen) {
      try {
        return await chosen.loadSeries(config.data.ticker, config.data.dateRange)
      } catch {
        // Fall through to the bundled source below.
      }
    }
    const bundled = sources.get(BUNDLED_SOURCE_ID)
    if (!bundled) return undefined
    try {
      const [first] = await bundled.listTickers()
      return first ? await bundled.loadSeries(first.symbol) : undefined
    } catch {
      // Nothing left to try; the menus render fine over the page background.
      return undefined
    }
  }

  /**
   * A window into the series rather than the whole thing.
   *
   * Two reasons: a full series at the default speed takes minutes to loop, and
   * starting at a seeded offset means the title screen shows a different stretch of
   * market each time you come back to it. This is *not* the same as session
   * variety for real runs — nothing here is recorded, so there's no fingerprint to
   * worry about.
   */
  function attractSlice(bars: readonly OhlcvBar[], seed: number): readonly OhlcvBar[] {
    const window = 240
    if (bars.length <= window) return bars
    const start = createPrng(seed).int(0, bars.length - window - 1)
    return bars.slice(start, start + window)
  }

  // ── Runs ─────────────────────────────────────────────────────────────────────

  async function begin(config: RunConfig): Promise<void> {
    state.error = undefined
    state.notice = undefined
    endedEarly = false

    /**
     * Resolve each configured stop's indicator dependencies before the run starts.
     * A stop asking for an indicator the registry can't supply must **refuse to
     * start**, naming both — deliberately not the mid-run auto-disable path,
     * because this is knowable before the first bar.
     */
    const stopRequirements = new Map<number, { key: string; indicatorId: string }[]>()
    config.stops.active.forEach((active, index) => {
      const required = stopRegistry.get(active.typeId)?.requires?.(active.params)
      if (required && required.length > 0) stopRequirements.set(index, required)
    })

    const problems = validateConfig(config, {
      // Sandboxed ids count as resolvable: a loaded plugin is as real as a built-in
      // from the config's point of view, which is the whole premise of one host.
      stopIds: new Set([...stopRegistry.keys(), ...sandboxedIds('stop')]),
      indicatorIds: new Set([...indicatorRegistry.keys(), ...sandboxedIds('indicator')]),
      sourceIds: new Set(sources.keys()),
      stopRequirements,
    })
    if (problems.length > 0) {
      state.error = `This configuration can't start a run:\n\n${describeProblems(problems)}`
      return
    }

    const activeSource = sources.get(config.data.source)
    if (!activeSource) {
      state.error = `Unknown data source: ${config.data.source}`
      return
    }
    /**
     * Loading is fallible, and now visibly so: with a downloading source, pressing
     * Play on a ticker that isn't in the cache is one click away. Unguarded, that
     * rejection escapes `void begin(...)` as an unhandled promise and the player gets
     * a title screen that simply ignored the button.
     */
    let bars: readonly OhlcvBar[]
    try {
      bars = await activeSource.loadSeries(config.data.ticker, config.data.dateRange)
    } catch (error) {
      state.error = `Couldn't load ${config.data.ticker} from ${activeSource.displayName}:\n\n  ${messageOf(error)}`
      return
    }

    session?.stop()
    // The backdrop and the run must never share the canvas — or the ticker.
    stopAttract()
    running = config
    runVisibleBarCount = resolveVisibleBarCount(config.visibleBarCount)
    runSeries = seriesOf(config)
    state.screen = 'playing'

    session = await startRunSession({
      host: canvasHost,
      config,
      bars,
      visibleBarCount: runVisibleBarCount,
      stops: await buildStopEngine(config),
      indicators: await buildIndicatorFeed(config),
      onAction: () => haptics.fire('action'),
      onPauseRequested: () => showPause(),
      onFinished: () => void finish(false),
    })
    state.touch = session.touch

    // The Start button is the user gesture browsers require before audio can begin.
    void session.startAudio()
  }

  const sandboxedIds = (kind: 'stop' | 'indicator'): string[] =>
    [...sandboxed.values()].filter((entry) => entry.kind === kind).map((entry) => entry.id)

  /**
   * Built-in stops in-process, player-supplied stops in the worker, both behind one
   * port.
   *
   * Built-ins deliberately do *not* go through the sandbox. docs/indicators.md asks
   * for no separate code path for official plugins, and this honours the spirit of
   * that — one contract, one registry, one port — while declining the letter, because
   * paying a `postMessage` round trip to protect the app from code it ships itself
   * buys nothing and costs a bar of latency on the risk path.
   */
  async function buildStopEngine(config: RunConfig) {
    const onDisabled = (stopId: string, reason: string): void => {
      // A stop that dies mid-run stops protecting an open position, so this is a
      // player-facing event rather than a console warning.
      state.notice = `Your ${stopId} stop stopped working and is no longer protecting this position (${reason}). Exits are fully manual from here.`
    }

    const builtin = config.stops.active.filter((active) => stopRegistry.has(active.typeId))
    const external = config.stops.active.filter((active) => sandboxed.has(active.typeId))

    const engines = []
    if (builtin.length > 0) {
      engines.push(
        createStopHost({
          active: builtin,
          registry: stopRegistry,
          indicators: indicatorRegistry,
          onDisabled,
        })
      )
    }
    if (external.length > 0) {
      engines.push(
        await createWorkerStopHost({
          active: external,
          client: pluginWorker,
          files: pluginFiles,
          onDisabled,
        })
      )
    }
    return createCompositeStopEngine(engines)
  }

  /**
   * The displayed-indicator equivalent. Two feeds can't be composed as cheaply as
   * two stop engines — the engine reads `series` as one list — so the sandboxed feed
   * is only used when there is nothing built-in to show, which is the common case for
   * a player who imported an indicator specifically to look at it.
   */
  async function buildIndicatorFeed(config: RunConfig) {
    const builtin = config.indicators.active.filter((active) =>
      indicatorRegistry.has(active.typeId)
    )
    const external = config.indicators.active.filter((active) => sandboxed.has(active.typeId))

    if (external.length > 0 && builtin.length === 0) {
      return createWorkerIndicatorFeed({
        active: external.map((active) => ({
          instanceId: active.instanceId,
          typeId: active.typeId,
          params: active.params,
          colour: active.colour,
          paneKind: active.paneKind,
        })),
        descriptors: sandboxed,
        client: pluginWorker,
      })
    }
    if (external.length > 0) {
      state.notice =
        'Imported indicators are shown only when no built-in indicator is active. Turn the built-in ones off to see them.'
    }
    return createIndicatorFeed({
      active: builtin.map((active) => ({
        instanceId: active.instanceId,
        typeId: active.typeId,
        params: active.params,
        colour: active.colour,
        paneKind: active.paneKind,
      })),
      registry: indicatorRegistry,
    })
  }

  /**
   * Session variety: a random ticker and a random window inside it.
   *
   * docs/game-feel.md's reason for this is that a fixed series becomes memorised —
   * and a memorised series stops training anything, because the player is recalling
   * rather than reading. Both keys are part of the run fingerprint, so each surprise
   * run competes only against other runs of the same slice, which is correct: an easy
   * uptrend and a brutal drawdown are not the same challenge.
   *
   * Seeded from fresh entropy rather than the world seed. This is the one thing that
   * *should* differ every time you press the button.
   */
  function surpriseConfig(): RunConfig | undefined {
    if (!state.config || state.tickers.length === 0) return undefined
    const prng = createPrng(mintSeed())
    const ticker = prng.pick(state.tickers)

    const span = ticker.lastBarTime - ticker.firstBarTime
    const config = snapshot(state.config)
    config.data.ticker = ticker.symbol
    config.visuals.worldSeed = mintSeed()

    // Roughly a year of trading days as a fraction of the series' own span, so a
    // short series isn't asked for a window it doesn't have.
    const windowFraction = Math.min(1, 250 / Math.max(1, ticker.barCount))
    if (windowFraction >= 1) {
      config.data.dateRange = undefined
      return config
    }
    const windowSpan = span * windowFraction
    const from = Math.floor(prng.range(ticker.firstBarTime, ticker.lastBarTime - windowSpan))
    config.data.dateRange = { from, to: Math.floor(from + windowSpan) }
    return config
  }

  function showPause(): void {
    if (!session || !running) return
    const frame = session.controller.frame
    state.pauseInfo = {
      buyingPower: frame.hud.buyingPower,
      startingCapital: running.startingCapital,
      ticker: running.data.ticker,
      date: frame.currentBar ? isoDate(frame.currentBar.t) : '—',
      progress:
        frame.totalBars > 0 ? Math.round(((frame.currentIndex + 1) / frame.totalBars) * 100) : 0,
    }
    state.screen = 'paused'
  }

  /** Record the run and show results. `early` marks it as ended from the menu. */
  async function finish(early: boolean): Promise<void> {
    if (!session || !running) return
    const controller = session.controller
    const frame = controller.frame
    const summary = controller.summary
    const streak = controller.state.streak
    const longestStreak = Math.max(streak.longest, streak.streak)

    const key = fingerprintOf(running, runVisibleBarCount, runSeries)
    const previous = save.personalBests[key]
    const result = {
      percentReturn: frame.hud.percentReturn,
      arcadeScore: streak.arcadeScore,
      endedEarly: early,
      at: nowMs(),
    }
    const before = state.badges
    const recorded = recordRun(save, key, result, {
      campaigns: summary.campaigns,
      wins: summary.wins,
      realized: summary.realized,
      streakResets: streak.resets,
      longestStreak,
    })
    save = recorded.save
    await writeSave(store, save)

    state.lifetime = save.lifetime
    const after = earnedUnlocks({ lifetime: save.lifetime })
    state.badges = after

    state.outcome = {
      summary,
      percentReturn: result.percentReturn,
      arcadeScore: result.arcadeScore,
      longestStreak,
      streakResets: streak.resets,
      meter: streak.meter,
      endedEarly: early,
      isPersonalBest: recorded.isPersonalBest,
      personalBest: previous?.percentReturn,
      newBadges: after.filter((id) => !before.includes(id)),
    }
    state.screen = 'results'
    session.stop()
    session = undefined
    state.touch = undefined
    refreshPersonalBest()
    if (state.config) void startAttract(state.config, true)
  }

  function discard(): void {
    // Restart and abandon both record nothing — treated as if the run never
    // happened, so a misclicked run can't pollute a player's history.
    session?.stop()
    session = undefined
    state.touch = undefined
  }

  /** The last source the preview was told about, so a change to it can be detected. */
  let lastSourceId: string = state.config.data.source

  const actions: AppActions = {
    // `snapshot`, not `structuredClone`: the incoming config may still be a
    // reactive proxy, and structuredClone throws DataCloneError on one.
    start: (config) => {
      // The started config becomes the remembered one, so Quick run and the
      // backdrop both reflect what was last played.
      state.config = snapshot(config)
      void begin(snapshot(config))
    },
    resume: () => {
      session?.resume()
      state.screen = 'playing'
    },
    restart: () => {
      const config = running
      discard()
      if (config) void begin(config)
    },
    endRun: () => {
      endedEarly = true
      session?.endRun()
      void finish(true)
    },
    abandon: () => {
      discard()
      state.screen = 'title'
      refreshPersonalBest()
      if (state.config) void startAttract(state.config, true)
    },
    runAgain: () => {
      const config = running
      if (config) void begin(config)
    },
    toSettings: () => {
      state.error = undefined
      configBeforeSettings = state.config ? snapshot(state.config) : undefined
      state.screen = 'settings'
      refreshPersonalBest()
    },
    commitSettings: (config) => {
      // Takes effect immediately: the committed config is what the backdrop draws,
      // what Play runs, and what the personal-best bucket is keyed on.
      state.config = resolveMotion(snapshot(config), prefersReducedMotion())
      configBeforeSettings = undefined
      state.screen = 'title'
      refreshPersonalBest()
      void startAttract(state.config)
      /**
       * Persisted **here and nowhere else**, which is what makes Cancel mean something.
       * The screen previews live by mutating the committed config, so writing on every
       * change would save a mood the player was only looking at. Fire-and-forget: a
       * failed write costs a preference, and blocking the screen on storage would cost
       * more than that.
       */
      void writeStoredConfig(store, state.config)
    },
    cancelSettings: () => {
      if (configBeforeSettings) state.config = configBeforeSettings
      configBeforeSettings = undefined
      state.screen = 'title'
      refreshPersonalBest()
      // Restore the backdrop too — a cancelled mood preview shouldn't leave the
      // world it was previewing on screen.
      if (state.config) void startAttract(state.config)
    },
    toTitle: () => {
      state.error = undefined
      state.screen = 'title'
      refreshPersonalBest()
    },
    toHowTo: () => {
      state.screen = 'howto'
    },
    toStats: () => {
      state.screen = 'stats'
    },
    preview: (config) => {
      // The settings draft, not a commitment: it drives the backdrop and the menu
      // colours, and is discarded if the player backs out without starting.
      // Motion is re-resolved because the *override* is what the player changed, and
      // every renderer reads the resolved value.
      state.config = resolveMotion(snapshot(config), prefersReducedMotion())
      /**
       * Mix changes are applied to whatever is already playing rather than triggering
       * a restart. Restarting for a volume change would drop the music back to the
       * top of the progression on every pixel of slider travel, which is both worse
       * and slower than just moving a gain.
       */
      const mix = {
        masterVolume: config.audio.masterVolume,
        musicVolume: config.audio.musicVolume,
        musicMuted: config.audio.musicMuted,
        sfxVolume: config.audio.sfxVolume,
        sfxMuted: config.audio.sfxMuted,
      }
      attract?.setMix(mix)
      session?.setMix(mix)

      /**
       * Audition the effects level when it moves.
       *
       * Throttled, because a slider drag fires this dozens of times a second and a
       * stinger per pixel of travel is a machine gun rather than a preview. Only on
       * the effects controls: master and music are already audible through the bed
       * that's playing, so a cue there would be noise for no information.
       */
      const sfxChanged =
        mix.sfxVolume !== lastMix?.sfxVolume || mix.sfxMuted !== lastMix?.sfxMuted
      const elapsed = performance.now() - lastSfxPreviewAt
      if (sfxChanged && !mix.sfxMuted && elapsed > SFX_PREVIEW_THROTTLE_MS) {
        lastSfxPreviewAt = performance.now()
        attract?.previewSfx()
      }
      lastMix = mix
      if (config.data.source !== lastSourceId) {
        // A source owns its own catalogue, so switching means a different ticker list
        // — and possibly one that doesn't contain what the draft is holding. The
        // settings screen corrects the draft once the new list arrives.
        lastSourceId = config.data.source
        void refreshTickers().then(() => {
          refreshPersonalBest()
          if (state.config) void startAttract(state.config)
        })
        return
      }
      // Only restarts if something the backdrop can actually *show* changed.
      void startAttract(state.config)
      refreshPersonalBest()
    },
    dismissNotice: () => {
      state.notice = undefined
    },
    surprise: () => {
      const config = surpriseConfig()
      if (!config) return
      state.config = config
      void begin(snapshot(config))
    },
    importPlugins: (kind) => {
      void importPluginFiles(kind).then(async (added) => {
        if (added.length === 0) return
        pluginFiles = mergePlugins(pluginFiles, added)
        await storePlugins(store, pluginFiles)
        await registerPlugins(pluginFiles)
      })
    },
    removePlugin: (name) => {
      void (async () => {
        pluginFiles = pluginFiles.filter((file) => file.name !== name)
        await storePlugins(store, pluginFiles)
        // The worker keeps the old module loaded until it's replaced: there is no
        // unload in the protocol, and adding one would mean tracking blob lifetimes
        // for no benefit. A reload starts from the stored list, which no longer has
        // it, so the removal is durable even though it isn't immediate.
        sandboxed.clear()
        await registerPlugins(pluginFiles)
      })()
    },
    /**
     * Fetch a ticker into the active source's cache.
     *
     * Returns the meta so the settings screen can select what it just downloaded —
     * the alternative is reaching into the screen's own draft from here, which would
     * make `app/` responsible for a form it doesn't own.
     */
    downloadTicker: async (symbol, providerId) => {
      const active = downloadableSource()
      if (!active) return undefined
      state.download = { busy: true, symbol }
      try {
        const meta = await active.download({ symbol, providerId })
        await refreshTickers()
        state.download = { busy: false, notice: describeSeries(meta) }
        return meta
      } catch (error) {
        // Shown in the settings screen rather than thrown: a failed download is a
        // normal outcome here — no proxy, wrong symbol, throttled provider — not a
        // broken app.
        state.download = { busy: false, error: messageOf(error) }
        return undefined
      }
    },
    /**
     * Import price files the player picked.
     *
     * Each file is adopted independently and the outcome is reported per file: one
     * unreadable CSV in a selection of five shouldn't cost the other four, and a
     * silent partial success would be worse than either.
     */
    importSeriesFiles: async () => {
      const active = downloadableSource()
      if (!active) return []
      const files = await pickTextFiles(SERIES_FILE_ACCEPT)
      if (files.length === 0) return []

      state.download = { busy: true, symbol: files[0]?.name }
      const imported: TickerMeta[] = []
      const failures: string[] = []
      for (const file of files) {
        try {
          imported.push(await active.importFile(file))
        } catch (error) {
          failures.push(`${file.name}: ${messageOf(error)}`)
        }
      }
      await refreshTickers()
      state.download = {
        busy: false,
        notice: imported.length > 0 ? imported.map(describeSeries).join('\n') : undefined,
        error: failures.length > 0 ? failures.join('\n\n') : undefined,
      }
      return imported
    },
    forgetTicker: async (symbol) => {
      const active = downloadableSource()
      if (!active) return
      try {
        await active.forget(symbol)
        await refreshTickers()
        state.download = { busy: false, notice: `Removed ${symbol}.` }
      } catch (error) {
        state.download = { busy: false, error: messageOf(error) }
      }
    },
  }

  /** What arrived, in one line: the confirmation worth reading after an import. */
  const describeSeries = (meta: TickerMeta): string =>
    `${meta.symbol}: ${meta.barCount} bars, ${isoDate(meta.firstBarTime)} to ${isoDate(meta.lastBarTime)}${meta.adjusted ? '' : ', not adjusted'}.`

  /** The active source, if it can download at all. */
  function downloadableSource() {
    const active = state.config ? sources.get(state.config.data.source) : undefined
    return active && isDownloadable(active) ? active : undefined
  }

  const app = mount(App, { target: uiHost, props: { state, actions } })
  void startAttract(state.config)

  return {
    destroy() {
      void endedEarly
      document.removeEventListener('pointerdown', unlockAudio)
      document.removeEventListener('keydown', unlockAudio)
      session?.stop()
      stopAttract()
      pluginWorker.dispose()
      void unmount(app)
    },
  }
}

/**
 * Resolved once, at run start, from the orientation at that moment — then frozen.
 * Re-resolving on rotation would rescale the chart mid-run and move the run into a
 * different personal-best bucket. See docs/config.md#scroll--poles.
 */
export function resolveVisibleBarCount(counts: {
  landscape: number
  portrait: number
}): number {
  return window.innerHeight > window.innerWidth ? counts.portrait : counts.landscape
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * Whether to show thumb buttons. Pointer coarseness rather than screen width or a
 * user-agent string: a small window on a desktop still has a mouse, and a tablet
 * with a keyboard still has a touchscreen.
 */
function isCoarsePointer(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}

function nowMs(): number {
  return new Date().getTime()
}

function isoDate(epochSeconds: number): string {
  // Bars carry epoch SECONDS; this multiplication is load-bearing.
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
