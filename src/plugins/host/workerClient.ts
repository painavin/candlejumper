import type { WorkerRequest, WorkerResponse } from '@shared/contracts/index.js'

/**
 * The host side of the plugin worker: request/response correlation and the per-call
 * time budget.
 *
 * docs/indicators.md requires "a per-call time budget" and auto-disable on repeated
 * failure. In a worker that budget is the only defence available against an infinite
 * loop — there is no way to interrupt a spinning worker from outside, so a blown
 * budget means the *call* is abandoned and, if it keeps happening, the plugin is
 * dropped. The worker itself is terminated on dispose either way.
 *
 * A worker that is genuinely wedged will keep failing every budget, which is what
 * makes the failure count converge on a disable rather than limping along.
 */

/**
 * A request without its correlation id — the client assigns that.
 *
 * Distributive on purpose. A plain `Omit<WorkerRequest, 'id'>` over a union collapses
 * to only the keys *every* member shares, which here is nothing but `type`, so every
 * real call fails to typecheck. Mapping over each member instead preserves the
 * per-variant fields.
 */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never
export type PluginCall = WithoutId<WorkerRequest>

export interface PluginWorkerClient {
  send(request: PluginCall): Promise<WorkerResponse>
  dispose(): void
}

/**
 * Per-call budget. Generous relative to a bar (500ms at the default 2 bars/sec)
 * because a cold worker's first `import()` of a blob URL is much slower than its
 * steady state, and disabling a plugin over startup cost would be wrong.
 */
export const CALL_BUDGET_MS = 250

export interface WorkerFactory {
  (): Worker
}

/**
 * The default factory. `new URL(...; import.meta.url)` is what lets Vite emit the
 * worker as its own chunk rather than inlining it into the main bundle — and
 * `type: 'module'` is required, since the worker uses dynamic `import()`.
 */
export function defaultWorkerFactory(): Worker {
  return new Worker(new URL('../worker/pluginWorker.ts', import.meta.url), { type: 'module' })
}

export function createPluginWorkerClient(
  factory: WorkerFactory = defaultWorkerFactory
): PluginWorkerClient {
  const worker = factory()
  let nextId = 1
  const pending = new Map<
    number,
    { resolve(response: WorkerResponse): void; timer: ReturnType<typeof setTimeout> }
  >()

  const settle = (id: number, response: WorkerResponse): void => {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    clearTimeout(entry.timer)
    entry.resolve(response)
  }

  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    settle(event.data.id, event.data)
  })

  // A worker that dies takes every outstanding call with it. Resolving rather than
  // rejecting keeps the failure on one path: callers already handle `failed`.
  worker.addEventListener('error', () => {
    for (const id of [...pending.keys()]) {
      settle(id, { type: 'failed', id, message: 'plugin worker crashed' })
    }
  })

  return {
    send(request) {
      const id = nextId++
      return new Promise<WorkerResponse>((resolve) => {
        const timer = setTimeout(() => {
          settle(id, { type: 'failed', id, message: `exceeded ${CALL_BUDGET_MS}ms budget` })
        }, CALL_BUDGET_MS)
        pending.set(id, { resolve, timer })
        worker.postMessage({ ...request, id } as WorkerRequest)
      })
    },

    dispose() {
      for (const entry of pending.values()) clearTimeout(entry.timer)
      pending.clear()
      worker.terminate()
    },
  }
}
