import type { KeyValueStore } from './store.js'

/**
 * The persisted schema, versioned from the first write.
 *
 * Personal bests are keyed by **run fingerprint** — a stable hash of the config
 * that changes the challenge — so two runs only compete when they were the same
 * challenge. The fingerprint version travels with this schema version: adding a
 * key to the fingerprint later invalidates existing buckets, and that should be an
 * explicit migration rather than silent loss of a player's history.
 */

export const PERSISTENCE_VERSION = 1

export interface PersonalBest {
  /** The primary score: percent return on starting capital. */
  percentReturn: number
  /** Secondary, recorded alongside rather than competing with it. */
  arcadeScore: number
  /** Runs ended from the pause menu are eligible but visibly marked. */
  endedEarly: boolean
  /** Epoch milliseconds. */
  at: number
}

export interface LifetimeStats {
  runs: number
  campaigns: number
  wins: number
  realized: number
  /** How many times an ignored advisory level broke the streak. */
  streakResets: number
  /**
   * Runs completed with at least one campaign and **zero** streak resets. Tracked
   * separately because it's the one lifetime number that measures discipline
   * rather than volume or profit, and unlocks gate off it.
   */
  cleanRuns: number
  /** Longest discipline streak ever reached, across all configurations. */
  bestStreak: number
}

export interface SaveData {
  version: number
  /** Which fingerprint version these buckets were computed with. */
  fingerprintVersion: number
  personalBests: Record<string, PersonalBest>
  lifetime: LifetimeStats
}

const KEY = 'save'

export function emptySave(fingerprintVersion: number): SaveData {
  return {
    version: PERSISTENCE_VERSION,
    fingerprintVersion,
    personalBests: {},
    lifetime: {
      runs: 0,
      campaigns: 0,
      wins: 0,
      realized: 0,
      streakResets: 0,
      cleanRuns: 0,
      bestStreak: 0,
    },
  }
}

/**
 * Read the save, repairing or discarding anything that doesn't match the schema.
 *
 * Deliberately permissive about *missing* fields and strict about *wrong* ones:
 * a player who upgrades should keep their history, but a hand-edited file should
 * not be able to inject a shape the rest of the app then trusts.
 */
export async function loadSave(store: KeyValueStore, fingerprintVersion: number): Promise<SaveData> {
  const raw = await store.load(KEY)
  const fresh = emptySave(fingerprintVersion)
  if (typeof raw !== 'object' || raw === null) return fresh

  const candidate = raw as Partial<SaveData>
  if (candidate.version !== PERSISTENCE_VERSION) return fresh

  // A fingerprint version bump invalidates the buckets, but not the lifetime
  // totals — those aren't keyed by challenge.
  const bestsUsable = candidate.fingerprintVersion === fingerprintVersion

  return {
    version: PERSISTENCE_VERSION,
    fingerprintVersion,
    personalBests: bestsUsable ? sanitizeBests(candidate.personalBests) : {},
    lifetime: sanitizeLifetime(candidate.lifetime, fresh.lifetime),
  }
}

export async function writeSave(store: KeyValueStore, save: SaveData): Promise<void> {
  await store.save(KEY, save)
}

/** Returns the updated save and whether this run set a new best. */
export function recordRun(
  save: SaveData,
  fingerprint: string,
  result: { percentReturn: number; arcadeScore: number; endedEarly: boolean; at: number },
  campaignTotals: {
    campaigns: number
    wins: number
    realized: number
    streakResets: number
    longestStreak: number
  }
): { save: SaveData; isPersonalBest: boolean } {
  const existing = save.personalBests[fingerprint]
  const isPersonalBest = !existing || result.percentReturn > existing.percentReturn

  return {
    isPersonalBest,
    save: {
      ...save,
      personalBests: isPersonalBest
        ? { ...save.personalBests, [fingerprint]: { ...result } }
        : {
            ...save.personalBests,
            // Not a best overall, but the arcade score is tracked separately and
            // could still be one.
            [fingerprint]: {
              ...existing,
              arcadeScore: Math.max(existing.arcadeScore, result.arcadeScore),
            },
          },
      lifetime: {
        runs: save.lifetime.runs + 1,
        campaigns: save.lifetime.campaigns + campaignTotals.campaigns,
        wins: save.lifetime.wins + campaignTotals.wins,
        realized: save.lifetime.realized + campaignTotals.realized,
        streakResets: save.lifetime.streakResets + campaignTotals.streakResets,
        // A run with no campaigns can't be "clean" — sitting flat for a whole
        // series would otherwise be the cheapest way to farm a discipline unlock.
        cleanRuns:
          save.lifetime.cleanRuns +
          (campaignTotals.streakResets === 0 && campaignTotals.campaigns > 0 ? 1 : 0),
        bestStreak: Math.max(save.lifetime.bestStreak, campaignTotals.longestStreak),
      },
    },
  }
}

function sanitizeBests(value: unknown): Record<string, PersonalBest> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, PersonalBest> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const best = entry as Partial<PersonalBest>
    if (!Number.isFinite(best.percentReturn)) continue
    out[key] = {
      percentReturn: best.percentReturn as number,
      arcadeScore: Number.isFinite(best.arcadeScore) ? (best.arcadeScore as number) : 0,
      endedEarly: best.endedEarly === true,
      at: Number.isFinite(best.at) ? (best.at as number) : 0,
    }
  }
  return out
}

function sanitizeLifetime(value: unknown, fallback: LifetimeStats): LifetimeStats {
  if (typeof value !== 'object' || value === null) return fallback
  const stats = value as Partial<LifetimeStats>
  const number = (input: unknown, fallbackValue: number): number =>
    Number.isFinite(input) ? (input as number) : fallbackValue
  return {
    runs: number(stats.runs, fallback.runs),
    campaigns: number(stats.campaigns, fallback.campaigns),
    wins: number(stats.wins, fallback.wins),
    realized: number(stats.realized, fallback.realized),
    streakResets: number(stats.streakResets, fallback.streakResets),
    cleanRuns: number(stats.cleanRuns, fallback.cleanRuns),
    bestStreak: number(stats.bestStreak, fallback.bestStreak),
  }
}
