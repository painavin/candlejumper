import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ZONES, ZONE_RULES, ZONE_SUBFOLDERS, deniedZoneImports } from '../../eslint.zones.js'

/**
 * The import-zone rules are load-bearing architecture, not style — they're what
 * keep the engine headless and the plugin worker unable to reach the native
 * bridge (docs/code-structure.md). So the *table* they're generated from gets
 * tested like any other logic.
 *
 * The failure this guards against is specific: `ZONE_SUBFOLDERS` has to
 * enumerate engine's folders by name, because gitignore-style negation can't
 * re-include a child of an excluded parent. Add `src/engine/replay/` without
 * updating that list and render/ could import it silently — a zone violation
 * that lints clean.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

function directoriesIn(relativePath: string): string[] {
  const path = `${repoRoot}${relativePath}`
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

describe('ZONE_SUBFOLDERS', () => {
  it.each(Object.keys(ZONE_SUBFOLDERS))('lists every folder that exists in %s', (zone) => {
    const onDisk = directoriesIn(`src/${zone.slice(1)}`)
    const listed = ZONE_SUBFOLDERS[zone] ?? []
    const missing = onDisk.filter((name) => !listed.includes(name))
    expect(
      missing,
      `${zone} has folder(s) not listed in eslint.zones.js — partial grants would leak. Add them.`
    ).toEqual([])
  })

  it.each(Object.keys(ZONE_SUBFOLDERS))('lists nothing that does not exist in %s', (zone) => {
    // The other direction, and it caught a real one: `@platform/pluginLoading` was
    // granted to `plugins/host` for months while the folder didn't exist, so a grant
    // pointed at nothing and the gap was invisible. A name in this table is a
    // promise that the seam exists.
    const onDisk = directoriesIn(`src/${zone.slice(1)}`)
    const phantom = (ZONE_SUBFOLDERS[zone] ?? []).filter((name) => !onDisk.includes(name))
    expect(
      phantom,
      `${zone} lists folder(s) that don't exist on disk — a grant pointing at nothing.`
    ).toEqual([])
  })
})

describe('deniedZoneImports', () => {
  it('denies a whole zone that was granted nothing', () => {
    const { patterns } = deniedZoneImports(['@shared'])
    const render = patterns.find((p) => p.group.includes('@render'))
    expect(render?.group).toEqual(['@render', '@render/**'])
  })

  it('denies every sibling of a partial grant, and not the grant itself', () => {
    const { patterns } = deniedZoneImports(['@shared', '@engine/output'])
    const engine = patterns.find((p) => p.group.some((g) => g.startsWith('@engine')))
    expect(engine?.group).toContain('@engine/position/**')
    expect(engine?.group).toContain('@engine/stops/**')
    expect(engine?.group).not.toContain('@engine/output/**')
  })

  it('denies the bare zone name via paths, not patterns', () => {
    // A bare `@engine` *pattern* would exclude the whole directory under
    // gitignore semantics and swallow the @engine/output grant. An exact-name
    // path entry does the job without that side effect. This is the subtlety
    // that made the first version of these rules silently deny everything.
    const { patterns, paths } = deniedZoneImports(['@engine/output'])
    expect(paths.map((p) => p.name)).toContain('@engine')
    expect(patterns.flatMap((p) => p.group)).not.toContain('@engine')
  })

  it('closes the barrel loophole, so @engine/index.js is not a way around it', () => {
    const { patterns } = deniedZoneImports(['@engine/output'])
    const engine = patterns.find((p) => p.group.includes('@engine/*.ts'))
    expect(engine?.group).toContain('@engine/*.ts')
    expect(engine?.group).toContain('@engine/*.js')
  })

  it('omits a zone that was granted in full', () => {
    const { patterns, paths } = deniedZoneImports(ZONES)
    expect(patterns).toEqual([])
    expect(paths).toEqual([])
  })

  it('refuses a grant naming a folder that does not exist in the table', () => {
    expect(() => deniedZoneImports(['@engine/replay'])).toThrow(/not a known sub-folder/)
  })

  it('refuses a partial grant against a zone with no sub-folder list', () => {
    expect(() => deniedZoneImports(['@render/hud'])).toThrow(/no ZONE_SUBFOLDERS entry/)
  })
})

describe('ZONE_RULES', () => {
  it('covers every zone that has code, so nothing is unrestricted by omission', () => {
    const zonesWithCode = ZONES.map((zone) => `src/${zone.slice(1)}`).filter((dir) =>
      existsSync(`${repoRoot}${dir}`)
    )
    const covered = Object.keys(ZONE_RULES)
    for (const dir of zonesWithCode) {
      expect(
        covered.some((c) => c === dir || c.startsWith(`${dir}/`)),
        `${dir} exists but has no entry in ZONE_RULES`
      ).toBe(true)
    }
  })

  it('keeps the plugin worker able to import only shared/', () => {
    // THE trust boundary. If this list ever grows, the worker bundle stops being
    // independently verifiable.
    expect(ZONE_RULES['src/plugins/worker']).toEqual({ allow: ['@shared'], pure: true })
  })

  it('keeps shared/ importing nothing at all', () => {
    expect(ZONE_RULES['src/shared']?.allow).toEqual([])
  })

  it('marks the engine and the generators pure', () => {
    expect(ZONE_RULES['src/engine']?.pure).toBe(true)
    expect(ZONE_RULES['src/generation']?.pure).toBe(true)
  })

  it('gives render/ and audio/ access to engine/output/ and nothing else in engine/', () => {
    for (const zone of ['src/render', 'src/audio'] as const) {
      const engineGrants = (ZONE_RULES[zone]?.allow ?? []).filter((a) => a.startsWith('@engine'))
      expect(engineGrants).toEqual(['@engine/output'])
    }
  })
})
