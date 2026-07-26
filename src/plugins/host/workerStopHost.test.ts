import { describe, expect, it, vi } from 'vitest'
import type { OhlcvBar, PositionState, WorkerResponse } from '@shared/contracts/index.js'
import type { PluginCall, PluginWorkerClient } from './workerClient.js'
import { createWorkerStopHost } from './workerStopHost.js'

/**
 * The sandboxed stop host, and specifically the two things that make it safe to put
 * risk management behind an asynchronous boundary:
 *
 *   1. A level requested at bar N is available by bar N+1, which is the only reason a
 *      synchronous port can be served by a worker at all.
 *   2. A stop that stops answering is **disabled and announced**, not quietly ignored.
 *      docs/stops.md calls failing open on risk without telling anyone the worst
 *      available outcome, so this is the test that matters most in the file.
 */

const bar: OhlcvBar = { t: 1, o: 100, h: 101, l: 99, c: 100, v: 1000 }
const long: PositionState = {
  size: 10,
  avgCost: 100,
  barsHeld: 2,
  bestPrice: 105,
  worstPrice: 96,
  entryBarIndex: 4,
}

/**
 * A client that answers immediately rather than across a real worker.
 *
 * Synchronous resolution isn't cheating: it collapses the *timing* while keeping the
 * `Promise` boundary, which is what the host's logic actually turns on. The late-reply
 * case is exercised separately with a client that never resolves.
 */
function fakeClient(level: number | null | (() => WorkerResponse)): PluginWorkerClient {
  let instanceId = 0
  const calls: PluginCall[] = []
  const client: PluginWorkerClient & { calls: PluginCall[] } = {
    calls,
    send(request) {
      calls.push(request)
      if (request.type === 'load') {
        return Promise.resolve({
          type: 'loaded',
          id: 0,
          descriptor: {
            kind: 'stop',
            id: 'mine',
            displayName: 'Mine',
            params: [],
            declaresRequires: false,
          },
        })
      }
      if (request.type === 'create') {
        return Promise.resolve({ type: 'created', id: 0, instanceId: ++instanceId })
      }
      if (request.type === 'stopBar') {
        if (typeof level === 'function') return Promise.resolve(level())
        return Promise.resolve({ type: 'level', id: 0, level })
      }
      return Promise.resolve({ type: 'ok', id: 0 })
    },
    dispose() {},
  }
  return client
}

const active = [{ typeId: 'mine', params: {}, advisory: false }]

describe('createWorkerStopHost', () => {
  it('loads sources before creating instances', async () => {
    const client = fakeClient(95) as PluginWorkerClient & { calls: PluginCall[] }
    await createWorkerStopHost({
      active,
      client,
      files: [{ name: 'mine.js', kind: 'stop', source: 'export default {}' }],
    })
    expect(client.calls.map((call) => call.type)).toEqual(['load', 'create'])
  })

  it('serves a level computed on the previous bar', async () => {
    const host = await createWorkerStopHost({ active, client: fakeClient(95), files: [] })
    // Bar N: ask.
    host.computeLevels(bar, long)
    await Promise.resolve()
    // Bar N+1: the level is there, synchronously.
    expect(host.evaluate(94, long).triggered?.level).toBe(95)
  })

  it('has no level on the bar a position opened', async () => {
    const host = await createWorkerStopHost({ active, client: fakeClient(95), files: [] })
    host.computeLevels(bar, long)
    await Promise.resolve()
    host.onEntry()
    // A stop must never fire on the entry bar itself.
    expect(host.evaluate(1, long).triggered).toBeNull()
  })

  it('coerces a non-finite level to no level rather than an unfireable one', async () => {
    const host = await createWorkerStopHost({ active, client: fakeClient(Number.NaN), files: [] })
    host.computeLevels(bar, long)
    await Promise.resolve()
    // Every comparison against NaN is false, so a NaN level is a stop the HUD shows
    // as active that can never fire — strictly worse than no stop.
    expect(host.levels).toEqual([])
    expect(host.evaluate(1, long).triggered).toBeNull()
  })

  it('disables and announces a stop that keeps failing', async () => {
    const onDisabled = vi.fn()
    const host = await createWorkerStopHost({
      active,
      client: fakeClient(() => ({ type: 'failed', id: 0, message: 'boom' })),
      files: [],
      onDisabled,
    })

    for (let i = 0; i < 3; i++) {
      host.computeLevels(bar, long)
      await Promise.resolve()
    }

    expect(onDisabled).toHaveBeenCalledTimes(1)
    expect(onDisabled.mock.calls[0]?.[0]).toBe('mine')
    expect(onDisabled.mock.calls[0]?.[1]).toContain('boom')
    // Announced *and* inert: it draws no line and can never fire again.
    expect(host.levels).toEqual([])
  })

  it('tolerates one hiccup without costing the player their rule', async () => {
    const onDisabled = vi.fn()
    let failNext = true
    const host = await createWorkerStopHost({
      active,
      client: fakeClient(() =>
        failNext
          ? ((failNext = false), { type: 'failed', id: 0, message: 'blip' })
          : { type: 'level', id: 0, level: 95 }
      ),
      files: [],
      onDisabled,
    })

    host.computeLevels(bar, long)
    await Promise.resolve()
    host.computeLevels(bar, long)
    await Promise.resolve()

    expect(onDisabled).not.toHaveBeenCalled()
    expect(host.evaluate(94, long).triggered?.level).toBe(95)
  })

  it('counts a reply that never arrives as a bar left unprotected', async () => {
    // The subtle failure mode: no throw, no crash, just silence. Without this the
    // stop would appear healthy forever while protecting nothing.
    const onDisabled = vi.fn()
    const never: PluginWorkerClient = {
      send: (request) =>
        request.type === 'create'
          ? Promise.resolve({ type: 'created', id: 0, instanceId: 1 })
          : new Promise<WorkerResponse>(() => {}),
      dispose() {},
    }
    const host = await createWorkerStopHost({ active, client: never, files: [], onDisabled })

    for (let i = 0; i < 3; i++) {
      host.computeLevels(bar, long)
      host.evaluate(94, long)
    }
    expect(onDisabled).toHaveBeenCalledTimes(1)
    expect(onDisabled.mock.calls[0]?.[1]).toContain('time budget')
  })

  it('refuses to start when the sandbox cannot create the stop', async () => {
    // Pre-run validation should have caught this; if it didn't, starting a run whose
    // risk rule silently doesn't exist is exactly what must not happen.
    const broken: PluginWorkerClient = {
      send: () => Promise.resolve({ type: 'failed', id: 0, message: 'no such plugin' }),
      dispose() {},
    }
    await expect(
      createWorkerStopHost({ active, client: broken, files: [] })
    ).rejects.toThrow(/no such plugin/)
  })

  it('reports advisory and enforcing rules from the specs it was given', async () => {
    const host = await createWorkerStopHost({
      active: [{ typeId: 'mine', params: {}, advisory: true }],
      client: fakeClient(95),
      files: [],
    })
    expect(host.hasAnyRule).toBe(true)
    expect(host.hasAdvisoryRule).toBe(true)

    host.computeLevels(bar, long)
    await Promise.resolve()
    const result = host.evaluate(94, long)
    // Advisory: recorded as a breach, never closed for the player.
    expect(result.triggered).toBeNull()
    expect(result.breaches).toHaveLength(1)
  })
})
