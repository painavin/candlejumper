<script lang="ts">
  /**
   * Mobile thumb buttons.
   *
   * DOM rather than Pixi, and that exception is explicitly allowed: these are
   * **static for the whole run**, so they break no per-frame-DOM rule, and touch
   * handling is what the DOM is genuinely better at — see
   * docs/code-structure.md#the-hud-renders-in-pixijs-not-svelte.
   *
   * Layout is from docs/controls.md: buy bottom **right**, exit bottom **left**,
   * pause top corner. Buy-on-the-right matches the runner sitting at 75% width, and
   * both sit outside the plotting area — the layout reserves a control strip before
   * allocating sub-pane height, so a thumb never covers a pole being read.
   *
   * `pointerdown` rather than `click`: a click fires on release, which would make
   * every entry feel late, and the exit button needs the press/release pair anyway
   * to tell a tap from a flatten-hold.
   */
  import type { TouchHandlers } from '@shared/contracts/index.js'

  let { touch }: { touch: TouchHandlers } = $props()

  let exitHeld = $state(false)

  function exitDown(event: PointerEvent): void {
    event.preventDefault()
    exitHeld = true
    touch.exitDown()
  }

  function exitUp(): void {
    if (!exitHeld) return
    exitHeld = false
    touch.exitUp()
  }

  /**
   * A thumb sliding off the button must cancel rather than exit: the release
   * happens outside the element, so `pointerup` never arrives and the hold timer
   * would otherwise fire a flatten the player didn't ask for.
   */
  function exitAway(): void {
    if (!exitHeld) return
    exitHeld = false
    touch.cancel()
  }
</script>

<div class="controls">
  <button
    class="pause"
    aria-label="Pause"
    onpointerdown={(event) => {
      event.preventDefault()
      touch.pause()
    }}
  >
    <span></span><span></span>
  </button>

  <button
    class="thumb exit"
    class:held={exitHeld}
    aria-label="Sell one unit, hold to close everything"
    onpointerdown={exitDown}
    onpointerup={exitUp}
    onpointerleave={exitAway}
    onpointercancel={exitAway}
  >
    <span class="glyph">▼</span>
    <span class="caption">SELL</span>
  </button>

  <button
    class="thumb buy"
    aria-label="Buy one unit"
    onpointerdown={(event) => {
      event.preventDefault()
      touch.buy()
    }}
  >
    <span class="glyph">▲</span>
    <span class="caption">BUY</span>
  </button>
</div>

<style>
  .controls {
    position: fixed;
    inset: 0;
    /* The container must never eat a touch meant for the canvas; only the buttons
       themselves are targets. */
    pointer-events: none;
  }
  .controls > * {
    pointer-events: auto;
  }
  .thumb {
    position: fixed;
    bottom: max(18px, env(safe-area-inset-bottom));
    display: grid;
    place-content: center;
    gap: 2px;
    /* Generous: scaling in means repeated rapid presses, so these are held-and-
       tapped controls rather than precision ones (docs/controls.md). */
    width: 84px;
    height: 84px;
    border-radius: 50%;
    border: 2px solid var(--edge);
    background: var(--panel);
    color: var(--ink);
    backdrop-filter: blur(6px);
    /* Stops the long-press-to-select and double-tap-to-zoom gestures from firing
       on a button whose whole job is being pressed and held. */
    touch-action: none;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .buy {
    right: max(18px, env(safe-area-inset-right));
    border-color: var(--up);
  }
  .exit {
    left: max(18px, env(safe-area-inset-left));
    border-color: var(--down);
  }
  .thumb:active,
  .thumb.held {
    /* Visible confirmation that a hold is in progress — flatten is deliberate, so
       it should look like something is happening while the timer runs. */
    transform: scale(0.94);
    background: var(--accent);
    color: #10151d;
  }
  .glyph {
    font-size: 20px;
    line-height: 1;
  }
  .caption {
    font-size: 10.5px;
    letter-spacing: 0.1em;
    opacity: 0.75;
  }
  .pause {
    position: fixed;
    top: max(10px, env(safe-area-inset-top));
    right: max(12px, env(safe-area-inset-right));
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 40px;
    height: 40px;
    padding: 0;
    background: var(--panel);
    border: 1px solid var(--edge);
    border-radius: 10px;
    touch-action: none;
  }
  .pause span {
    display: block;
    width: 4px;
    height: 15px;
    background: var(--ink);
    border-radius: 1px;
  }
</style>
