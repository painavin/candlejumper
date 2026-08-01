<script lang="ts">
  /**
   * How to play.
   *
   * A two-button game whose controls existed only in the README — which nobody
   * reads from inside the game. docs/game-feel.md asks for a 2–3 step contextual
   * tutorial on first launch; this is the reference version of it, reachable from
   * the title screen forever rather than shown once and lost.
   *
   * Written to teach the *point* alongside the controls: the reason there's no fail
   * state is that the lesson is exiting on purpose, and a player who doesn't know
   * that will look for a way to lose.
   */
  let { isTouch, onBack }: { isTouch: boolean; onBack: () => void } = $props()
</script>

<div class="screen">
  <header>
    <button class="back" onclick={onBack}>← Back</button>
    <h1>How to play</h1>
  </header>

  <ol>
    <li>
      <h2>Every pole is one bar</h2>
      <p>
        Its height is that bar's closing price. The jumper stands on the newest one
        and hops to the next as the bar closes. You can never see a bar you haven't
        reached — unplayed poles don't exist yet.
      </p>
      <p>
        A bar is a trading day unless you downloaded a different interval — a series
        can be anything from one minute to one quarter per pole.
      </p>
    </li>

    <li>
      <h2>Two buttons</h2>
      <table>
        <tbody>
          <tr>
            <th>Buy — open, or add to, a position</th>
            <td>{isTouch ? 'Right thumb button' : '↑ or W'}</td>
          </tr>
          <tr>
            <th>Sell — close one unit</th>
            <td>{isTouch ? 'Left thumb button' : '↓ or S'}</td>
          </tr>
          <tr>
            <th>Flatten — close everything</th>
            <td>{isTouch ? 'Hold the left button' : 'Hold ↓ or S'}</td>
          </tr>
          <tr>
            <th>Pause</th>
            <td>{isTouch ? 'Pause icon, top corner' : 'Esc or P'}</td>
          </tr>
        </tbody>
      </table>
      <p class="note">
        Buy four more times and you're fully deployed. Every sell closes exactly one
        of those units, so four entries always take four exits to get flat.
      </p>
    </li>

    <li>
      <h2>You can't die. That's the point.</h2>
      <p>
        There is no fail state and no game over — just your profit and loss, and
        whether you followed your own rule. Your stop draws a dashed line on the
        chart. Nothing forces you out of a losing trade; you have to do it yourself.
      </p>
    </li>

    <li>
      <h2>The streak measures discipline, not winning</h2>
      <p>
        Those pips in the corner fill on every trade you close according to your
        rule — <strong>including losses</strong>. Taking a small loss because your
        stop said so builds the streak exactly as a win does. The only thing that
        empties it is watching price go through your stop and doing nothing.
      </p>
      <p class="note">
        The multiplier it earns pays out on profitable exits only, so there's nothing
        to farm by scratching in and out.
      </p>
    </li>
  </ol>

  <button class="primary" onclick={onBack}>Got it</button>
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
    margin-bottom: 8px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.01em;
  }
  ol {
    margin: 18px 0 0;
    padding: 0;
    list-style: none;
    counter-reset: step;
  }
  li {
    position: relative;
    margin: 0 0 6px;
    padding: 16px 18px 16px 52px;
    background: var(--panel);
    border: 1px solid var(--edge);
    border-radius: 12px;
    counter-increment: step;
    backdrop-filter: blur(8px);
  }
  li::before {
    content: counter(step);
    position: absolute;
    top: 17px;
    left: 18px;
    width: 22px;
    height: 22px;
    display: grid;
    place-content: center;
    background: var(--accent);
    color: #10151d;
    border-radius: 50%;
    font-size: 12.5px;
    font-weight: 700;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 15px;
    letter-spacing: 0;
    text-transform: none;
    color: var(--ink);
  }
  p {
    margin: 0;
    color: var(--dim);
    font-size: 13.5px;
    line-height: 1.6;
  }
  p + p {
    margin-top: 8px;
  }
  .note {
    font-size: 12.5px;
    opacity: 0.85;
  }
  table {
    width: 100%;
    margin: 4px 0 10px;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  th {
    padding: 5px 0;
    text-align: left;
    font-weight: 400;
    color: var(--dim);
  }
  td {
    padding: 5px 0;
    text-align: right;
    font-family: ui-monospace, Menlo, monospace;
    color: var(--ink);
    white-space: nowrap;
  }
  button {
    padding: 9px 14px;
    background: var(--panel);
    color: var(--ink);
    border: 1px solid var(--edge);
    border-radius: 8px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .primary {
    display: block;
    width: 100%;
    margin-top: 20px;
    padding: 14px;
    background: var(--accent);
    border-color: var(--accent);
    color: #10151d;
    font-size: 15px;
    font-weight: 600;
  }
</style>
