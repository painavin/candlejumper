<script lang="ts">
  /**
   * The pause menu.
   *
   * Four distinct outcomes, and the split between "end run" and "abandon" is
   * deliberate: if quitting always scored, a player couldn't escape a misclicked
   * run without polluting their history; if it never scored, they couldn't bank a
   * good run early. Offering both makes the intent explicit at the moment of
   * quitting.
   *
   * Not a settings screen. Config is fixed for a run's duration, and stop levels
   * specifically are not adjustable — a stop is a rule committed beforehand, and
   * editing one under pressure is the habit this trainer exists to prevent.
   */
  let {
    buyingPower,
    startingCapital,
    ticker,
    date,
    progress,
    onResume,
    onRestart,
    onEndRun,
    onAbandon,
  }: {
    buyingPower: number
    startingCapital: number
    ticker: string
    date: string
    progress: number
    onResume: () => void
    onRestart: () => void
    onEndRun: () => void
    onAbandon: () => void
  } = $props()
</script>

<div class="backdrop">
  <div class="panel">
    <h2>Paused</h2>

    <!-- Portrait moves buying power and full session info here, since the two-line
         top HUD has no room for them. -->
    <dl>
      <div><dt>{ticker}</dt><dd>{date}</dd></div>
      <div><dt>Progress</dt><dd>{progress}% of series</dd></div>
      <div>
        <dt>Buying power</dt>
        <dd>${buyingPower.toFixed(0)} / ${startingCapital.toFixed(0)}</dd>
      </div>
    </dl>

    <button class="primary" onclick={onResume}>Resume</button>

    <button onclick={onEndRun}>
      End run
      <span class="hint">Closes your position and records the result</span>
    </button>

    <button onclick={onRestart}>
      Restart
      <span class="hint">Same settings, fresh run — nothing recorded</span>
    </button>

    <button class="quiet" onclick={onAbandon}>
      Abandon
      <span class="hint">Back to settings, nothing recorded</span>
    </button>

    <p class="note">Stop rules aren't editable mid-run — that's the point of them.</p>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    /* Darker than the menu scrims: the run is frozen underneath and the panel is
       the only thing that should read as active. */
    background: rgba(6, 9, 14, 0.78);
  }
  .panel {
    width: min(360px, 88vw);
    padding: 22px;
    background: var(--panel-solid);
    border: 1px solid var(--edge);
    border-radius: 12px;
    color: var(--ink);
  }
  h2 {
    margin: 0 0 14px;
    font-size: 18px;
  }
  dl {
    margin: 0 0 18px;
    display: grid;
    gap: 2px;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    border-bottom: 1px solid var(--edge);
    font-size: 13px;
  }
  dt {
    color: var(--dim);
  }
  dd {
    margin: 0;
    font-family: ui-monospace, Menlo, monospace;
  }
  button {
    display: block;
    width: 100%;
    margin-bottom: 8px;
    padding: 11px 12px;
    background: var(--field);
    color: var(--ink);
    border: 1px solid var(--edge);
    border-radius: 8px;
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #10151d;
    font-weight: 600;
    text-align: center;
  }
  button.quiet {
    background: transparent;
    color: var(--dim);
  }
  .hint {
    display: block;
    margin-top: 2px;
    color: var(--dim);
    font-size: 11.5px;
  }
  .note {
    margin: 12px 0 0;
    color: var(--dim);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
