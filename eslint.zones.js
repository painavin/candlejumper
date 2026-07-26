/**
 * The dependency table from docs/code-structure.md, in one place so both the
 * lint config and the architecture test read the same source.
 */

/** Every top-level zone under src/, as an import alias. */
export const ZONES = [
  '@shared',
  '@config',
  '@content',
  '@engine',
  '@generation',
  '@data',
  '@plugins',
  '@render',
  '@audio',
  '@input',
  '@platform',
  '@ui',
  '@app',
]

/**
 * Sub-folders of the zones that hand out *partial* access — render/ may reach
 * engine/output/ and nothing else in engine/, and that distinction is the whole
 * reason engine/output/ is its own folder.
 *
 * These must be enumerated rather than expressed as a negation:
 * `no-restricted-imports` uses gitignore semantics, where excluding a parent
 * directory makes it impossible to re-include a child, so
 * `['@engine/**', '!@engine/output/**']` denies everything. Denying each
 * non-granted sibling by name is the only shape that actually works.
 *
 * src/app/architecture.test.ts asserts these lists match what's on disk, so a
 * new engine folder can't become silently importable from render/.
 */
export const ZONE_SUBFOLDERS = {
  '@engine': [
    'indicators',
    'normalization',
    'output',
    'pipeline',
    'position',
    'run',
    'scoring',
    'stops',
  ],
  '@platform': ['haptics', 'persistence', 'pluginLoading'],
}

/**
 * `allow` lists the alias prefixes a zone may import; anything not listed is
 * denied. `pure` marks a zone that must run headless — no rendering/audio/UI
 * library, no DOM global.
 */
export const ZONE_RULES = {
  'src/shared': { allow: [] },
  'src/config': { allow: ['@shared'] },
  'src/content': { allow: ['@shared'] },
  'src/generation': { allow: ['@shared'], pure: true },
  'src/data': { allow: ['@shared'] },
  'src/engine': { allow: ['@shared', '@config'], pure: true },
  'src/plugins/worker': { allow: ['@shared'], pure: true },
  // Both plugin *ports*, and nothing else in engine/: a host implements what the
  // engine asks for, and must not be able to reach the engine's internals.
  'src/plugins/host': {
    allow: ['@shared', '@engine/stops', '@engine/indicators', '@platform/pluginLoading'],
  },
  'src/plugins/builtin': {
    allow: ['@shared', '@engine/stops', '@engine/indicators', '@platform/pluginLoading'],
  },
  'src/render': {
    allow: ['@shared', '@config', '@content', '@generation', '@engine/output'],
  },
  'src/audio': { allow: ['@shared', '@content', '@engine/output'] },
  'src/input': { allow: ['@shared', '@engine/pipeline'] },
  'src/platform': { allow: ['@shared'], native: true },
  'src/ui': { allow: ['@shared', '@config', '@content', '@platform', '@engine/scoring'] },
  // app/ is the composition root: the one place allowed to know about
  // everything, because wiring the zones together is its entire job.
  'src/app': { allow: ZONES },
}

/**
 * Turn an allowlist into the denylist `no-restricted-imports` wants.
 *
 * Returns both halves of the rule's options, because the two jobs need
 * different mechanisms:
 *
 *   - `patterns` use gitignore semantics, where a bare directory name excludes
 *     everything beneath it. That makes `'@engine'` unusable alongside a grant
 *     for `@engine/output` — it would swallow the grant.
 *   - `paths` match an exact module specifier, which is what denying the bare
 *     `@engine` barrel import actually needs.
 */
export function deniedZoneImports(allow) {
  const patterns = []
  const paths = []

  for (const zone of ZONES) {
    const grants = allow.filter((a) => a === zone || a.startsWith(`${zone}/`))
    if (grants.includes(zone)) continue // whole zone allowed

    if (grants.length === 0) {
      patterns.push({
        group: [zone, `${zone}/**`],
        message: `Import zone violation: this folder may not import ${zone}/. See docs/code-structure.md#dependency-rules.`,
      })
      continue
    }

    const granted = new Set(grants.map((g) => g.slice(zone.length + 1)))
    const subfolders = ZONE_SUBFOLDERS[zone]
    if (!subfolders) {
      throw new Error(
        `${zone} hands out a partial grant (${grants.join(', ')}) but has no ZONE_SUBFOLDERS entry.`
      )
    }
    for (const unknown of granted) {
      if (!subfolders.includes(unknown)) {
        throw new Error(`${zone}/${unknown} is granted but is not a known sub-folder of ${zone}.`)
      }
    }

    const message = `Import zone violation: inside ${zone}/ this folder may only reach ${grants.join(', ')}. See docs/code-structure.md#dependency-rules.`
    const denied = subfolders.filter((sub) => !granted.has(sub))

    patterns.push({
      group: [
        // Any barrel directly inside the zone root — importing
        // `@engine/index.js` must not be a way around the sub-folder rules.
        // `*` does not cross a `/`, so these match direct children only.
        `${zone}/*.ts`,
        `${zone}/*.js`,
        ...denied.flatMap((sub) => [`${zone}/${sub}`, `${zone}/${sub}/**`]),
      ],
      message,
    })
    // The bare zone name, matched exactly rather than as a directory prefix.
    paths.push({ name: zone, message })
  }

  return { patterns, paths }
}
