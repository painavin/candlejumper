import { createShell } from './shell.js'

/**
 * Boot. `main.ts` calls this and nothing else.
 *
 * Two hosts: the canvas layer that PixiJS owns, and the DOM layer Svelte owns for
 * menus. They never overlap in responsibility — the canvas draws the game world,
 * Svelte draws the screens around it.
 */
export async function bootstrap(): Promise<void> {
  const canvasHost = document.getElementById('stage')
  const uiHost = document.getElementById('ui')
  if (!canvasHost || !uiHost) throw new Error('Missing #stage or #ui element')

  // The boot element is hidden by main.ts on success rather than removed here, so
  // that an error thrown later still has somewhere to render.
  await createShell(canvasHost, uiHost)
}
