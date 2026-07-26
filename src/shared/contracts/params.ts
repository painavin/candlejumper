/**
 * Declares one tunable parameter. Deliberately sufficient to render a settings
 * control with no per-plugin UI code — that's why min/max/step/unit are here
 * rather than left to the plugin to validate.
 *
 * Shared by indicator plugins, stop plugins, and the config UI alike.
 * See docs/indicators.md#shared-types.
 */
export interface ParamSpec {
  key: string
  displayName: string
  type: 'int' | 'float' | 'percent' | 'bool' | 'enum'
  default: number | boolean | string
  /** Required for int/float/percent. */
  min?: number
  max?: number
  step?: number
  /** Required for enum. */
  options?: string[]
  /** Display suffix only, e.g. 'bars', '%', '$'. */
  unit?: string
}

/** A resolved set of parameter values, keyed by `ParamSpec.key`. */
export type ParamValues = Record<string, number>
