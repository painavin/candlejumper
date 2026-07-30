<script lang="ts">
  /**
   * The title screen.
   *
   * This is the first thing anyone sees, and it sits *in front of* attract mode —
   * the real render loop, playing itself with input disabled — so the game is
   * visibly a game before a single setting is touched. docs/game-feel.md calls that
   * "one of the cheapest 'this is a real game' signals available", and it was the
   * missing piece that made the old landing screen read as a web form.
   *
   * Nothing here updates per frame: the canvas underneath does the moving.
   *
   * **Play starts a run**, it does not open settings. Settings is its own screen
   * behind its own button — a title screen whose primary action is a configuration
   * form asks the player to make eleven decisions before they know what the game is,
   * and the shipped defaults are a perfectly good first run.
   */
  import { nextUnlock } from '@content/progression/index.js'
  import type { UnlockContext } from '@content/progression/types.js'

  let {
    lifetime,
    personalBest,
    ticker,
    onPlay,
    onSettings,
    onSurprise,
    onHowTo,
    onStats,
  }: {
    lifetime: UnlockContext['lifetime'] | undefined
    personalBest: { percentReturn: number; arcadeScore: number } | undefined
    /** What Play will run, so the button isn't a mystery. */
    ticker: string
    onPlay: () => void
    onSettings: () => void
    onSurprise: () => void
    onHowTo: () => void
    onStats: () => void
  } = $props()

  const goal = $derived(lifetime ? nextUnlock({ lifetime }) : undefined)
</script>

<div class="title">
  <div class="mark">
    <!-- The logo is four poles and a jumper: drawn, not an asset, like everything
         else here. Four bars is the smallest count that reads as a chart. -->
    <svg viewBox="0 0 120 48" aria-hidden="true">
      <rect x="4" y="26" width="10" height="22" rx="3" />
      <rect x="20" y="14" width="10" height="34" rx="3" />
      <rect x="36" y="20" width="10" height="28" rx="3" />
      <rect x="52" y="6" width="10" height="42" rx="3" class="lead" />
      <circle cx="80" cy="14" r="9" class="jumper" />
      <path d="M92 20 L104 14 L92 8 Z" class="jumper" />
    </svg>
  </div>

  <h1>Candle Jumper</h1>
  <p class="tagline">Two buttons. Real prices. No way to die — only to trade badly.</p>

  <div class="actions">
    <button class="primary" onclick={onPlay}>Play <span class="hint">{ticker}</span></button>
    <button onclick={onSurprise}>Surprise me <span class="hint">random slice</span></button>
  </div>
  <div class="actions secondary">
    <button onclick={onSettings}>Settings</button>
    <button onclick={onHowTo}>How to play</button>
    <button onclick={onStats}>Record</button>
  </div>

  <footer>
    {#if personalBest}
      <span>Best on your last setup <strong>{personalBest.percentReturn.toFixed(1)}%</strong></span>
    {/if}
    {#if goal}
      <span class="goal">Next badge — {goal.requirement}</span>
    {:else if lifetime && lifetime.runs > 0}
      <span class="goal">Every badge earned.</span>
    {/if}
  </footer>
</div>

<style>
  .title {
    /* Anchored low-left rather than centred: the character rides at 75% width and
       the poles are on the left, so centred text would sit on top of the action. */
    position: fixed;
    inset: auto auto 0 0;
    width: min(520px, 100%);
    padding: 48px 32px 40px;
    background: linear-gradient(to top, var(--scrim), transparent);
    color: var(--ink);
  }
  .mark svg {
    width: 120px;
    height: 48px;
    fill: var(--down);
    opacity: 0.9;
  }
  .mark :global(.lead) {
    fill: var(--accent);
  }
  .mark :global(.jumper) {
    fill: var(--ink);
  }
  h1 {
    margin: 8px 0 0;
    font-size: clamp(34px, 7vw, 52px);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1;
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.55);
  }
  .tagline {
    margin: 10px 0 26px;
    max-width: 34ch;
    color: var(--dim);
    font-size: 14.5px;
    line-height: 1.5;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  button {
    padding: 13px 20px;
    background: var(--panel);
    color: var(--ink);
    border: 1px solid var(--edge);
    border-radius: 10px;
    font: inherit;
    font-size: 15px;
    cursor: pointer;
    backdrop-filter: blur(6px);
  }
  button:hover {
    border-color: var(--accent);
  }
  .actions.secondary {
    margin-top: 8px;
  }
  .actions.secondary button {
    padding: 9px 14px;
    font-size: 13.5px;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    /* The accent is a light colour in both themes, so the label goes dark. */
    color: #10151d;
    font-weight: 600;
    padding-inline: 28px;
  }
  .hint {
    color: var(--dim);
    font-size: 12.5px;
  }
  .primary .hint {
    color: inherit;
    opacity: 0.7;
  }
  footer {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 22px;
    color: var(--dim);
    font-size: 12.5px;
  }
  .goal {
    color: var(--accent);
    opacity: 0.85;
  }
</style>
