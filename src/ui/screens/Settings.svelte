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
  import type { ParamSpec, TickerMeta } from '@shared/contracts/index.js'
  import { instanceLabel } from '@shared/contracts/index.js'
  import { mintSeed } from '@shared/math/index.js'
  import { audioThemes } from '@content/audioThemes/index.js'
  import { visualThemes } from '@content/visualThemes/index.js'
  import { characters } from '@content/characters/index.js'
  import { INDICATOR_COLOURS, nextIndicatorColour } from '@shared/palette/index.js'
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
  }

  let {
    config,
    tickers,
    stopChoices,
    indicatorChoices,
    personalBest,
    plugins,
    onCommit,
    onCancel,
    onPreview,
    onImportPlugins,
    onRemovePlugin,
  }: {
    config: RunConfig
    tickers: TickerMeta[]
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
  } = $props()

  /** Local working copy: nothing is committed until Start. */
  // Capturing the initial value is the point: the draft must not track the prop.
  // svelte-ignore state_referenced_locally
  let draft = $state<RunConfig>(snapshot(config))

  /**
   * Push the draft to `app/` whenever something *audible or visible* changes, so
   * mood, runner, and volume all take effect while you're still deciding rather than
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

  /** `0xffd166` → `#ffd166`, for a style attribute. */
  const cssColour = (value: number): string => `#${value.toString(16).padStart(6, '0')}`

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

  /** `''` from the select means "no override", not a third kind. */
  function setPaneKind(active: IndicatorInstanceConfig, value: string): void {
    active.paneKind = value === 'overlay' || value === 'oscillator' ? value : undefined
  }

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
      note: 'Everything measured against day one, so the whole run is one scale.',
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

  const percent = (value: number): string =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%`
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

  <section>
    <h2>Series</h2>
    <label>
      Ticker
      <select bind:value={draft.data.ticker}>
        {#each tickers as ticker (ticker.symbol)}
          <option value={ticker.symbol}>{ticker.displayName} · {ticker.barCount} bars</option>
        {/each}
      </select>
    </label>

    <label>
      Scroll speed <span class="value">{draft.scrollSpeed} bars/sec</span>
      <input type="range" min="0.5" max="10" step="0.5" bind:value={draft.scrollSpeed} />
    </label>
    <p class="note">
      Lower is slower and easier to read — it doubles as an accessibility setting.
    </p>
  </section>

  <section>
    <h2>Runner</h2>
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
        <option value="theme">Match the mood</option>
        <option value="candlestick">Candlesticks</option>
        <option value="bollinger">Bollinger bars</option>
      </select>
    </label>
    <p class="note">
      Both show the same four prices — open, high, low, close. Bollinger bars draw one
      uniform column with the open-to-close section picked out in colour; candlesticks
      draw a narrow wick through a wider body. Every mood ships as Bollinger bars, so
      "Match the mood" and "Bollinger bars" currently agree.
    </p>

    <label class="check">
      <input type="checkbox" bind:checked={draft.volume.enabled} />
      Volume pane
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={draft.hud.showStopLevelOnChart} />
      Draw stop levels on the chart
    </label>
    <p class="note">
      Indicators and the volume pane don't change your personal-best bucket — turning
      on a helpful overlay shouldn't orphan your history.
    </p>
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
      changes to match. Everything is generated at runtime from parameters — there
      are no art or audio files, so a new mood is just another set of numbers.
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
    <label class="check">
      <input type="checkbox" bind:checked={draft.visuals.reducedMotion} />
      Reduced motion
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={draft.visuals.screenShake} />
      Screen shake
    </label>
    <p class="note">
      Profit and loss always carry a sign and an arrow as well as a colour, so
      the chart reads correctly whichever palette you pick.
    </p>
    <p class="note">
      None of these affect your personal-best bucket — comfort settings are
      excluded from the run fingerprint on purpose.
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
            <span class="swatch" style={`background: ${cssColour(instance.colour)}`}></span>
            <strong>{choice ? labelFor(choice, instance) : instance.typeId}</strong>
            <span class="note inline">
              {paneOf(instance) === 'overlay' ? 'on chart' : 'own pane'}
            </span>
            {#if choice?.sandboxed}<span class="badge">sandboxed</span>{/if}
            {#if !choice}<span class="note inline">plugin missing</span>{/if}
          </summary>
          <div class="instance-body">
            {#if choice}
              {#each choice.params as spec (spec.key)}
                <ParamControl
                  {spec}
                  value={instance.params[spec.key] ?? (spec.default as number)}
                  onChange={(next) => (instance.params[spec.key] = next)}
                />
              {/each}
            {/if}

            <label>
              Draw it
              <select
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
            </label>
            {#if paneOf(instance) === 'overlay' && choice?.paneKind === 'oscillator'}
              <p class="note warn">
                On the main chart this is drawn on the <em>price</em> scale, so values
                that aren't prices will sit squashed against the bottom.
              </p>
            {/if}

            <fieldset class="palette">
              <legend>Line colour</legend>
              {#each indicatorColours as colour (colour.value)}
                <button
                  type="button"
                  class="chip"
                  class:selected={instance.colour === colour.value}
                  style={`background: ${cssColour(colour.value)}`}
                  title={colour.name}
                  aria-label={colour.name}
                  aria-pressed={instance.colour === colour.value}
                  onclick={() => (instance.colour = colour.value)}
                ></button>
              {/each}
            </fieldset>
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
    gap: 8px;
    align-items: center;
    margin-top: 10px;
  }
  .add-row select {
    flex: 1;
  }
  fieldset.palette {
    margin: 10px 0 8px;
    padding: 0;
    border: 0;
  }
  fieldset.palette legend {
    padding: 0 0 5px;
    font-size: 12px;
    color: var(--dim);
  }
  button.chip {
    /* 26px rather than a hairline swatch: this is a touch target on a phone. */
    width: 26px;
    height: 26px;
    margin: 0 6px 0 0;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
  }
  button.chip.selected {
    /* Ring plus inset gap, so the selection survives being the same hue as the ring. */
    border-color: var(--ink);
    box-shadow: 0 0 0 2px var(--panel-solid) inset;
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
