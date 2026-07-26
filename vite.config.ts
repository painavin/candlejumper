import { fileURLToPath, URL } from 'node:url'
// From vitest/config rather than vite, so the `test` block below is typed.
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  resolve: {
    /**
     * Under test only, resolve Svelte's *browser* build: Vitest otherwise picks the
     * server entry, where `mount()` throws `lifecycle_function_unavailable`.
     *
     * Spread rather than a ternary with `[]`, because an empty array **overrides**
     * Vite's default conditions instead of falling back to them — which silently
     * makes the dev server resolve the server build too.
     */
    ...(mode === 'test' ? { conditions: ['browser'] } : {}),
    alias: {
      '@shared': src('shared'),
      '@config': src('config'),
      '@content': src('content'),
      '@engine': src('engine'),
      '@generation': src('generation'),
      '@data': src('data'),
      '@plugins': src('plugins'),
      '@render': src('render'),
      '@audio': src('audio'),
      '@input': src('input'),
      '@platform': src('platform'),
      '@ui': src('ui'),
      '@app': src('app'),
    },
  },
  /**
   * The worker is referenced by `new Worker(new URL(...), { type: 'module' })` in
   * `plugins/host/workerClient.ts`, which is enough for Vite to emit it as its own
   * chunk — so it needs no `rollupOptions.input` entry. It used to have one, back
   * when nothing instantiated the worker and the entry was the only thing keeping it
   * in the build; leaving both in place emitted the bundle **twice**.
   *
   * Either way it gets its own chunk, which is what makes its import graph
   * independently verifiable. See docs/code-structure.md.
   */
  worker: { format: 'es' },
  test: {
    // Node by default — the engine, generation, and config suites need nothing else.
    // The screen tests opt into jsdom with a per-file `@vitest-environment` comment.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
