<script lang="ts">
  /**
   * The results screen.
   *
   * The single highest-leverage addition in docs/game-feel.md: it turns each run
   * into a session with a resolution, which is what makes a player want to run it
   * again.
   *
   * Two reporting rules matter here. **Force-closed campaigns are counted
   * separately** — a position closed because the data ran out is neither a player
   * decision nor a stop, and folding it into win rate would quietly distort the
   * stat. And **raw P&L is the headline**, with the arcade score beside it.
   */
  import type { Summary } from '@engine/scoring/stats.js'
  import { unlocks } from '@content/progression/index.js'

  let {
    summary,
    percentReturn,
    arcadeScore,
    streak,
    streakResets,
    meter,
    endedEarly,
    isPersonalBest,
    personalBest,
    unlocked,
    onAgain,
    onSettings,
    onTitle,
  }: {
    summary: Summary
    percentReturn: number
    arcadeScore: number
    streak: number
    streakResets: number
    meter: 'live' | 'automated' | 'dormant'
    endedEarly: boolean
    isPersonalBest: boolean
    personalBest: number | undefined
    /** Ids crossed by *this* run, so they can be announced once. */
    unlocked: readonly string[]
    onAgain: () => void
    onSettings: () => void
    onTitle: () => void
  } = $props()

  const earned = $derived(unlocks.filter((unlock) => unlocked.includes(unlock.id)))

  const money = (value: number): string =>
    `${value > 0 ? '▲ +' : value < 0 ? '▼ −' : '· '}$${Math.abs(value).toFixed(2)}`
  const pct = (value: number): string =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%`
</script>

<div class="screen">
  <h1>Run complete</h1>
  {#if endedEarly}
    <p class="flag">Ended early — recorded and eligible for a best, but marked.</p>
  {/if}

  <div class="headline">
    <div class="pnl" class:up={summary.realized > 0} class:down={summary.realized < 0}>
      {money(summary.realized)}
    </div>
    <div class="pct">{pct(percentReturn)} on starting capital</div>
    {#if isPersonalBest}
      <div class="badge">New best for this setup</div>
    {:else if personalBest !== undefined}
      <div class="badge dim">Best for this setup: {pct(personalBest)}</div>
    {/if}
  </div>

  <h2>Judgement</h2>
  <dl>
    <div><dt>Campaigns</dt><dd>{summary.campaigns}</dd></div>
    <div>
      <dt>Win rate</dt>
      <dd>{(summary.winRate * 100).toFixed(0)}% <span class="dim">({summary.wins}W / {summary.losses}L)</span></dd>
    </div>
    <div><dt>Average win</dt><dd>{money(summary.averageWin)}</dd></div>
    <div><dt>Average loss</dt><dd>{money(summary.averageLoss)}</dd></div>
    <div><dt>Biggest win</dt><dd>{money(summary.biggestWin)}</dd></div>
    <div><dt>Biggest loss</dt><dd>{money(summary.biggestLoss)}</dd></div>
  </dl>
  <p class="note">
    Win rate is per <strong>campaign</strong> — one flat-to-flat cycle — because
    "was this position a good idea" is a question about the whole campaign, not
    about each press within it.
  </p>

  <h2>Execution</h2>
  <dl>
    <div><dt>Close events</dt><dd>{summary.closeEvents}</dd></div>
    <div><dt>Ended by a stop</dt><dd>{summary.stoppedOutCampaigns}</dd></div>
    <div><dt>Closed with flatten</dt><dd>{summary.flattenedCampaigns}</dd></div>
    {#if summary.forceClosedCampaigns > 0}
      <div>
        <dt>Force-closed</dt>
        <dd>{summary.forceClosedCampaigns} <span class="dim">excluded from win rate</span></dd>
      </div>
    {/if}
  </dl>

  <h2>Discipline</h2>
  {#if meter === 'dormant'}
    <p class="note">
      No risk rule was committed, so there was no discipline to measure. Add an
      advisory stop next run and the meter becomes the real scoreboard.
    </p>
  {:else}
    <dl>
      <div><dt>Longest compliant streak</dt><dd>{streak}</dd></div>
      <div><dt>Times you ignored your own rule</dt><dd>{streakResets}</dd></div>
      <div><dt>Arcade score</dt><dd>{money(arcadeScore)}</dd></div>
    </dl>
    {#if meter === 'automated'}
      <p class="note">
        Your stops were enforcing, so the engine did the exiting — the streak
        couldn't be lost. Switch one to advisory to measure yourself instead.
      </p>
    {:else}
      <p class="note">
        A loss you took because your own rule said to exit builds this streak
        exactly as a win does. Only ignoring a breached level breaks it.
      </p>
    {/if}
  {/if}

  {#if earned.length > 0}
    <h2>Unlocked</h2>
    <ul class="unlocks">
      {#each earned as unlock (unlock.id)}
        <li><strong>{unlock.displayName}</strong> — {unlock.requirement}</li>
      {/each}
    </ul>
  {/if}

  <div class="actions">
    <button class="primary" onclick={onAgain}>Run again</button>
    <button onclick={onSettings}>Change settings</button>
    <button onclick={onTitle}>Title</button>
  </div>
</div>

<style>
  .screen {
    max-width: 560px;
    margin: 0 auto;
    padding: 40px 24px 64px;
    color: var(--ink);
  }
  h1 {
    margin: 0 0 4px;
    font-size: 24px;
  }
  h2 {
    margin: 28px 0 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
  }
  .headline {
    margin: 20px 0 8px;
    padding: 18px;
    background: var(--panel);
    border: 1px solid var(--edge);
    border-radius: 12px;
    backdrop-filter: blur(8px);
  }
  .pnl {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 30px;
  }
  /* Colour is the third channel only: the arrow and the sign already carry it. */
  .pnl.up {
    color: var(--up);
  }
  .pnl.down {
    color: var(--down);
  }
  .pct {
    margin-top: 4px;
    color: var(--dim);
    font-size: 14px;
  }
  .badge {
    display: inline-block;
    margin-top: 12px;
    padding: 4px 10px;
    background: var(--accent);
    color: #10151d;
    border-radius: 999px;
    font-size: 12px;
  }
  .badge.dim {
    background: var(--field);
    color: var(--dim);
  }
  .flag {
    margin: 8px 0 0;
    color: var(--accent);
    font-size: 12.5px;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 2px;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--edge);
    font-size: 14px;
  }
  dt {
    color: var(--dim);
  }
  dd {
    margin: 0;
    font-family: ui-monospace, Menlo, monospace;
  }
  .dim {
    color: var(--dim);
    font-size: 12px;
    opacity: 0.8;
  }
  .note {
    margin: 10px 0 0;
    color: var(--dim);
    font-size: 12.5px;
    line-height: 1.55;
  }
  .unlocks {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .unlocks li {
    padding: 8px 12px;
    margin-bottom: 4px;
    background: var(--panel);
    border: 1px solid var(--accent);
    border-radius: 8px;
    color: var(--dim);
    font-size: 13px;
  }
  .unlocks strong {
    color: var(--ink);
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 32px;
  }
  button {
    flex: 1;
    padding: 12px;
    background: var(--panel);
    color: var(--ink);
    border: 1px solid var(--edge);
    border-radius: 8px;
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  button.primary {
    flex: 2;
    background: var(--accent);
    border-color: var(--accent);
    color: #10151d;
    font-weight: 600;
  }
</style>
