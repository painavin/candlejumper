<script lang="ts">
  /**
   * The record: lifetime totals and unlock progress.
   *
   * These numbers were being accumulated on every run and shown nowhere, which made
   * the whole `lifetime` block in the save file dead weight. docs/game-feel.md asks
   * for "lifetime win rate / avg win vs avg loss" as a habit mirror — the point of
   * showing them is that a player can see their own pattern across runs, which one
   * results screen can't reveal.
   *
   * Clean runs are given top billing over profit deliberately. This is the number
   * the game is actually about.
   */
  import { unlocks } from '@content/progression/index.js'
  import type { UnlockContext } from '@content/progression/types.js'

  let {
    lifetime,
    earned,
    onBack,
  }: {
    lifetime: UnlockContext['lifetime'] | undefined
    earned: readonly string[]
    onBack: () => void
  } = $props()

  const stats = $derived(lifetime)
  const winRate = $derived(
    stats && stats.campaigns > 0 ? Math.round((stats.wins / stats.campaigns) * 100) : undefined
  )
  const cleanRate = $derived(
    stats && stats.runs > 0 ? Math.round((stats.cleanRuns / stats.runs) * 100) : undefined
  )
  const money = (value: number): string =>
    `${value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
</script>

<div class="screen">
  <header>
    <button class="back" onclick={onBack}>← Back</button>
    <h1>Your record</h1>
  </header>

  {#if !stats || stats.runs === 0}
    <p class="empty">
      Nothing recorded yet. Finish a run and this fills in — every run counts except
      the ones you restart or abandon.
    </p>
  {:else}
    <div class="grid">
      <div class="cell wide">
        <span class="label">Clean runs <em>no rule broken</em></span>
        <span class="big">{stats.cleanRuns}<em>/{stats.runs}</em></span>
        {#if cleanRate !== undefined}
          <span class="sub">{cleanRate}% of your runs</span>
        {/if}
      </div>
      <div class="cell">
        <span class="label">Best streak</span>
        <span class="big">{stats.bestStreak}</span>
      </div>
      <div class="cell">
        <span class="label">Rules broken</span>
        <span class="big">{stats.streakResets}</span>
      </div>
      <div class="cell">
        <span class="label">Trades closed</span>
        <span class="big">{stats.campaigns}</span>
      </div>
      <div class="cell">
        <span class="label">Win rate</span>
        <span class="big">{winRate === undefined ? '—' : `${winRate}%`}</span>
        <span class="sub">{stats.wins} of {stats.campaigns}</span>
      </div>
      <div class="cell wide">
        <span class="label">Lifetime realized</span>
        <span class="big" class:up={stats.realized > 0} class:down={stats.realized < 0}>
          {money(stats.realized)}
        </span>
        <span class="sub">Across every recorded run, at every capital setting</span>
      </div>
    </div>
  {/if}

  <h2>Unlocks</h2>
  <ul>
    {#each unlocks as unlock (unlock.id)}
      {@const got = earned.includes(unlock.id)}
      <li class:got>
        <span class="tick">{got ? '✓' : '○'}</span>
        <span class="name">{unlock.displayName}</span>
        <span class="req">{unlock.requirement}</span>
      </li>
    {/each}
  </ul>
  <p class="note">
    Everything unlockable is cosmetic. Nothing here changes how the game plays —
    locking a mechanic behind a grind would make it worse at teaching.
  </p>
</div>

<style>
  .screen {
    max-width: 620px;
    margin: 0 auto;
    padding: 28px 24px 64px;
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
    margin: 30px 0 10px;
    font-size: 12.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
  }
  .empty {
    margin: 20px 0 0;
    padding: 16px 18px;
    background: var(--panel);
    border: 1px solid var(--edge);
    border-radius: 12px;
    color: var(--dim);
    font-size: 13.5px;
    line-height: 1.6;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-top: 20px;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 16px;
    background: var(--panel);
    border: 1px solid var(--edge);
    border-radius: 12px;
    backdrop-filter: blur(8px);
  }
  .wide {
    grid-column: 1 / -1;
  }
  .label {
    color: var(--dim);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .label em,
  .sub {
    color: var(--dim);
    font-size: 11.5px;
    font-style: normal;
    opacity: 0.8;
    text-transform: none;
    letter-spacing: 0;
  }
  .big {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 26px;
    line-height: 1.2;
  }
  .big em {
    font-size: 15px;
    font-style: normal;
    color: var(--dim);
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 20px auto 1fr;
    align-items: baseline;
    gap: 10px;
    padding: 9px 4px;
    border-bottom: 1px solid var(--edge);
    font-size: 13.5px;
    opacity: 0.5;
  }
  li.got {
    opacity: 1;
  }
  .tick {
    color: var(--accent);
  }
  .req {
    color: var(--dim);
    font-size: 12.5px;
    text-align: right;
  }
  .note {
    margin: 14px 0 0;
    color: var(--dim);
    font-size: 12.5px;
    line-height: 1.6;
  }
  .back {
    padding: 9px 14px;
    background: var(--panel);
    color: var(--ink);
    border: 1px solid var(--edge);
    border-radius: 8px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
</style>
