/**
 * Types for the zone table. It stays plain JS so `eslint.config.js` can import
 * it without a build step, but src/app/architecture.test.ts tests it — so it
 * needs a declaration file.
 */

export declare const ZONES: string[]

export declare const ZONE_SUBFOLDERS: Record<string, string[]>

export interface ZoneRule {
  allow: string[]
  pure?: boolean
  native?: boolean
}

export declare const ZONE_RULES: Record<string, ZoneRule>

export interface RestrictedPattern {
  group: string[]
  message: string
}

export interface RestrictedPath {
  name: string
  message: string
}

export declare function deniedZoneImports(allow: readonly string[]): {
  patterns: RestrictedPattern[]
  paths: RestrictedPath[]
}
