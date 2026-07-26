/**
 * What an unlock needs to know.
 *
 * Declared here rather than importing `LifetimeStats` from `platform/persistence`,
 * because `content/` may only import `shared/` — and that restriction is doing real
 * work: content describes *what* is unlockable, and must not become coupled to how
 * progress happens to be stored. Structural typing means `LifetimeStats` satisfies
 * this without either side knowing about the other.
 */
export interface UnlockContext {
  lifetime: {
    runs: number
    campaigns: number
    wins: number
    realized: number
    streakResets: number
    cleanRuns: number
    bestStreak: number
  }
}

export interface Unlock {
  /** Namespaced so the id says what it gates: `character:bear`, `theme:serious`. */
  id: string
  displayName: string
  /** Shown to the player, both while locked and once earned. */
  requirement: string
  achieved(context: UnlockContext): boolean
}
