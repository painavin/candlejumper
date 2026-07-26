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
   */
  import type {
    IndicatorInstanceConfig,
    NormalizationMode,
    RunConfig,
    StopInstanceConfig,
  } from '@config/index.js'
  import type { ParamSpec, TickerMeta } from '@shared/contracts/index.js'
  import { mintSeed } from '@shared/math/index.js'
  import { audioThemes } from '@content/audioThemes/index.js'
  import { visualThemes } from '@content/visualThemes/index.js'
  import { characters } from '@content/characters/index.js'
  import { isUnlocked } from '@content/progression/index.js'
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
  }

  let {
    config,
    tickers,
    stopChoices,
    indicatorChoices,
    unlocked,
    personalBest,
    plugins,
    onStart,
    onPreview,
    onBack,
    onImportPlugins,
    onRemovePlugin,
  }: {
    config: RunConfig
    tickers: TickerMeta[]
    stopChoices: Choice[]
    indicatorChoices: IndicatorChoice[]
    unlocked: readonly string[]
    personalBest: { percentReturn: number; arcadeScore: number } | undefined
    plugins: { name: string; kind: 'stop' | 'indicator'; status: string }[]
    onStart: (config: RunConfig) => void
    onPreview: (config: RunConfig) => void
    onBack: () => void
    onImportPlugins: (kind: 'stop' | 'indicator') => void
    onRemovePlugin: (name: string) => void
  } = $props()

  /** Local working copy: nothing is committed until Start. */
  // Capturing the initial value is the point: the draft must not track the prop.
  // svelte-ignore state_referenced_locally
  let draft = $state<RunConfig>(snapshot(config))

  /**
   * Restart the attract-mode backdrop when a *visible* choice changes, so picking a
   * mood or a runner shows you the result immediately instead of after you commit.
   *
   * The `untrack` is load-bearing. `$state.snapshot` reads every field of the draft,
   * so snapshotting inside a tracked effect would subscribe to all of them — and the
   * carefully chosen key list below would do nothing, rebuilding the Pixi scene on
   * every drag of a capital slider.
   */
  $effect(() => {
    // Read exactly the settings the backdrop can show. These are the dependencies.
    const key = [
      draft.visuals.theme,
      draft.visuals.worldSeed,
      draft.character.selected,
      draft.data.source,
      draft.data.ticker,
      draft.visibleBarCount.landscape,
      draft.visibleBarCount.portrait,
      draft.scrollSpeed,
      draft.normalizationMode,
      draft.priceTransform,
      draft.volume.enabled,
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

  const indicatorFor = (id: string): IndicatorInstanceConfig | undefined =>
    draft.indicators.active.find((active) => active.typeId === id)

  function toggleIndicator(choice: IndicatorChoice, enabled: boolean): void {
    if (enabled) {
      draft.indicators.active = [
        ...draft.indicators.active,
        {
          typeId: choice.id,
          params: defaults(choice.params),
          // One instance per type from this screen. The engine supports several of
          // the same indicator at different lengths; adding that UI needs an
          // add/remove list rather than a checkbox, and can wait for a second
          // indicator to exist.
          instanceId: `${choice.id}-1`,
        },
      ]
    } else {
      draft.indicators.active = draft.indicators.active.filter(
        (active) => active.typeId !== choice.id
      )
    }
  }

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
    <button class="back" onclick={onBack}>← Title</button>
    <h1>Set up your run</h1>
  </header>

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
        {@const locked = !isUnlocked(`character:${entry.id}`, unlocked)}
        <button
          class="pick"
          class:selected={draft.character.selected === entry.id}
          class:locked
          disabled={locked}
          onclick={() => (draft.character.selected = entry.id)}
        >
          <span
            class="swatch"
            style="--body: #{entry.palette.body.toString(16).padStart(6, '0')}; --accent2: #{entry.palette.accent
              .toString(16)
              .padStart(6, '0')}"
          ></span>
          <span class="name">{entry.displayName}</span>
          {#if locked}<span class="lock">Locked</span>{/if}
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
    <h2>Risk rules</h2>
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
  </section>

  <section>
    <h2>Chart</h2>
    {#each indicatorChoices as choice (choice.id)}
      {@const active = indicatorFor(choice.id)}
      <div class="row">
        <label class="check">
          <input
            type="checkbox"
            checked={active !== undefined}
            onchange={(event) => toggleIndicator(choice, event.currentTarget.checked)}
          />
          {choice.displayName}
          {#if choice.sandboxed}<span class="badge">sandboxed</span>{/if}
          <span class="note inline">
            {choice.paneKind === 'overlay' ? 'drawn on the chart' : 'its own pane below'}
          </span>
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
          </div>
        {/if}
      </div>
    {/each}

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
          {@const locked = !isUnlocked(`theme:${option.id}`, unlocked)}
          <option value={option.id} disabled={locked}>
            {option.displayName}{locked ? ' — locked' : ''}
          </option>
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
              <option value={theme.id} disabled={!isUnlocked(`theme:${theme.id}`, unlocked)}>
                {theme.displayName}
              </option>
            {/each}
          </select>
        </label>
        <label>
          Sound
          <select bind:value={draft.audio.theme}>
            {#each audioThemes as theme (theme.id)}
              <option value={theme.id} disabled={!isUnlocked(`theme:${theme.id}`, unlocked)}>
                {theme.displayName}
              </option>
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

  <details class="advanced">
    <summary>Plugins</summary>
    <div class="details-body">
      <p class="note">
        Your own stop rules and indicators, as ES modules that default-export the
        contract. They run in a <strong>Web Worker</strong> with no DOM, no
        filesystem, and no access to this app — that sandbox is the only place
        imported code ever executes.
      </p>
      <div class="pair">
        <button type="button" class="secondary" onclick={() => onImportPlugins('stop')}>
          Import stop rule
        </button>
        <button type="button" class="secondary" onclick={() => onImportPlugins('indicator')}>
          Import indicator
        </button>
      </div>

      {#if plugins.length > 0}
        <ul class="plugins">
          {#each plugins as plugin (plugin.name)}
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

  {#if personalBest}
    <p class="best">
      Best for this exact setup: <strong>{percent(personalBest.percentReturn)}</strong>
    </p>
  {/if}

  <button class="start" onclick={() => onStart(snapshot(draft))}>Start run</button>
</div>

<style>
  .screen {
    max-width: 640px;
    margin: 0 auto;
    padding: 28px 24px 72px;
    color: var(--ink);
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.01em;
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
    margin-bottom: 8px;
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
  .pick.locked {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--body);
    box-shadow: inset -3px -3px 0 var(--accent2);
  }
  .lock {
    color: var(--dim);
    font-size: 11.5px;
  }
  .badge {
    padding: 1px 7px;
    background: var(--field);
    border: 1px solid var(--edge);
    border-radius: 999px;
    color: var(--dim);
    font-size: 11px;
  }
  .pair {
    display: flex;
    gap: 8px;
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
    margin-top: 20px;
    color: var(--dim);
    font-size: 13px;
  }
  .back {
    padding: 9px 14px;
    background: var(--field);
    color: var(--ink);
    border: 1px solid var(--edge);
    border-radius: 8px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
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
  .start {
    display: block;
    width: 100%;
    margin-top: 24px;
    padding: 15px;
    background: var(--accent);
    color: #10151d;
    border: 0;
    border-radius: 10px;
    font: inherit;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
