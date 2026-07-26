import { bootstrap } from '@app/bootstrap.js'

/**
 * The entry point does nothing but boot `app/` — and make sure a failure is
 * *visible*.
 *
 * The boot element stays in the DOM rather than being removed on success, because
 * removing it means a later error has nowhere to render and the page just goes
 * blank. Hidden-but-present costs nothing and turns a silent failure into a
 * readable one.
 */

function showError(detail: unknown): void {
  const target = document.getElementById('boot')
  if (!target) return
  target.hidden = false
  target.textContent = `Failed to start.\n\n${format(detail)}\n\nSee the browser console for the full stack.`
}

function format(detail: unknown): string {
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`
  return String(detail)
}

// Anything thrown after bootstrap resolves — a render-loop error, a rejected
// dynamic import — would otherwise be console-only.
globalThis.addEventListener('error', (event) => showError(event.error ?? event.message))
globalThis.addEventListener('unhandledrejection', (event) => showError(event.reason))

bootstrap()
  .then(() => {
    const target = document.getElementById('boot')
    if (target) target.hidden = true
  })
  .catch((error: unknown) => {
    console.error(error)
    showError(error)
  })
