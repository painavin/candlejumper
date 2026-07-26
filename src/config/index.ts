export type {
  RunConfig,
  StopInstanceConfig,
  IndicatorInstanceConfig,
  VisibleBarCount,
  BackgroundLayerConfig,
  BackgroundLayerName,
  CostBasisMethod,
  PriceTransform,
  NormalizationMode,
  PnlPalette,
  BarStyle,
} from './types.js'
export {
  defaultConfig,
  LAYOUT,
  FLAT_THRESHOLD_SHARES,
  MIN_FUNDABLE_ENTRY_FRACTION,
} from './defaults.js'
export { validateConfig, describeProblems } from './validate.js'
export type { ConfigProblem, ValidationContext } from './validate.js'
export { runFingerprint, fingerprintPayload, FINGERPRINT_VERSION } from './fingerprint.js'
export type { FingerprintInputs } from './fingerprint.js'
