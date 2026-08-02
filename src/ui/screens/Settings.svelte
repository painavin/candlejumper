<script lang="ts">
  /**
   * The pre-run settings screen.
   *
   * A **pre-run screen, not a mid-run overlay** — config is fixed for a run's
   * duration, so the flow is title → settings → run → results. That's also what
   * keeps the settings UI and the 60fps render loop from ever being active at the
   * same time, which is the premise Svelte was chosen on.
   *
   * There is deliberately no stop-level editor here beyond choosing the rule: a
   * stop is a rule committed before the run, and moving it away from price to avoid
   * being stopped out is the canonical bad habit this trainer exists to make
   * impossible.
   *
   * Roadmap step 5 asks this screen to "surface every config from config.md that
   * exists" — so it does, grouped by what a player is deciding rather than by how
   * the config tree is nested. Advanced sections are collapsed rather than omitted:
   * a key with no control is an unshipped feature, but a first run shouldn't open
   * onto thirty of them.
   *
   * **OK / Cancel, not Start run.** Reaching this screen is not a commitment to
   * play — it's often "turn the music down and go back". OK commits the draft and
   * returns to the title; Cancel restores what was there before, including the
   * backdrop, so previewing a mood you decide against costs nothing.
   */
  import type {
    IndicatorInstanceConfig,
    NormalizationMode,
    RunConfig,
    StopInstanceConfig,
  } from '@config/index.js'
  import type {
    BarInterval,
    IndicatorDrawStyle,
    IndicatorOutputStyle,
    ParamSpec,
    TickerMeta,
  } from '@shared/contracts/index.js'
  import { DEFAULT_INTERVAL, instanceLabel, intervalName } from '@shared/contracts/index.js'
  import { mintSeed } from '@shared/math/index.js'
  import { audioThemes } from '@content/audioThemes/index.js'
  import { visualThemes } from '@content/visualThemes/index.js'
  import { characters } from '@content/characters/index.js'
  import {
    INDICATOR_COLOURS,
    colourFromHex,
    colourToHex,
    describeColourRisk,
    nextIndicatorColour,
  } from '@shared/palette/index.js'
  import { pnlColours } from '@content/pnlColours.js'
  import { untrack } from 'svelte'
  import { snapshot } from '../appState.svelte.js'
  import ParamControl from '../controls/ParamControl.svelte'

  interface Choice {
    id: string
    displayName: string
    params: ParamSpec[]
    /** Player-supplied, and therefore running in the worker sandbox. */
    sandboxed?: boolean
  }

  interface IndicatorChoice extends Choice {
    paneKind: 'overlay' | 'oscillator'
    /** Short form for the legend, e.g. `SMA`. Falls back to `displayName`. */
    abbreviation?: string
    /** Which params the label narrows to. Unset means all — see `instanceLabel`. */
    labelParams?: string[]
    /** Named outputs, and the plugin's suggested style for each. */
    outputs: string[]
    outputStyles?: Record<string, IndicatorOutputStyle>
  }

  /** A registered price source. `downloadable` decides whether the fetch UI appears. */
  interface SourceOption {
    id: string
    displayName: string
    downloadable: boolean
  }

  /** Somewhere the library can download from. */
  interface ProviderOption {
    id: string
    displayName: string
    intervals: readonly BarInterval[]
  }

  let {
    config,
    sources,
    providers,
    tickers,
    download,
    stopChoices,
    indicatorChoices,
    personalBest,
    plugins,
    onCommit,
    onCancel,
    onPreview,
    onImportPlugins,
    onRemovePlugin,
    onDownloadTicker,
    onImportSeriesFiles,
    onForgetTicker,
  }: {
    config: RunConfig
    sources: SourceOption[]
    providers: ProviderOption[]
    tickers: TickerMeta[]
    download: {
      busy: boolean
      symbol?: string
      notice?: string
      error?: string
      /** Present when fetching by hand would get past what stopped the app. */
      manualUrl?: string
    }
    stopChoices: Choice[]
    indicatorChoices: IndicatorChoice[]
    personalBest: { percentReturn: number; arcadeScore: number } | undefined
    plugins: { name: string; kind: 'stop' | 'indicator'; status: string }[]
    /** Keep these settings and go back. */
    onCommit: (config: RunConfig) => void
    /** Throw the draft away and restore what was there before. */
    onCancel: () => void
    onPreview: (config: RunConfig) => void
    onImportPlugins: (kind: 'stop' | 'indicator') => void
    onRemovePlugin: (name: string) => void
    onDownloadTicker: (
      symbol: string,
      providerId: string,
      interval: BarInterval
    ) => Promise<TickerMeta | undefined>
    onImportSeriesFiles: () => Promise<TickerMeta[]>
    onForgetTicker: (symbol: string) => Promise<void>
  } = $props()

  /** Local working copy: nothing is committed until Start. */
  // Capturing the initial value is the point: the draft must not track the prop.
  // svelte-ignore state_referenced_locally
  let draft = $state<RunConfig>(snapshot(config))

  /**
   * Push the draft to `app/` whenever something *audible or visible* changes, so
   * mood, jumper, and volume all take effect while you're still deciding rather than
   * after you commit. A volume slider that needs an OK press is a broken volume
   * slider — the only way anyone sets a level is by listening while they move it.
   *
   * The `untrack` is load-bearing. `$state.snapshot` reads every field of the draft,
   * so snapshotting inside a tracked effect would subscribe to all of them, and the
   * key list below would do nothing — rebuilding the Pixi scene on every drag of a
   * capital slider. `app/` decides what each change costs: a mix change moves a gain,
   * while a theme change rebuilds the backdrop.
   */
  $effect(() => {
    // Read exactly the settings that have an immediate effect. These are the
    // dependencies; everything else waits for OK.
    const key = [
      draft.visuals.theme,
      draft.visuals.worldSeed,
      draft.visuals.barStyle,
      draft.visuals.pnlPalette,
      draft.visuals.motionOverride,
      draft.character.selected,
      draft.data.source,
      draft.data.ticker,
      draft.visibleBarCount.landscape,
      draft.visibleBarCount.portrait,
      draft.scrollSpeed,
      draft.normalizationMode,
      draft.priceTransform,
      draft.volume.enabled,
      draft.audio.theme,
      draft.audio.masterVolume,
      draft.audio.musicVolume,
      draft.audio.musicMuted,
      draft.audio.sfxVolume,
      draft.audio.sfxMuted,
    ].join('|')
    void key
    untrack(() => onPreview(snapshot(draft)))
  })

  const moods = visualThemes
    .filter((theme) => audioThemes.some((audio) => audio.id === theme.id))
    .map((theme) => ({ id: theme.id, displayName: theme.displayName }))

  const mood = $derived(draft.visuals.theme === draft.audio.theme ? draft.visuals.theme : 'mixed')

  function setMood(id: string): void {
    draft.visuals.theme = id
    draft.audio.theme = id
  }

  const stopFor = (id: string): StopInstanceConfig | undefined =>
    draft.stops.active.find((stop) => stop.typeId === id)

  function toggleStop(choice: Choice, enabled: boolean): void {
    if (enabled) {
      draft.stops.active = [
        ...draft.stops.active,
        { typeId: choice.id, params: defaults(choice.params), advisory: true },
      ]
    } else {
      draft.stops.active = draft.stops.active.filter((stop) => stop.typeId !== choice.id)
    }
  }

  const indicatorColours = INDICATOR_COLOURS

  /**
   * The P&L pair the player is actually looking at, so a colour warning is measured
   * against the palette in use rather than the default one.
   */
  const activePnl = $derived(pnlColours(draft.visuals.pnlPalette))

  const instancesOf = (id: string): IndicatorInstanceConfig[] =>
    draft.indicators.active.filter((active) => active.typeId === id)

  /**
   * The smallest positive integer not already used by this type.
   *
   * Deterministic on purpose — `Math.random()` is banned repo-wide, and a timestamp
   * would make instance ids differ between two identical configurations. Reusing a
   * freed number also keeps ids stable across an add/remove/add cycle, so a config
   * saved before and after that round trip is the same config.
   */
  function nextInstanceId(typeId: string): string {
    const taken = new Set(instancesOf(typeId).map((active) => active.instanceId))
    for (let n = 1; ; n++) {
      const candidate = `${typeId}-${n}`
      if (!taken.has(candidate)) return candidate
    }
  }

  /** The type selected in the add picker. Never committed until Add is pressed. */
  let addTypeId = $state('')

  function addIndicator(typeId: string): void {
    const choice = indicatorChoices.find((candidate) => candidate.id === typeId)
    if (!choice) return
    draft.indicators.active = [
      ...draft.indicators.active,
      {
        typeId: choice.id,
        params: defaults(choice.params),
        instanceId: nextInstanceId(choice.id),
        colour: nextIndicatorColour(draft.indicators.active.map((active) => active.colour)),
      },
    ]
  }

  /** The choice descriptor for a configured instance, or undefined if its plugin is gone. */
  const choiceFor = (typeId: string): IndicatorChoice | undefined =>
    indicatorChoices.find((choice) => choice.id === typeId)

  function removeIndicator(instanceId: string): void {
    draft.indicators.active = draft.indicators.active.filter(
      (active) => active.instanceId !== instanceId
    )
  }

  /**
   * The label the chart legend will show for this instance.
   *
   * The *same* function the renderer's legend and the pane titles use, not a
   * reimplementation — an `IndicatorChoice` structurally satisfies `LabelledIndicator`,
   * so there's nothing to adapt. If these ever disagreed, a settings row and a chart
   * line would name the same series two different ways.
   */
  const labelFor = (choice: IndicatorChoice, active: IndicatorInstanceConfig): string =>
    instanceLabel(choice, active.params)

  /**
   * Where an instance will actually be drawn: its own override, or the plugin's hint.
   *
   * One resolver rather than the `??` inline at each use, because the summary line, the
   * warning, and the pane count all have to agree about it.
   */
  const paneOf = (active: IndicatorInstanceConfig): 'overlay' | 'oscillator' =>
    active.paneKind ?? choiceFor(active.typeId)?.paneKind ?? 'overlay'

  /**
   * Off / Automatic / a number, collapsed into the single `preloadBars` value.
   *
   * Choosing "a set number" lands on the *warm-up of the busiest active indicator* where
   * one exists, rather than on 1 or on some house number: the player asked for a set
   * amount, and the amount they almost certainly want is the one Automatic would have
   * picked — now visible and editable instead of implicit.
   */
  function setPreloadMode(mode: string): void {
    if (mode === 'auto') {
      draft.preloadBars = 'auto'
      return
    }
    if (mode === 'off') {
      draft.preloadBars = 0
      return
    }
    if (draft.preloadBars === 'auto' || draft.preloadBars === 0) draft.preloadBars = 50
  }

  /** `''` from the select means "no override", not a third kind. */
  function setPaneKind(active: IndicatorInstanceConfig, value: string): void {
    active.paneKind = value === 'overlay' || value === 'oscillator' ? value : undefined
  }

  /**
   * How one output of an instance will be drawn: the player's override, then the
   * plugin's suggestion, then a plain line in the instance's colour.
   *
   * The *same* precedence `plugins/host/indicatorFeed.ts` applies when it builds the
   * series — stated twice, unavoidably, because this side has no feed to ask. What
   * makes that survivable is that the row is showing the resolved value, so a
   * disagreement would be visible here rather than only on the chart.
   */
  function outputStyle(
    choice: IndicatorChoice,
    active: IndicatorInstanceConfig,
    output: string
  ): { draw: IndicatorDrawStyle; colour: number } {
    const declared = choice.outputStyles?.[output]
    const chosen = active.outputs?.[output]
    return {
      draw: chosen?.draw ?? declared?.draw ?? 'line',
      colour: chosen?.colour ?? declared?.colour ?? active.colour,
    }
  }

  /**
   * Record an override for one output.
   *
   * Sparse on purpose: an entry appears only once the player has changed something, so
   * an indicator that later improves its own defaults improves them for anyone who
   * never touched that output. The map is created lazily for the same reason — an empty
   * one would persist as noise in every saved config.
   */
  function setOutputStyle(
    active: IndicatorInstanceConfig,
    output: string,
    patch: { draw?: IndicatorDrawStyle; colour?: number }
  ): void {
    const outputs = { ...(active.outputs ?? {}) }
    outputs[output] = { ...outputs[output], ...patch }
    active.outputs = outputs
  }

  /** Drop every override for one output, back to whatever the plugin says. */
  function resetOutputStyle(active: IndicatorInstanceConfig, output: string): void {
    if (!active.outputs?.[output]) return
    const outputs = { ...active.outputs }
    delete outputs[output]
    // Deleted rather than left as `{}`: absent *is* "use the plugin's default", and two
    // representations of one state is how a stale empty object outlives its purpose.
    active.outputs = Object.keys(outputs).length > 0 ? outputs : undefined
  }

  const hasOutputOverride = (active: IndicatorInstanceConfig, output: string): boolean =>
    active.outputs?.[output] !== undefined

  /**
   * The swatch beside an instance's name: the colour of the first output actually drawn.
   *
   * Not the instance's base colour, which after per-output overrides may not appear on
   * the chart at all — the swatch exists to connect a collapsed row to a line the
   * player can see.
   */
  function summaryColour(
    choice: IndicatorChoice | undefined,
    active: IndicatorInstanceConfig
  ): number {
    if (!choice) return active.colour
    for (const output of choice.outputs) {
      const style = outputStyle(choice, active, output)
      if (style.draw !== 'none') return style.colour
    }
    return active.colour
  }

  const DRAW_CHOICES: readonly { value: IndicatorDrawStyle; label: string }[] = [
    { value: 'line', label: 'Line' },
    { value: 'dash', label: 'Dashed' },
    { value: 'dots', label: 'Dots' },
    // Last, and named for what the player wants rather than for the enum: this is the
    // hide control, and there is deliberately no separate checkbox that could contradict
    // it.
    { value: 'none', label: "Don't draw" },
  ]

  /**
   * How many panes are configured beyond what this viewport can show.
   *
   * Surfaced rather than left silent: `subPanesFor` slices the list to the cap, so
   * extra panes simply don't appear. A control that accepts input and discards it
   * without saying so is worse than one that refuses.
   *
   * Counts the *resolved* pane kind, so moving an oscillator onto the main chart
   * clears the warning — which is now one of the ways to fix it.
   */
  const hiddenPanes = $derived.by(() => {
    const panes = draft.indicators.active.filter((active) => paneOf(active) === 'oscillator').length
    const requested = panes + (draft.volume.enabled ? 1 : 0)
    // Matches LAYOUT's cap: three panes on a desktop, one in portrait.
    return Math.max(0, requested - 3)
  })

  /**
   * State lines for the collapsed summaries.
   *
   * These carry the section's own answer, so collapsing costs no information. It
   * matters most for stops: they used to sit permanently visible, and a risk rule you
   * can't see without clicking is worse than one you can.
   */
  const indicatorSummary = $derived(
    draft.indicators.active.length === 0 ? ' — none' : ` — ${draft.indicators.active.length}`
  )

  const stopSummary = $derived.by(() => {
    const active = draft.stops.active
    if (active.length === 0) return ' — none, fully manual'
    const names = active.map((stop) => {
      const name = stopChoices.find((choice) => choice.id === stop.typeId)?.displayName ?? stop.typeId
      return stop.advisory ? `${name} (advisory)` : name
    })
    return ` — ${names.join(', ')}`
  })

  /** Shared by both import blocks, so the sandbox promise is worded once. */
  const SANDBOX_NOTE =
    'Imported code is an ES module that default-exports the contract. It runs in a Web Worker with no DOM, no filesystem, and no access to this app — that sandbox is the only place it ever executes.'

  function defaults(params: ParamSpec[]): Record<string, number> {
    const out: Record<string, number> = {}
    for (const spec of params) {
      if (typeof spec.default === 'number') out[spec.key] = spec.default
    }
    return out
  }

  function reseed(): void {
    // `mintSeed()` rather than a local random: it's the one entropy source in this
    // codebase, and Math.random() is banned repo-wide.
    draft.visuals.worldSeed = mintSeed()
  }

  const NORMALIZATION: { id: NormalizationMode; label: string; note: string }[] = [
    {
      id: 'visible-window-min-max',
      label: 'Fit what’s on screen',
      note: 'The axis rescales to the bars you can see. Most readable.',
    },
    {
      id: 'fixed-price-per-pixel',
      label: 'Fixed scale',
      note: 'One constant price-per-pixel. The axis never moves.',
    },
    {
      id: 'starting-price-relative',
      label: 'Relative to the first bar',
      note: 'Everything measured against the first bar, so the whole run is one scale.',
    },
  ]

  const LAYER_NAMES = ['sky', 'clouds', 'mountains', 'trees', 'ground', 'foreground'] as const

  const dateInput = (epochSeconds: number | undefined): string =>
    epochSeconds === undefined ? '' : new Date(epochSeconds * 1000).toISOString().slice(0, 10)

  function setRange(which: 'from' | 'to', value: string): void {
    // Bars carry epoch SECONDS, so the /1000 is load-bearing in both directions.
    const seconds = value ? Math.floor(new Date(`${value}T00:00:00Z`).getTime() / 1000) : undefined
    const current = draft.data.dateRange
    if (seconds === undefined) {
      // Clearing either end drops the whole range: a half-open range would mean
      // guessing the other bound, and "play it all" is the honest default.
      draft.data.dateRange = undefined
      return
    }
    const from = which === 'from' ? seconds : (current?.from ?? seconds)
    const to = which === 'to' ? seconds : (current?.to ?? seconds)
    draft.data.dateRange = { from, to }
  }

  const activeTicker = $derived(tickers.find((entry) => entry.symbol === draft.data.ticker))

  const seriesSummary = $derived(
    activeTicker === undefined
      ? ' — nothing selected'
      : ` — ${activeTicker.symbol}, ${activeTicker.barCount} bars`
  )

  // ── Series source ──────────────────────────────────────────────────────────────

  const activeSource = $derived(sources.find((entry) => entry.id === draft.data.source))

  /** What to fetch, and from where. Nothing is requested until Download is pressed. */
  let symbolInput = $state('')
  /**
   * Daily, because it's what almost every download wants and what every existing
   * dataset is. Reset by the effect below if the chosen provider can't serve it.
   */
  let intervalInput = $state<BarInterval>(DEFAULT_INTERVAL)
  let providerInput = $state('')

  // Default to the first provider once the list arrives, and recover if the chosen one
  // disappears — a select bound to a value that isn't among its options renders blank.
  $effect(() => {
    const first = providers[0]
    if (!first) return
    if (!providers.some((entry) => entry.id === providerInput)) providerInput = first.id
  })

  /**
   * Keep the chosen ticker inside the chosen source's catalogue.
   *
   * Switching source replaces the whole list, and a `<select>` bound to a value that
   * isn't among its options renders blank while the draft still holds the old symbol —
   * which then fails at run start with a confusing message about a ticker the player
   * can't see. Downloading the first ticker of an empty source lands here too.
   */
  $effect(() => {
    const first = tickers[0]
    if (!first) return
    if (!tickers.some((entry) => entry.symbol === draft.data.ticker)) {
      draft.data.ticker = first.symbol
    }
  })

  /**
   * Intervals the selected provider can actually serve.
   *
   * Filtered rather than greyed out: an option that returns an error body is worse than
   * one that was never offered. Stooq is daily only, so choosing it collapses this to a
   * single entry.
   */
  const offeredIntervals = $derived(
    providers.find((entry) => entry.id === providerInput)?.intervals ?? [DEFAULT_INTERVAL]
  )

  /**
   * Keep the chosen interval one the provider offers.
   *
   * Switching from Yahoo to Stooq while `5m` is selected would otherwise leave a request
   * nobody can answer armed behind a picker showing something else.
   */
  $effect(() => {
    if (!offeredIntervals.includes(intervalInput)) {
      intervalInput = offeredIntervals.includes(DEFAULT_INTERVAL)
        ? DEFAULT_INTERVAL
        : (offeredIntervals[0] ?? DEFAULT_INTERVAL)
    }
  })

  async function downloadTicker(): Promise<void> {
    const wanted = symbolInput.trim()
    if (wanted === '') return
    const meta = await onDownloadTicker(wanted, providerInput, intervalInput)
    if (meta) adopt(meta)
  }

  async function importSeriesFiles(): Promise<void> {
    const imported = await onImportSeriesFiles()
    const first = imported[0]
    if (first) adopt(first)
  }

  /** Select what just arrived: obtaining a series you then have to go and find in a
   * dropdown is a job half done. */
  function adopt(meta: TickerMeta): void {
    draft.data.ticker = meta.symbol
    // A new dataset is a different price path, so a date range narrowing the old one
    // is meaningless against it.
    draft.data.dateRange = undefined
    symbolInput = ''
  }

  /**
   * The motion control's value, from the stored *override* rather than the resolved
   * setting — those differ precisely when the player is following the system, which is
   * the state a checkbox cannot represent.
   */
  const motionChoice = $derived(
    draft.visuals.motionOverride === undefined
      ? 'system'
      : draft.visuals.motionOverride
        ? 'reduced'
        : 'full'
  )

  /** What following the system currently gets you, so the option isn't a mystery. */
  const systemMotionSuffix = $derived(
    draft.visuals.motionOverride === undefined
      ? ` (${draft.visuals.reducedMotion ? 'reduced' : 'full'})`
      : ''
  )

  function setMotionChoice(value: string): void {
    draft.visuals.motionOverride = value === 'system' ? undefined : value === 'reduced'
    // `app/` re-resolves `reducedMotion` from this on preview, so nothing here has to
    // duplicate that decision.
  }

  const percent = (value: number): string =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%`

  /**
   * The host, for labelling a manual-download link.
   *
   * The full chart URL is long enough to wrap over three lines and says nothing the
   * player needs; where the link *goes* is the part worth showing before they click it.
   * Falls back to the whole string rather than throwing on anything unparseable.
   */
  function hostOf(url: string): string {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }
</script>

<div class="screen">
  <header>
    <h1>Settings</h1>
    <div class="header-actions">
      <button class="cancel" onclick={onCancel}>Cancel</button>
      <button class="ok" onclick={() => onCommit(snapshot(draft))}>OK</button>
    </div>
  </header>

  {#if personalBest}
    <p class="best">
      Best for this exact setup: <strong>{percent(personalBest.percentReturn)}</strong>
    </p>
  {/if}

  <!--
    One list per kind, filtered from the same `plugins` prop. A snippet rather than two
    copies: the status text and the remove affordance have to stay identical, and this
    is exactly the duplication that drifts.
  -->
  {#snippet pluginList(kind: 'stop' | 'indicator')}
    {@const listed = plugins.filter((plugin) => plugin.kind === kind)}
    {#if listed.length > 0}
      <ul class="plugins">
        {#each listed as plugin (plugin.name)}
          <li>
            <span class="pname">{plugin.name}</span>
            <span class="pstatus">{plugin.status}</span>
            <button type="button" class="remove" onclick={() => onRemovePlugin(plugin.name)}>
              Remove
            </button>
          </li>
        {/each}
      </ul>
      <p class="note">
        Source text is kept, not a file path — a browser can't re-read a file you
        picked last week. Edit the file on disk and import it again to update it.
      </p>
    {/if}
  {/snippet}

  <div class="columns">

  <!--
    Series is a full-width disclosure rather than a column card, and the first thing on
    the screen, because it owns the one decision the rest of this screen is *about*:
    which prices you're going to trade. It also holds the widest content here — a
    download row, a library list — which reads badly squeezed into a third of the width.

    Open by default, unlike the disclosures below it: those answer "have I changed
    anything?", which a summary line can carry, while this one is where a new player has
    to go first.
  -->
  <details class="advanced" open>
    <summary>Series{seriesSummary}</summary>
    <div class="details-body">
    <div class="pair">
      <label>
        Source
        <select bind:value={draft.data.source}>
          {#each sources as source (source.id)}
            <option value={source.id}>{source.displayName}</option>
          {/each}
        </select>
      </label>

      <label>
        Ticker
        <select bind:value={draft.data.ticker} disabled={tickers.length === 0}>
          {#each tickers as ticker (ticker.symbol)}
            <option value={ticker.symbol}>{ticker.displayName} · {ticker.barCount} bars</option>
          {/each}
        </select>
      </label>
    </div>
    {#if tickers.length === 0}
      <p class="note warn">
        {activeSource?.downloadable
          ? 'Your library is empty — download or import a series below before starting a run.'
          : 'This source is offering nothing to play.'}
      </p>
    {/if}

    <!--
      Download only appears for a source that can do it. The bundled and synthetic
      sources have fixed catalogues, and a disabled field on them would be a control
      that exists to be greyed out.
    -->
    {#if activeSource?.downloadable}
      <div class="import">
        <div class="add-row">
          <input
            type="text"
            placeholder="Symbol, e.g. TSLA"
            spellcheck="false"
            autocapitalize="characters"
            aria-label="Ticker symbol to download"
            bind:value={symbolInput}
            onkeydown={(event) => event.key === 'Enter' && void downloadTicker()}
          />
          <select class="provider" bind:value={intervalInput} aria-label="Bar interval">
            {#each offeredIntervals as interval (interval)}
              <option value={interval}>{intervalName(interval)}</option>
            {/each}
          </select>
          <select class="provider" bind:value={providerInput} aria-label="Download from">
            {#each providers as provider (provider.id)}
              <option value={provider.id}>{provider.displayName}</option>
            {/each}
          </select>
          <button
            type="button"
            class="add"
            disabled={download.busy || symbolInput.trim() === ''}
            onclick={() => void downloadTicker()}
          >
            {download.busy ? 'Working…' : 'Download'}
          </button>
        </div>

        {#if download.busy}
          <p class="note">Fetching {download.symbol ?? 'the series'}…</p>
        {:else if download.error}
          <p class="warn">{download.error}</p>
          {#if download.manualUrl}
            <!-- Opening this in a tab isn't blocked by the rule that stopped the app:
                 CORS governs what script may read, not where a person may navigate.
                 `noreferrer` because the provider has no business knowing this came
                 from a settings panel. -->
            <p class="manual">
              <a href={download.manualUrl} target="_blank" rel="noreferrer noopener">
                Open {hostOf(download.manualUrl)} ↗
              </a>
              <span class="note inline">then save the response and import it below.</span>
            </p>
          {/if}
        {:else if download.notice}
          <p class="note">{download.notice}</p>
        {/if}

        <div class="import-row">
          <button type="button" class="secondary" onclick={() => void importSeriesFiles()}>
            Import CSV or JSON
          </button>
          <span class="note inline">
            One button for both — the format is read from the file, not its name.
          </span>
        </div>

        <p class="note">
          Downloads and imports share one library, keyed by symbol <em>and</em> interval:
          obtaining daily AAPL again replaces it, while weekly AAPL sits beside it as its
          own series. The provider's whole history at that interval is kept and never
          re-fetched at run start, so a series replays identically. Play a shorter window
          with the date range under Advanced.
        </p>

        {#if tickers.length > 0}
          <ul class="plugins">
            {#each tickers as ticker (ticker.symbol)}
              <li>
                <span class="pname">{ticker.symbol}</span>
                <span class="pstatus">
                  {ticker.barCount} bars · {dateInput(ticker.firstBarTime)} to
                  {dateInput(ticker.lastBarTime)}
                </span>
                <span class="row-actions">
                  <!-- Stages the symbol rather than fetching straight away, so the
                       provider about to be used is visible before it happens. -->
                  <button
                    type="button"
                    class="remove"
                    onclick={() => (symbolInput = ticker.symbol)}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    class="remove"
                    onclick={() => void onForgetTicker(ticker.symbol)}
                  >
                    Remove
                  </button>
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <label>
      Scroll speed <span class="value">{draft.scrollSpeed} bars/sec</span>
      <input type="range" min="0.5" max="10" step="0.5" bind:value={draft.scrollSpeed} />
    </label>
    <p class="note">
      Lower is slower and easier to read — it doubles as an accessibility setting.
    </p>
    </div>
  </details>

  <section>
    <h2>Jumper</h2>
    <div class="roster">
      {#each characters as entry (entry.id)}
        <button
          class="pick"
          class:selected={draft.character.selected === entry.id}
          onclick={() => (draft.character.selected = entry.id)}
        >
          <span
            class="swatch"
            style="--body: #{entry.palette.body.toString(16).padStart(6, '0')}; --accent2: #{entry.palette.accent
              .toString(16)
              .padStart(6, '0')}"
          ></span>
          <span class="name">{entry.displayName}</span>
        </button>
      {/each}
    </div>
    <p class="note">
      Purely cosmetic — identical hitbox, physics, and bounce cadence, so your choice
      never affects the score.
    </p>
  </section>

  <section>
    <h2>Capital</h2>
    <label>
      Starting capital <span class="value">${draft.startingCapital.toLocaleString()}</span>
      <input type="range" min="1000" max="100000" step="1000" bind:value={draft.startingCapital} />
    </label>
    <label>
      Per entry <span class="value">
        {Math.round(draft.entrySize * 100)}% · {Math.round(1 / draft.entrySize)} units to full
      </span>
      <input type="range" min="0.05" max="1" step="0.05" bind:value={draft.entrySize} />
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={draft.allowShorting} />
      Allow shorting <span class="note inline">sell while flat opens a short</span>
    </label>
  </section>

  <section>
    <h2>Chart</h2>
    <label>
      Bar style
      <select bind:value={draft.visuals.barStyle}>
        <option value="bollinger">Bollinger bars</option>
        <option value="candlestick">Candlesticks</option>
      </select>
    </label>

    <label class="check">
      <input type="checkbox" bind:checked={draft.volume.enabled} />
      Volume pane
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={draft.hud.showStopLevelOnChart} />
      Draw stop levels on the chart
    </label>
  </section>

  <section>
    <h2>Mood</h2>
    <label>
      Look &amp; sound
      <select value={mood} onchange={(event) => setMood(event.currentTarget.value)}>
        {#each moods as option (option.id)}
          <option value={option.id}>{option.displayName}</option>
        {/each}
        {#if mood === 'mixed'}
          <option value="mixed" disabled>Mixed — set separately below</option>
        {/if}
      </select>
    </label>
    <p class="note">
      One pick sets both the visuals and the music, and the world behind this panel
      changes to match. Every visual is generated at runtime from parameters, so a new
      look is just another set of numbers. A mood may also bring its own background
      track; the rest of the sound is synthesized as you play.
    </p>

    <details>
      <summary>Mix them, or reseed the world</summary>
      <div class="details-body">
        <label>
          Visuals
          <select bind:value={draft.visuals.theme}>
            {#each visualThemes as theme (theme.id)}
              <option value={theme.id}>{theme.displayName}</option>
            {/each}
          </select>
        </label>
        <label>
          Sound
          <select bind:value={draft.audio.theme}>
            {#each audioThemes as theme (theme.id)}
              <option value={theme.id}>{theme.displayName}</option>
            {/each}
          </select>
        </label>
        <label>
          World seed <span class="value">{draft.visuals.worldSeed}</span>
          <input type="number" min="0" step="1" bind:value={draft.visuals.worldSeed} />
        </label>
        <button type="button" class="secondary" onclick={reseed}>New world</button>
        <p class="note">
          The same visual theme and seed always generate an identical world — note
          the number down if you get one you like.
        </p>

        <h3>Background layers</h3>
        {#each LAYER_NAMES as name (name)}
          <label class="check">
            <input type="checkbox" bind:checked={draft.background.layers[name].enabled} />
            {name}
          </label>
        {/each}
        <p class="note">
          Turning layers off is the cheapest way to buy frame rate on a weak device.
        </p>
      </div>
    </details>
  </section>

  <section>
    <h2>Sound</h2>
    <label>
      Master <span class="value">{Math.round(draft.audio.masterVolume * 100)}%</span>
      <input type="range" min="0" max="1" step="0.05" bind:value={draft.audio.masterVolume} />
    </label>
    <label>
      Music <span class="value">{Math.round(draft.audio.musicVolume * 100)}%</span>
      <input type="range" min="0" max="1" step="0.05" bind:value={draft.audio.musicVolume} />
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={draft.audio.musicMuted} />
      Mute music
    </label>
    <label>
      Effects <span class="value">{Math.round(draft.audio.sfxVolume * 100)}%</span>
      <input type="range" min="0" max="1" step="0.05" bind:value={draft.audio.sfxVolume} />
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={draft.audio.sfxMuted} />
      Mute effects
    </label>
    <p class="note">
      Audio only ever duplicates what's already on screen, so the game is fully
      playable silent.
    </p>
  </section>

  <section>
    <h2>Comfort</h2>
    <label>
      P&amp;L colours
      <select bind:value={draft.visuals.pnlPalette}>
        <option value="red-green">Red / green (trading convention)</option>
        <option value="blue-orange">Blue / orange (colourblind-safe)</option>
      </select>
    </label>
    <!--
      Three states rather than a checkbox. The saved value has to be able to say "I
      haven't chosen", because a stored `false` would silently override the operating
      system's own reduced-motion setting — the one preference whose whole purpose is
      to be honoured without being asked again.
    -->
    <label>
      Motion
      <select
        value={motionChoice}
        onchange={(event) => setMotionChoice(event.currentTarget.value)}
      >
        <option value="system">Follow my system setting{systemMotionSuffix}</option>
        <option value="reduced">Reduced</option>
        <option value="full">Full</option>
      </select>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={draft.visuals.screenShake} />
      Screen shake
    </label>
    <p class="note">
      Profit and loss always carry a sign and an arrow as well as a colour, so
      the chart reads correctly whichever palette you pick.
    </p>
  </section>

  <!--
    One collapsible section per plugin kind, each owning that kind end to end: the
    configured instances, and the button to import more of them.

    This replaces a single "Plugins" section that held the import buttons for both
    kinds while the stop *rules* lived in a separate card and the indicators in a
    third place. Splitting by kind rather than by "is it a plugin" means there is one
    place to go per question — "what are my stops" and "what's on my chart" — instead
    of two halves of each answer sitting in different sections.

    Both are collapsed, matching Advanced, but each summary carries a state line so
    the collapsed form still answers its own question without being opened. That
    matters most for stops: they used to be permanently visible, and a risk rule you
    can't see is worse than one you have to click for.
  -->
  <details class="advanced">
    <summary>Stop rules{stopSummary}</summary>
    <div class="details-body">
      <p class="note">
        Committed before the run and not editable during it. An <strong>advisory</strong>
        stop shows its level but never closes for you — that's the version that
        measures your discipline rather than the engine's.
      </p>

      {#each stopChoices as choice (choice.id)}
        {@const active = stopFor(choice.id)}
        <div class="row">
          <label class="check">
            <input
              type="checkbox"
              checked={active !== undefined}
              onchange={(event) => toggleStop(choice, event.currentTarget.checked)}
            />
            {choice.displayName}
            {#if choice.sandboxed}<span class="badge">sandboxed</span>{/if}
          </label>

          {#if active}
            <div class="row-body">
              {#each choice.params as spec (spec.key)}
                <ParamControl
                  {spec}
                  value={active.params[spec.key] ?? (spec.default as number)}
                  onChange={(next) => (active.params[spec.key] = next)}
                />
              {/each}
              <label class="check">
                <input type="checkbox" bind:checked={active.advisory} />
                Advisory <span class="note inline">
                  {active.advisory ? 'you close it yourself' : 'the engine closes it for you'}
                </span>
              </label>
            </div>
          {/if}
        </div>
      {/each}

      {#if draft.stops.active.length === 0}
        <p class="warn">
          No rule committed — fully manual exits. Valid, but the discipline meter
          has nothing to measure and stays dormant.
        </p>
      {/if}

      <div class="import">
        <button type="button" class="secondary" onclick={() => onImportPlugins('stop')}>
          Import stop rule
        </button>
        <p class="note">{SANDBOX_NOTE}</p>
        {@render pluginList('stop')}
      </div>
    </div>
  </details>

  <details class="advanced">
    <summary>Indicators{indicatorSummary}</summary>
    <div class="details-body">
      <!--
        Lists what you have *added*, not what exists to add. An earlier version gave
        every available indicator a permanent block with its own Add button, so the
        section grew with the size of the plugin registry even when nothing was
        configured — a sixth indicator type cost screen space before anyone used it.
      -->
      {#if draft.indicators.active.length === 0}
        <p class="note">
          None yet. A moving average is usually drawn on the chart itself; an
          oscillator usually gets its own pane below — but you can put either
          anywhere.
        </p>
      {/if}

      {#each draft.indicators.active as instance (instance.instanceId)}
        {@const choice = choiceFor(instance.typeId)}
        <details class="instance">
          <summary>
            <span class="swatch" style={`background: ${colourToHex(summaryColour(choice, instance))}`}
            ></span>
            <strong>{choice ? labelFor(choice, instance) : instance.typeId}</strong>
            <span class="note inline">
              {paneOf(instance) === 'overlay' ? 'on chart' : 'own pane'}
            </span>
            {#if choice?.sandboxed}<span class="badge">sandboxed</span>{/if}
            {#if !choice}<span class="note inline">plugin missing</span>{/if}
          </summary>
          <div class="instance-body">
            <!--
              One table per instance: params, where it's drawn, then a row per output.
              A single grid rather than one per group, because two grids size their
              columns independently — the params' boxes and the outputs' dropdowns would
              each line up within their own group and not with each other. Boxes that
              size to their own label read as unrelated controls, and nothing can be
              compared by scanning a column. `ParamControl` contributes cells rather than
              a row of its own; see `inGrid` there.
            -->
            <div class="instance-grid">
              {#if choice}
                {#each choice.params as spec (spec.key)}
                  <ParamControl
                    inGrid
                    {spec}
                    value={instance.params[spec.key] ?? (spec.default as number)}
                    onChange={(next) => (instance.params[spec.key] = next)}
                  />
                {/each}
              {/if}

              <span class="row-label">Draw it</span>
              <select
                class="pane"
                aria-label="Where to draw this indicator"
                value={instance.paneKind ?? ''}
                onchange={(event) => setPaneKind(instance, event.currentTarget.value)}
              >
                <option value="">
                  Default{choice
                    ? ` (${choice.paneKind === 'overlay' ? 'on chart' : 'own pane'})`
                    : ''}
                </option>
                <option value="overlay">On the main chart</option>
                <option value="oscillator">In its own pane</option>
              </select>
              {#if paneOf(instance) === 'overlay' && choice?.paneKind === 'oscillator'}
                <p class="note warn full">
                  On the main chart this is drawn on the <em>price</em> scale, so values
                  that aren't prices will sit squashed against the bottom.
                </p>
              {/if}

              <!--
                One row per output, which is what the chart actually draws.
                A single instance colour could not describe a five-output composite: the
                player had no way to see that three of its outputs are marks, nor to turn
                one off. The style select doubles as the hide control — "Don't draw" is a
                drawing style, and a separate visibility checkbox could contradict it.

                Colour is a named select rather than a bare picker because the names are
                what a screen reader can say and a colourblind player can act on;
                "Custom…" reveals the picker for what eight names can't express.
              -->
              {#if choice && choice.outputs.length > 0}
                <span class="group-label full">Outputs</span>
                {#each choice.outputs as output (output)}
                  {@const style = outputStyle(choice, instance, output)}
                  <span class="output-name" class:hidden={style.draw === 'none'}>{output}</span>
                  <select
                    class="draw"
                    aria-label={`How to draw ${output}`}
                    value={style.draw}
                    onchange={(event) =>
                      setOutputStyle(instance, output, {
                        draw: event.currentTarget.value as IndicatorDrawStyle,
                      })}
                  >
                    {#each DRAW_CHOICES as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>

                  <span class="colour-cell">
                    <select
                      class="colour"
                      aria-label={`Colour for ${output}`}
                      value={indicatorColours.some((colour) => colour.value === style.colour)
                        ? String(style.colour)
                        : 'custom'}
                      disabled={style.draw === 'none'}
                      onchange={(event) => {
                        const value = event.currentTarget.value
                        // "Custom…" stores the colour it is currently showing, so opening
                        // the picker never changes the chart on its own.
                        setOutputStyle(instance, output, {
                          colour: value === 'custom' ? style.colour : Number(value),
                        })
                      }}
                    >
                      {#each indicatorColours as colour (colour.value)}
                        <option value={String(colour.value)}>{colour.name}</option>
                      {/each}
                      <option value="custom">Custom…</option>
                    </select>
                    <input
                      type="color"
                      class="output-colour"
                      aria-label={`Custom colour for ${output}`}
                      value={colourToHex(style.colour)}
                      disabled={style.draw === 'none'}
                      oninput={(event) => {
                        const parsed = colourFromHex(event.currentTarget.value)
                        // Keeps the previous colour rather than falling back to a
                        // default: a value this can't read is half-typed, not a choice.
                        if (parsed !== undefined) {
                          setOutputStyle(instance, output, { colour: parsed })
                        }
                      }}
                    />
                  </span>

                  <span class="reset-cell">
                    {#if hasOutputOverride(instance, output)}
                      <button
                        type="button"
                        class="reset"
                        title={`Back to the ${choice.displayName} default`}
                        onclick={() => resetOutputStyle(instance, output)}
                      >
                        Reset
                      </button>
                    {/if}
                  </span>

                  {#if style.draw !== 'none' && describeColourRisk(style.colour, activePnl)}
                    <!--
                      Reported, never blocked. These are the two failure modes the fixed
                      palette existed to prevent, and a warning respects a deliberate
                      choice where a refusal wouldn't.
                    -->
                    <p class="note warn full">{describeColourRisk(style.colour, activePnl)}</p>
                  {/if}
                {/each}
              {/if}
            </div>

            <button
              type="button"
              class="remove"
              onclick={() => removeIndicator(instance.instanceId)}
            >
              Remove
            </button>
          </div>
        </details>
      {/each}

      <div class="add-row">
        <select bind:value={addTypeId} aria-label="Indicator to add">
          <option value="">Add an indicator…</option>
          {#each indicatorChoices as choice (choice.id)}
            <option value={choice.id}>{choice.displayName}</option>
          {/each}
        </select>
        <button
          type="button"
          class="add"
          disabled={addTypeId === ''}
          onclick={() => addIndicator(addTypeId)}
        >
          + Add
        </button>
      </div>

      {#if hiddenPanes > 0}
        <p class="note warn">
          {hiddenPanes} {hiddenPanes === 1 ? 'pane' : 'panes'} won't fit and won't be drawn —
          three panes on a desktop, one in portrait, and the volume pane takes one of them.
          Remove one, draw it on the main chart instead, or turn off volume.
        </p>
      {/if}

      <div class="import">
        <button type="button" class="secondary" onclick={() => onImportPlugins('indicator')}>
          Import indicator
        </button>
        <p class="note">{SANDBOX_NOTE}</p>
        {@render pluginList('indicator')}
      </div>
    </div>
  </details>

  <details class="advanced">
    <summary>Advanced</summary>
    <div class="details-body">
      <h3>Price scale</h3>
      <label>
        How height maps to price
        <select bind:value={draft.normalizationMode}>
          {#each NORMALIZATION as option (option.id)}
            <option value={option.id}>{option.label}</option>
          {/each}
        </select>
      </label>
      <p class="note">
        {NORMALIZATION.find((option) => option.id === draft.normalizationMode)?.note}
      </p>
      {#if draft.normalizationMode === 'starting-price-relative'}
        <label>
          Reference scale <span class="value">{draft.normalizationReference}</span>
          <input type="number" min="1" step="1" bind:value={draft.normalizationReference} />
        </label>
      {/if}
      <label class="check">
        <input
          type="checkbox"
          checked={draft.priceTransform === 'log10'}
          onchange={(event) =>
            (draft.priceTransform = event.currentTarget.checked ? 'log10' : 'none')}
        />
        Log price <span class="note inline">tames a series with a huge range</span>
      </label>
      <p class="note">
        Only scales that can't see the future are offered. Modes that read the whole
        series would leak the run's high and low through the axis.
      </p>

      <h3>Bars on screen</h3>
      <label>
        Landscape <span class="value">{draft.visibleBarCount.landscape}</span>
        <input type="range" min="20" max="120" step="1" bind:value={draft.visibleBarCount.landscape} />
      </label>
      <label>
        Portrait <span class="value">{draft.visibleBarCount.portrait}</span>
        <input type="range" min="12" max="60" step="1" bind:value={draft.visibleBarCount.portrait} />
      </label>
      <p class="note">
        Resolved once from your orientation at the start and frozen for the run, so
        rotating your phone re-lays out pixels without rescaling the chart.
      </p>

      <h3>Warm-up</h3>
      <!--
        Advanced because of what it costs: preloaded bars come off the front of the
        series, so a run that warms 200 bars is a run 200 bars shorter, scored in its own
        personal-best bucket. Worth it for a long moving average, which otherwise appears
        a minute into a run that only lasts a few.
      -->
      <label>
        Preload bars
        <select
          value={draft.preloadBars === 'auto'
            ? 'auto'
            : draft.preloadBars > 0
              ? 'custom'
              : 'off'}
          onchange={(event) => setPreloadMode(event.currentTarget.value)}
        >
          <option value="off">Off — indicators warm up on screen</option>
          <option value="auto">Automatic — as much as the indicators need</option>
          <option value="custom">A set number of bars</option>
        </select>
      </label>
      {#if draft.preloadBars !== 'auto' && draft.preloadBars > 0}
        <label>
          Bars <span class="value">{draft.preloadBars}</span>
          <input type="range" min="1" max="300" step="1" bind:value={draft.preloadBars} />
        </label>
      {/if}
      <p class="note">
        {draft.preloadBars === 'auto'
          ? 'Reads each active indicator\u2019s own warm-up length, including the ones your stops use. Trimmed if the series is too short to spare them.'
          : draft.preloadBars > 0
            ? 'Fed to indicators and stops before play, never traded and never scored \u2014 but drawn as history, so the run opens with the lines already on the chart.'
            : 'Indicators start blank and fill in as bars arrive \u2014 a 200-bar average has nothing to draw for the first 200 bars.'}
      </p>

      <h3>Scoring</h3>
      <label class="check">
        <input type="checkbox" bind:checked={draft.scoring.streakEnabled} />
        Discipline streak and multiplier
      </label>
      {#if draft.scoring.streakEnabled}
        <label>
          Multiplier cap <span class="value">×{draft.scoring.maxMultiplier}</span>
          <input type="range" min="2" max="10" step="1" bind:value={draft.scoring.maxMultiplier} />
        </label>
      {:else}
        <p class="note">Off means raw profit and loss only — no arcade score, no meter.</p>
      {/if}

      <h3>Controls</h3>
      <label>
        Hold to flatten <span class="value">{draft.flattenHoldMs}ms</span>
        <input type="range" min="150" max="1200" step="50" bind:value={draft.flattenHoldMs} />
      </label>

      <h3>Cost basis</h3>
      <label>
        Method
        <select bind:value={draft.costBasisMethod}>
          <option value="weighted-average">Weighted average</option>
          <option value="fifo" disabled>FIFO — not implemented</option>
        </select>
      </label>

      <h3>Date range</h3>
      <label>
        From
        <input
          type="date"
          value={dateInput(draft.data.dateRange?.from)}
          onchange={(event) => setRange('from', event.currentTarget.value)}
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={dateInput(draft.data.dateRange?.to)}
          onchange={(event) => setRange('to', event.currentTarget.value)}
        />
      </label>
      <p class="note">
        {#if activeTicker}
          {draft.data.ticker} covers {dateInput(activeTicker.firstBarTime)} to
          {dateInput(activeTicker.lastBarTime)}. Leave both blank to play all of it.
        {:else}
          Leave both blank to play the whole series.
        {/if}
      </p>
    </div>
  </details>

  </div>

</div>

<style>
  .screen {
    /* Wide enough for two comfortable columns; the grid below collapses to one
       when it isn't available, which is every phone in portrait. */
    max-width: 1080px;
    margin: 0 auto;
    padding: 20px 24px 72px;
    color: var(--ink);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    /* Sticky, because with two columns the buttons at the bottom can be a long way
       from whatever the player just changed. */
    position: sticky;
    top: 0;
    z-index: 2;
    margin-bottom: 12px;
    padding: 10px 0;
    background: linear-gradient(to bottom, var(--panel-solid) 70%, transparent);
  }
  .header-actions {
    display: flex;
    gap: 8px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.01em;
  }
  /**
   * `auto-fit` with a min track width rather than a hard `1fr 1fr`: on a narrow
   * window or a phone this becomes one column with no media query, and the sections
   * keep their reading order either way.
   *
   * `align-items: start` stops a short section stretching to match a tall neighbour,
   * which would leave a card that's mostly empty padding.
   */
  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 8px;
    align-items: start;
  }
  /* The two disclosures hold wide content and read badly in a half-width column. */
  .columns > .advanced {
    grid-column: 1 / -1;
  }
  /* Side by side while there's room, stacked when there isn't — the same `auto-fit`
     trick as `.columns`, so no media query. */
  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0 16px;
  }
  h2 {
    margin: 26px 0 10px;
    font-size: 12.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
  }
  h3 {
    margin: 20px 0 4px;
    font-size: 12.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--dim);
    opacity: 0.85;
  }
  section,
  .advanced {
    padding: 4px 18px 18px;
    background: var(--panel);
    border: 1px solid var(--edge);
    border-radius: 12px;
    backdrop-filter: blur(8px);
  }
  label {
    display: block;
    margin: 12px 0;
    font-size: 14px;
  }
  label.check {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .value {
    float: right;
    color: var(--dim);
    font-family: ui-monospace, Menlo, monospace;
    font-size: 13px;
  }
  input[type='range'] {
    width: 100%;
    margin-top: 6px;
    accent-color: var(--accent);
  }
  input[type='checkbox'] {
    accent-color: var(--accent);
  }
  select,
  input[type='number'],
  input[type='text'],
  input[type='date'] {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 8px;
    background: var(--field);
    color: inherit;
    border: 1px solid var(--edge);
    border-radius: 6px;
    font-size: 14px;
  }
  input[type='number'] {
    font-family: ui-monospace, Menlo, monospace;
  }
  /* Ticker symbols read as identifiers, and the monospace makes a typo visible. */
  input[type='text'] {
    font-family: ui-monospace, Menlo, monospace;
    text-transform: uppercase;
  }
  .note {
    margin: 4px 0 0;
    color: var(--dim);
    font-size: 12.5px;
    line-height: 1.5;
  }
  .note.inline {
    margin: 0;
  }
  .warn {
    margin: 10px 0 0;
    padding: 10px 12px;
    background: rgba(242, 193, 78, 0.12);
    border-left: 2px solid var(--accent);
    color: var(--ink);
    font-size: 12.5px;
  }
  /* Continues the warning block above it, so the border-left runs unbroken rather than
     reading as a second, unrelated message. */
  .manual {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: baseline;
    margin: 0;
    padding: 0 12px 10px;
    background: rgba(242, 193, 78, 0.12);
    border-left: 2px solid var(--accent);
    font-size: 12.5px;
  }
  .manual a {
    color: var(--accent);
    font-weight: 600;
    /* The URL is long and the label is a host: breaking mid-host is better than a
       horizontal scrollbar on a narrow panel. */
    overflow-wrap: anywhere;
  }
  .row {
    padding: 10px 0;
    border-top: 1px solid var(--edge);
  }
  .row-body {
    padding: 8px 0 4px 26px;
  }
  /*
    One collapsed row per configured indicator. Collapsed by default so the section
    stays scannable with several added — the summary carries the colour and the label,
    which is all you need to confirm a setup at a glance.
  */
  details.instance {
    margin: 5px 0;
    border: 1px solid var(--edge);
    border-radius: 7px;
    background: var(--field);
  }
  details.instance > summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    font-size: 13px;
    color: var(--ink);
    text-transform: none;
    letter-spacing: normal;
  }
  details.instance > summary strong {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
  }
  .instance-body {
    padding: 4px 10px 10px;
  }
  /* The colour in the row header, so a collapsed list still maps to the chart. */
  .swatch {
    flex: none;
    width: 16px;
    height: 4px;
    border-radius: 2px;
  }
  /* Separated from the configured list above it: importing is a different act. */
  .import {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--edge);
  }
  .add-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
  }
  .add-row select,
  .add-row input[type='text'] {
    margin-top: 0;
  }
  .add-row select {
    flex: 1;
  }
  /* The symbol field takes the room. */
  .add-row input[type='text'] {
    flex: 2 1 12ch;
    min-width: 12ch;
  }
  /**
   * `width: auto` is load-bearing: selects are `width: 100%` by default here, and a
   * flex item whose basis is `auto` reads that width — so the provider picker demanded
   * the whole row, and with `flex-shrink: 0` it kept it, squashing the symbol field to
   * nothing and pushing Download off the right edge.
   */
  .add-row select.provider {
    flex: 0 1 auto;
    width: auto;
    max-width: 100%;
  }
  .import-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .import-row .secondary {
    flex: none;
  }
  .row-actions {
    display: flex;
    gap: 6px;
  }
  /**
   * The instance table: label, control, then the style and colour a drawn output adds.
   *
   * Used twice per instance — once for the params, once for the outputs — with the same
   * column definitions, so a box and a dropdown two groups apart still line up. The
   * columns take their content's width rather than stretching, because a row of controls
   * spanning the whole panel reads as separate widgets rather than one labelled thing.
   */
  .instance-grid {
    display: grid;
    grid-template-columns: max-content max-content max-content max-content max-content;
    justify-content: start;
    align-items: center;
    gap: 8px 10px;
    margin: 10px 0;
    font-size: 13.5px;
  }
  /* Column 1 on every row, which is also what starts a new row: auto-placement moves
     down when the explicit column sits behind the cursor. */
  .output-name,
  .row-label {
    grid-column: 1;
  }
  /* A group heading is a row of its own, so it can't be mistaken for a column header. */
  .group-label {
    grid-column: 1 / -1;
    margin-top: 4px;
    font-size: 12px;
    color: var(--dim);
  }
  .output-name {
    grid-column: 1;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 13px;
  }
  /* Dimmed rather than removed: a row that vanished would leave no way back. */
  .output-name.hidden {
    color: var(--dim);
    text-decoration: line-through;
  }
  .colour-cell {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .reset-cell {
    /* Present even when empty, so one row having a Reset can't shift the others. */
    min-width: 6ch;
  }
  /* Spans the grid, because a warning belongs to the row above it, not to a column. */
  .instance-grid .note.full {
    grid-column: 1 / -1;
    margin: 0;
  }
  /**
   * `width: auto` and the margin reset are load-bearing, for the reason already
   * documented on `.add-row select` below: every select in this screen is
   * `display: block; width: 100%` so that a full-width labelled field lines up. A grid
   * item inherits that width and blows its column out to the whole panel, which turned
   * each output into four stacked full-width controls.
   */
  .instance-grid select {
    display: inline-block;
    width: auto;
    margin-top: 0;
    padding: 4px 8px;
    font-size: 13px;
  }
  /* An output's style sits in the same column as a param's box, so every control in the
     instance starts at the same x — the column is as wide as the wider of the two, and
     the box simply doesn't fill it. Putting it one column further right (where a param's
     unit and range live) lined the outputs up with each other but not with the params
     above them, which is the thing worth having. */
  .instance-grid select.draw {
    grid-column: 2;
    min-width: 11ch;
  }
  /* Then colour lands in the unit-and-range column, and its swatch beside it. */
  .instance-grid select.colour {
    min-width: 12ch;
  }
  /* Spans the control and meta columns: "Default (on chart)" is a sentence, not a value,
     and squeezing it into the box column would clip it. */
  .instance-grid select.pane {
    grid-column: 2 / 4;
    min-width: 22ch;
  }
  input[type='color'].output-colour {
    /* 26px stays a touch target on a phone. The padding reset is for Chrome, which
       otherwise insets the swatch inside the control. */
    width: 26px;
    height: 26px;
    padding: 0;
    margin-top: 0;
    border: 2px solid var(--edge);
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }
  input[type='color'].output-colour:disabled {
    cursor: default;
    opacity: 0.4;
  }
  input[type='color'].output-colour::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  input[type='color'].output-colour::-webkit-color-swatch {
    border: 0;
    border-radius: 50%;
  }
  button.reset {
    padding: 3px 8px;
    font-size: 11.5px;
    border: 1px solid var(--edge);
    border-radius: 5px;
    background: transparent;
    color: var(--dim);
    cursor: pointer;
  }
  button.add {
    padding: 5px 12px;
    font-size: 12.5px;
    border: 1px solid var(--edge);
    border-radius: 6px;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
  }
  button.add:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  button.add:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button.remove {
    padding: 4px 10px;
    font-size: 12.5px;
    border: 1px solid var(--edge);
    border-radius: 6px;
    background: transparent;
    color: var(--dim);
    cursor: pointer;
  }
  button.remove:hover {
    border-color: var(--down);
    color: var(--down);
  }
  .note.warn {
    color: var(--down);
  }
  details {
    margin-top: 14px;
  }
  section details {
    border-top: 1px solid var(--edge);
  }
  summary {
    padding: 10px 0;
    color: var(--dim);
    font-size: 13px;
    cursor: pointer;
  }
  .advanced summary {
    font-size: 12.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .details-body {
    padding: 0 0 4px;
  }
  .roster {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px 8px 10px;
    background: var(--field);
    color: var(--ink);
    border: 1px solid var(--edge);
    border-radius: 999px;
    font: inherit;
    font-size: 13.5px;
    cursor: pointer;
  }
  .pick.selected {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--body);
    box-shadow: inset -3px -3px 0 var(--accent2);
  }
  .badge {
    padding: 1px 7px;
    background: var(--field);
    border: 1px solid var(--edge);
    border-radius: 999px;
    color: var(--dim);
    font-size: 11px;
  }
  .plugins {
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }
  .plugins li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid var(--edge);
    font-size: 13px;
  }
  .pname {
    font-family: ui-monospace, Menlo, monospace;
  }
  .pstatus {
    color: var(--dim);
    font-size: 12px;
  }
  .remove {
    padding: 4px 10px;
    background: transparent;
    color: var(--dim);
    border: 1px solid var(--edge);
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .best {
    margin: 0 0 12px;
    color: var(--dim);
    font-size: 13px;
  }
  .ok,
  .cancel {
    padding: 11px 26px;
    border-radius: 8px;
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .ok {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: #10151d;
    font-weight: 600;
  }
  .cancel {
    background: var(--field);
    border: 1px solid var(--edge);
    color: var(--dim);
  }
  .cancel:hover {
    color: var(--ink);
  }
  .secondary {
    margin-top: 10px;
    padding: 8px 12px;
    background: var(--field);
    color: var(--ink);
    border: 1px solid var(--edge);
    border-radius: 6px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
</style>
