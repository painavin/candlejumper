/// <reference lib="webworker" />
import type {
  IndicatorInstance,
  IndicatorPlugin,
  StopInstance,
  StopPlugin,
} from '@shared/contracts/index.js'
import { describePlugin } from '@shared/contracts/pluginProtocol.js'
import type { WorkerRequest, WorkerResponse } from '@shared/contracts/pluginProtocol.js'

/**
 * THE TRUST BOUNDARY.
 *
 * Player-supplied plugin code runs here and nowhere else. This module's import
 * graph contains `shared/` and nothing else — enforced by lint rule and asserted by
 * a test — which is what makes the boundary *verifiable* rather than merely
 * intended.
 *
 * Why this matters more here than in a plain browser tab: Tauri and Capacitor both
 * give the web view a bridge to native capabilities (filesystem, shell, device
 * APIs). A plugin system that lets players load their own code must guarantee that
 * code can **never** reach that bridge, whatever the author intended. A Web Worker
 * has no DOM, no bridge, no filesystem — and this file hands it nothing but bar
 * data over `postMessage`.
 *
 * The host, not the worker, decides what to do about a misbehaving plugin: this side
 * only reports failures. That asymmetry matters because a dead *stop* silently
 * removes risk protection mid-position and must notify the player, while a dead
 * indicator just draws nothing.
 */

const plugins = new Map<string, { kind: 'stop' | 'indicator'; plugin: StopPlugin | IndicatorPlugin }>()
const instances = new Map<number, StopInstance | IndicatorInstance>()
let nextInstanceId = 1

const post = (message: WorkerResponse): void => {
  ;(globalThis as unknown as { postMessage(value: unknown): void }).postMessage(message)
}

/**
 * Evaluate a plugin module's source.
 *
 * `import()` of a blob URL is the only mechanism available here, and it is safe for
 * the same reason the whole worker is: whatever the module does, it has no DOM, no
 * network privileges beyond the worker's own, and no bridge.
 */
async function loadPlugin(id: number, source: string, kind: 'stop' | 'indicator'): Promise<void> {
  const blob = new Blob([source], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    const module = (await import(/* @vite-ignore */ url)) as { default?: unknown }
    const plugin = module.default
    if (typeof plugin !== 'object' || plugin === null) {
      throw new Error('plugin module must default-export an object')
    }
    const typed = plugin as StopPlugin | IndicatorPlugin
    if (typeof typed.id !== 'string' || typeof typed.createInstance !== 'function') {
      throw new Error('plugin module must export id and createInstance')
    }
    plugins.set(typed.id, { kind, plugin: typed })
    // The request's own id, not a constant: the host correlates every reply by id,
    // and a hardcoded one would resolve whichever call happened to be first.
    post({ type: 'loaded', id, descriptor: describePlugin(typed, kind) })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function handle(request: WorkerRequest): void {
  try {
    switch (request.type) {
      case 'load':
        void loadPlugin(request.id, request.source, request.kind).catch((error: unknown) => {
          post({ type: 'failed', id: request.id, message: String(error) })
        })
        return

      case 'create': {
        const entry = plugins.get(request.pluginId)
        if (!entry) throw new Error(`unknown plugin: ${request.pluginId}`)
        const instanceId = nextInstanceId++
        instances.set(instanceId, entry.plugin.createInstance(request.params))
        post({ type: 'created', id: request.id, instanceId })
        return
      }

      case 'requires': {
        const entry = plugins.get(request.pluginId)
        if (!entry || entry.kind !== 'stop') throw new Error(`unknown stop: ${request.pluginId}`)
        const requires = (entry.plugin as StopPlugin).requires
        post({
          type: 'requires',
          id: request.id,
          requests: requires ? requires.call(entry.plugin, request.params) : [],
        })
        return
      }

      case 'reset': {
        instances.get(request.instanceId)?.reset()
        post({ type: 'ok', id: request.id })
        return
      }

      case 'stopBar': {
        const instance = instances.get(request.instanceId) as StopInstance | undefined
        if (!instance) throw new Error(`unknown instance: ${request.instanceId}`)
        const level = instance.onBar(request.bar, request.position, request.indicators)
        post({ type: 'level', id: request.id, level: level ?? null })
        return
      }

      case 'indicatorBar': {
        const instance = instances.get(request.instanceId) as IndicatorInstance | undefined
        if (!instance) throw new Error(`unknown instance: ${request.instanceId}`)
        post({
          type: 'outputs',
          id: request.id,
          outputs: instance.onBar(request.bar, request.isLastBar),
        })
        return
      }
    }
  } catch (error) {
    // Every call is wrapped: a plugin that throws must never take the run down.
    // The host counts failures and decides whether to auto-disable.
    post({ type: 'failed', id: request.id, message: String(error) })
  }
}

;(globalThis as unknown as {
  addEventListener(type: string, listener: (event: { data: WorkerRequest }) => void): void
}).addEventListener('message', (event) => handle(event.data))
