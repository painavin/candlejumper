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
   * The one configuration in which the browser build can download price data without
   * anything installed.
   *
   * Yahoo's chart endpoint sends no `Access-Control-Allow-Origin`, and a page cannot
   * override that — CORS is enforced by the browser, on the user's behalf, and there
   * is no developer switch. Proxying it here sidesteps the rule rather than defeating
   * it: the request becomes same-origin from the page's point of view, and Vite's Node
   * process makes the real cross-origin call, where no such rule exists.
   *
   * `app/shell.ts` points the source at `/yahoo` when `import.meta.env.DEV`. A built
   * bundle has no proxy, so downloading there needs either a CORS extension or the
   * player opening the provider URL themselves and importing what comes back — a tab a
   * person navigated to isn't subject to the rule that stops `fetch`. The failure
   * message offers that link. See docs/data-sources.md#cors-is-the-whole-difficulty.
   */
  server: {
    proxy: {
      '/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/yahoo/, ''),
      },
      // The fallback provider, for when Yahoo is throttling. Same reasoning.
      '/stooq': {
        target: 'https://stooq.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/stooq/, ''),
      },
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
