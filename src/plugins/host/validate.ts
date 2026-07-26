import type {
  IndicatorPlugin,
  ParamSpec,
  PluginDescriptor,
  StopPlugin,
} from '@shared/contracts/index.js'

/**
 * Contract validation for a loaded plugin module.
 *
 * Runs before a plugin is used, and validates the *exported shape* rather than
 * trusting it — including that every declared `ParamSpec` is well-formed, since the
 * settings UI renders controls straight from those and a malformed spec would break
 * the panel rather than the plugin.
 *
 * This is separate from the sandbox. The sandbox stops a plugin reaching things it
 * shouldn't; this stops a well-meaning plugin being wired up wrong.
 */

export interface PluginValidation {
  ok: boolean
  problems: string[]
}

function validateParamSpec(spec: unknown, at: string): string[] {
  const problems: string[] = []
  if (typeof spec !== 'object' || spec === null) return [`${at}: not an object`]

  const param = spec as Partial<ParamSpec>
  if (typeof param.key !== 'string' || param.key.length === 0) problems.push(`${at}: missing key`)
  if (typeof param.displayName !== 'string') problems.push(`${at}: missing displayName`)

  const types = ['int', 'float', 'percent', 'bool', 'enum']
  if (typeof param.type !== 'string' || !types.includes(param.type)) {
    problems.push(`${at}: type must be one of ${types.join(', ')}`)
    return problems
  }
  if (param.default === undefined) problems.push(`${at}: missing default`)

  // min/max are required for the numeric kinds precisely so the UI can render a
  // control with no per-plugin code.
  if (['int', 'float', 'percent'].includes(param.type)) {
    if (typeof param.min !== 'number') problems.push(`${at}: ${param.type} needs a numeric min`)
    if (typeof param.max !== 'number') problems.push(`${at}: ${param.type} needs a numeric max`)
    if (typeof param.min === 'number' && typeof param.max === 'number' && param.min >= param.max) {
      problems.push(`${at}: min must be below max`)
    }
  }
  if (param.type === 'enum' && (!Array.isArray(param.options) || param.options.length === 0)) {
    problems.push(`${at}: enum needs a non-empty options array`)
  }

  return problems
}

function validateCommon(value: unknown, kind: string): { problems: string[]; params: unknown[] } {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null) {
    return { problems: [`${kind}: not an object`], params: [] }
  }

  const plugin = value as Partial<StopPlugin & IndicatorPlugin>
  if (typeof plugin.id !== 'string' || plugin.id.length === 0) problems.push(`${kind}: missing id`)
  if (typeof plugin.displayName !== 'string') problems.push(`${kind}: missing displayName`)
  if (typeof plugin.createInstance !== 'function') {
    problems.push(`${kind}: createInstance must be a function`)
  }

  const params = Array.isArray(plugin.params) ? plugin.params : []
  if (!Array.isArray(plugin.params)) problems.push(`${kind}: params must be an array`)

  return { problems, params }
}

export function validatePluginModule(
  value: unknown,
  kind: 'stop' | 'indicator'
): PluginValidation {
  const { problems, params } = validateCommon(value, kind)
  params.forEach((spec, index) => problems.push(...validateParamSpec(spec, `${kind}.params[${index}]`)))

  if (kind === 'indicator' && typeof value === 'object' && value !== null) {
    const plugin = value as Partial<IndicatorPlugin>
    if (plugin.paneKind !== 'overlay' && plugin.paneKind !== 'oscillator') {
      problems.push('indicator: paneKind must be "overlay" or "oscillator"')
    }
    if (!Array.isArray(plugin.outputs) || plugin.outputs.length === 0) {
      problems.push('indicator: outputs must be a non-empty array of names')
    }
    if (plugin.fixedRange !== undefined) {
      const range = plugin.fixedRange
      if (!Array.isArray(range) || range.length !== 2 || range[0]! >= range[1]!) {
        problems.push('indicator: fixedRange must be [min, max] with min below max')
      }
    }
  }

  if (kind === 'stop' && typeof value === 'object' && value !== null) {
    const plugin = value as Partial<StopPlugin>
    if (plugin.requires !== undefined && typeof plugin.requires !== 'function') {
      problems.push('stop: requires must be a function when present')
    }
  }

  return { ok: problems.length === 0, problems }
}

/**
 * Validate what the host can actually see of a sandboxed plugin.
 *
 * The plugin *object* never leaves the worker — that's what makes the boundary
 * meaningful — so the host validates the `PluginDescriptor` instead. Everything
 * checkable from data is checked here; `createInstance` being callable is proven by
 * the worker successfully creating an instance, which is the only place it could be.
 */
export function validateDescriptor(descriptor: PluginDescriptor): PluginValidation {
  const problems: string[] = []
  const kind = descriptor.kind

  if (typeof descriptor.id !== 'string' || descriptor.id.length === 0) {
    problems.push(`${kind}: missing id`)
  }
  if (typeof descriptor.displayName !== 'string' || descriptor.displayName.length === 0) {
    problems.push(`${kind}: missing displayName`)
  }
  if (!Array.isArray(descriptor.params)) {
    problems.push(`${kind}: params must be an array`)
  } else {
    descriptor.params.forEach((spec, index) =>
      problems.push(...validateParamSpec(spec, `${kind}.params[${index}]`))
    )
  }

  if (kind === 'indicator') {
    if (descriptor.paneKind !== 'overlay' && descriptor.paneKind !== 'oscillator') {
      problems.push('indicator: paneKind must be "overlay" or "oscillator"')
    }
    if (!Array.isArray(descriptor.outputs) || descriptor.outputs.length === 0) {
      problems.push('indicator: outputs must be a non-empty array')
    }
  }

  return { ok: problems.length === 0, problems }
}
