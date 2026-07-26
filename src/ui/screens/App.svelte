<script lang="ts">
  /**
   * The screen router.
   *
   * Svelte owns the DOM around the canvas — menus and screens only, never the game
   * world. The rule that keeps this compatible with a 60fps render loop is **no
   * per-frame DOM updates during a run**: while `screen === 'playing'` the only DOM
   * here is the thumb-button layer, which is static for the whole run, and the
   * framework is otherwise idle.
   *
   * The canvas underneath is now *always* live — the game during a run, attract mode
   * between them — so every screen is a translucent panel over a moving world rather
   * than a page with the game hidden behind it.
   */
  import { fade, fly } from 'svelte/transition'
  import type { AppActions, AppState } from '../appState.svelte.js'
  import { uiVars } from '../uiTheme.js'
  import Title from './Title.svelte'
  import Settings from './Settings.svelte'
  import HowTo from './HowTo.svelte'
  import Stats from './Stats.svelte'
  import Results from './Results.svelte'
  import Pause from './Pause.svelte'
  import ThumbControls from '../mobile/ThumbControls.svelte'

  let { state, actions }: { state: AppState; actions: AppActions } = $props()

  /** Menus take their colours from the game's own theme, not their own palette. */
  const vars = $derived(
    uiVars(state.config?.visuals.theme ?? 'jolly', state.config?.visuals.pnlPalette ?? 'red-green')
  )

  /**
   * Transitions are skipped entirely under reduced motion rather than shortened:
   * a fly-in is exactly the kind of incidental movement the OS setting is asking
   * about, and there is nothing here that needs motion to be understood.
   */
  const motion = $derived(state.config?.visuals.reducedMotion !== true)
  const enter = $derived(motion ? { y: 12, duration: 220 } : { y: 0, duration: 0 })
  const leave = $derived(motion ? { duration: 120 } : { duration: 0 })
</script>

<div class="layer" style={vars}>
  {#if state.error}
    <div class="error" transition:fade={leave}>
      <h2>Couldn't start</h2>
      <pre>{state.error}</pre>
      <button onclick={actions.toSettings}>Back to settings</button>
    </div>
  {:else if state.screen === 'title'}
    <div in:fly={enter} out:fade={leave}>
      <Title
        lifetime={state.lifetime}
        personalBest={state.personalBest}
        ticker={state.config?.data.ticker ?? ''}
        onPlay={() => state.config && actions.start(state.config)}
        onSettings={actions.toSettings}
        onSurprise={actions.surprise}
        onHowTo={actions.toHowTo}
        onStats={actions.toStats}
      />
    </div>
  {:else if state.screen === 'howto'}
    <div in:fly={enter} out:fade={leave}>
      <HowTo isTouch={state.isTouch} onBack={actions.toTitle} />
    </div>
  {:else if state.screen === 'stats'}
    <div in:fly={enter} out:fade={leave}>
      <Stats lifetime={state.lifetime} earned={state.badges} onBack={actions.toTitle} />
    </div>
  {:else if state.screen === 'settings' && state.config}
    <div in:fly={enter} out:fade={leave}>
      <Settings
        config={state.config}
        tickers={state.tickers}
        stopChoices={state.stopChoices}
        indicatorChoices={state.indicatorChoices}
        personalBest={state.personalBest}
        plugins={state.plugins}
        onCommit={actions.commitSettings}
        onCancel={actions.cancelSettings}
        onPreview={actions.preview}
        onImportPlugins={actions.importPlugins}
        onRemovePlugin={actions.removePlugin}
      />
    </div>
  {:else if state.screen === 'paused' && state.pauseInfo}
    <div in:fade={leave} out:fade={leave}>
      <Pause
        buyingPower={state.pauseInfo.buyingPower}
        startingCapital={state.pauseInfo.startingCapital}
        ticker={state.pauseInfo.ticker}
        date={state.pauseInfo.date}
        progress={state.pauseInfo.progress}
        onResume={actions.resume}
        onRestart={actions.restart}
        onEndRun={actions.endRun}
        onAbandon={actions.abandon}
      />
    </div>
  {:else if state.screen === 'results' && state.outcome}
    <div in:fly={enter} out:fade={leave}>
      <Results
        summary={state.outcome.summary}
        percentReturn={state.outcome.percentReturn}
        arcadeScore={state.outcome.arcadeScore}
        streak={state.outcome.longestStreak}
        streakResets={state.outcome.streakResets}
        meter={state.outcome.meter}
        endedEarly={state.outcome.endedEarly}
        isPersonalBest={state.outcome.isPersonalBest}
        personalBest={state.outcome.personalBest}
        newBadges={state.outcome.newBadges}
        onAgain={actions.runAgain}
        onSettings={actions.toSettings}
        onTitle={actions.toTitle}
      />
    </div>
  {/if}

  <!-- Only while playing, only on a touch device: on a desktop these would be
       clutter over the chart, and the keyboard is the better control there. -->
  {#if state.screen === 'playing' && state.isTouch && state.touch}
    <ThumbControls touch={state.touch} />
  {/if}

  {#if state.notice}
    <div class="notice" role="alert" transition:fly={{ y: -10, duration: motion ? 200 : 0 }}>
      <p>{state.notice}</p>
      <button onclick={actions.dismissNotice}>Dismiss</button>
    </div>
  {/if}
</div>

<style>
  .layer {
    /* Every screen scrolls independently of the canvas below it. */
    height: 100%;
    overflow-y: auto;
  }
  .error {
    max-width: 620px;
    margin: 0 auto;
    padding: 40px 24px;
    color: var(--ink);
  }
  .error h2 {
    margin: 0 0 12px;
    font-size: 20px;
  }
  .error pre {
    margin: 0 0 20px;
    padding: 14px 16px;
    background: var(--panel);
    border: 1px solid var(--edge);
    border-left: 2px solid var(--down);
    border-radius: 8px;
    color: var(--dim);
    font: 12.5px/1.6 ui-monospace, Menlo, monospace;
    white-space: pre-wrap;
  }
  .error button,
  .notice button {
    padding: 10px 16px;
    background: var(--panel);
    color: var(--ink);
    border: 1px solid var(--edge);
    border-radius: 8px;
    font: inherit;
    font-size: 13.5px;
    cursor: pointer;
  }
  /**
   * A stop plugin dying mid-run silently removes risk protection, so the notice is
   * pinned top-centre over the run rather than queued for the results screen.
   */
  .notice {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: min(560px, calc(100% - 24px));
    padding: 12px 14px;
    background: var(--panel-solid);
    border: 1px solid var(--down);
    border-radius: 10px;
    color: var(--ink);
    font-size: 13px;
    line-height: 1.5;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  }
  .notice p {
    margin: 0;
  }
</style>
