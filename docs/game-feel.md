# Game Feel & Polish

## Why this doc exists

The mechanics, visuals, audio, character, HUD, and indicator docs so far
get the game coordinated and functional. What separates something people
want to keep playing from "an animation put together" is the layer on
top: immediate, satisfying feedback on every input, and a session
structure with a beginning, middle, and end. This doc collects concrete,
genre-standard techniques for that layer, organized by what already has a
hook to attach to vs. what's genuinely new work.

## Already has a hook — just needs content

These reuse animation/audio states already designed elsewhere; building
this content doesn't require new engine work:

- Trading-event flourishes — [character.md](./character.md)'s optional
  overlays, keyed to semantic position events rather than button names.
- Distinct stop-out feedback —
  [character.md](./character.md)'s required `stoppedOut` animation, paired
  with [audio.md](./audio.md)'s distinct stop-out stinger.
- Denied-action feedback — the `actionDenied` animation and stinger, so a
  rejected press never reads as a dropped input.
- Theme-consistent color language —
  [visuals.md](./visuals.md)'s accent palette matched to
  [audio.md](./audio.md)'s stinger tone per mood.

## New: per-action feedback ("juice")

- **Floating P&L text**: on every **position close event** — any size
  reduction that realizes P&L, per
  [game-design.md](./game-design.md#what-counts-as-one-trade) — a
  "+$X.XX" / "−$X.XX" pops up at the character's position and rises/fades.
  Keyed to the close *event*, not to the sell button: closing a short is a
  `buy` press, so a button-keyed trigger would show nothing on half of all
  short exits and fire spuriously on short entries.
- **Squash-and-stretch** on landing/jumping — makes the auto-bounce feel
  weighty and alive instead of a metronome. Classic platformer technique,
  used throughout the Mario-like genre.
- **HUD number tweening**: the score/P&L readout in
  [hud.md](./hud.md) should roll/count toward its new value over a few
  frames rather than snapping instantly — small effort, outsized
  perceived-quality gain (the canonical example from the "Juice It or
  Lose It" talk).
- **Screen shake**: a small punch on stop-out trigger (negative surprise),
  a smaller one on a notably large winning sell. Keep it subtle and make
  it toggleable — motion sensitivity/accessibility.
- **Particles**: coin/confetti burst on a profitable sell, a dust puff on
  pole landings, a red vignette flash on stop-out.
- **Camera**: vertical easing that tracks the character's bounce, rather
  than a rigid locked viewport — makes motion feel directed instead of
  mechanical. Note the usual companion technique, *horizontal lookahead*
  (offsetting the camera toward the direction of travel to reveal more of
  what's coming), is **not applicable here** — there is deliberately
  nothing ahead to reveal, per the
  [lookahead constraint](#new-composition--the-lookahead-problem).
  Vertical easing only.

## New: session structure (the highest-leverage item here)

An open-ended sandbox with no beginning or end reads as "a toy," not "a
game." Concretely:

- **Results/summary screen** when the data run ends: final P&L, win rate,
  biggest win/loss, stop-rule compliance, and the run's `arcadeScore` with
  its longest compliant streak — pulling directly from
  [game-design.md](./game-design.md#scoring--stats)'s stats, maybe
  distilled into one headline grade. This is the single highest-leverage
  addition in this doc: it turns each run into a session with a
  resolution, which is what makes a player want to run it again.
- **Personal-best tracking** — session-local is enough to start, no
  server needed. "Beat your best P&L on this ticker" gives a goal that
  sits on top of the trading-habit-training goal without competing with
  it.

  **Run fingerprint** — two runs only share a personal-best bucket if
  their fingerprints match. Percent return makes scores comparable *across
  tickers*, but it doesn't make them comparable across *difficulty*: the
  same ticker with shorting enabled is a completely different challenge
  from the same ticker long-only, and pooling them makes the personal best
  meaningless.

  Included in the fingerprint (changing any of these starts a new bucket):

  | Key | Why |
  |---|---|
  | `data.source`, `data.ticker`, `data.dateRange` | Different price path entirely |
  | `visibleBarCount` | How much history is readable when deciding |
  | `allowShorting` | Doubles the available strategies |
  | `startingCapital`, `entrySize` | Determine position granularity and how many units a full deployment takes |
  | `stops.active` (plugin ids + params) | A trailing stop materially changes achievable outcomes — and whether the discipline streak can be lost at all |
  | `scoring.streakEnabled`, `scoring.maxMultiplier` | Change the achievable `arcadeScore` for the same trading |
  | `priceTransform`, `normalizationMode` | Change what patterns are legible on screen |

  **`scrollSpeed` is deliberately not in that list, and used to be.** On
  difficulty grounds it had the best claim of anything on it — reaction
  time is the single biggest lever the player has. It came out when speed
  became adjustable mid-run with the arrow keys
  ([controls.md](./controls.md#scroll-speed-while-playing)): a bucket key
  has to *identify* a run, and a value the player can change nine times
  before the first trade identifies nothing. Hashing whatever it happened
  to be at the start would file runs under a number describing one moment
  of them.

  The alternatives were to record the slowest speed used, or to disqualify
  any run that changed speed. Both were rejected for the same reason:
  speed is also the accessibility control
  ([accessibility.md](./accessibility.md)), and a trainer that penalises
  you for slowing down to think is training the wrong thing. So speed sits
  with the theme and the palette rather than with `allowShorting` —
  **score tracking ignores it entirely**. Removing the key changed every
  hash, so `FINGERPRINT_VERSION` moved to 3 and existing buckets were
  cleared explicitly rather than stranded; lifetime totals aren't keyed by
  challenge and survive.

  Deliberately **excluded** — cosmetic or accessibility settings that don't
  change the challenge, so a player is never penalized for making the game
  comfortable: `visuals.*` (theme, seed, reduced motion, shake, palette),
  `audio.*`, `character.selected`, `scrollSpeed`, `indicators.*` and
  `volume.enabled`
  (analysis aids the player chooses; excluding them keeps someone from
  gaming the leaderboard by hiding indicators, and more importantly means
  turning on a helpful indicator doesn't orphan their history),
  `hud.showStopLevelOnChart`.

  Note that excluding `indicators.*` stays correct even though stop plugins
  can consume indicators
  ([stops.md](./stops.md#using-indicators-inside-a-stop-plugin)): a stop's
  dependency is derived from the stop's own params, so it travels inside
  `stops.active` and is already in the fingerprint. Nothing in
  `indicators.active` can affect a stop, which is one of the reasons the two
  don't share instances.

  Store the fingerprint as a stable hash of those values so buckets can be
  looked up directly. Version it alongside the persistence schema
  ([tech-stack.md](./tech-stack.md#persistence)) — adding a key to the
  fingerprint later invalidates old buckets, and that should be an explicit
  migration rather than silent data loss.
- **Session variety**: rotate/randomize which ticker + date range plays,
  or a seeded "daily" ticker so repeat sessions don't feel identical. Ties
  into [data-sources.md](./data-sources.md)'s multi-source work.
- **Onboarding overlay**: a 2–3 step contextual tutorial on first launch
  (what buy/sell do, what a pole means, what a stop does) rather than a
  wall of text — standard for the genre.

## New: the arcade scoring layer (the discipline streak)

The most genre-defining thing missing so far. Sonic's ring chains, Tony
Hawk's combo meter, Jetpack Joyride's token runs — endless runners nearly
all put a *second*, faster-moving score on top of the base one, and it's
what creates moment-to-moment tension. It maps well here, but **not as a
win streak.**

**What the streak measures is rule compliance, not profitability.** A loss
taken because the player's own committed rule said to exit is a *success* —
the habit fired correctly and the position was closed on their terms. Not
every trade has to be a winner, and a meter that resets on a
correctly-taken loss teaches loss aversion, which is the opposite of this
game's curriculum. A win streak also measures the market's cooperation as
much as the player's discipline: identical decisions on NKE's downtrend and
AAPL's uptrend would produce completely different meters.

So the streak ticks on **close events**
([game-design.md](./game-design.md#what-counts-as-one-trade)) — the finer of
the two stat units, since a campaign can run a hundred bars and a meter
updating once per campaign gives no moment-to-moment feedback — and what it
asks of each one is whether the player honoured the rule they committed to
before the run:

| Event | Streak |
|---|---|
| Manual exit with a rule active and no advisory level breached — **profit or loss** | **+1** |
| An advisory level is breached and the position is still open | **reset to 0** |
| Any close event while in breach of an advisory level | no change (the streak already reset at the breach) |
| An enforcing stop fired and closed the position | no change — the rule worked, but the engine acted, not the player |
| Force-close at end of data, or **end run** from the pause menu | no change — not a player decision |
| Anything at all, in a run with no stop configured | no change — the meter is dormant, see below |

Resetting **at the breach** rather than at the eventual exit is deliberate:
the feedback belongs at the moment the player fails to act, not several bars
later when they finally do. The breach is already recorded as a compliance
event ([stops.md](./stops.md#advisory-mode)), so one signal drives both.

"In breach" is a **per-bar state, not a latch** — a bar closing back on the
favourable side of the level clears it, which happens routinely as a trailing
level ratchets ([stops.md](./stops.md#advisory-mode)). So a player who
ignores the signal and then recovers starts rebuilding from zero rather than
being locked out for the rest of the campaign. The reset already happened; it
isn't re-applied every bar they linger.

`multiplier = min(1 + streak, 5)`, capped at ×5 — matching the five-unit
full deployment and the five-ghost stack, so one number governs all three.

- **The multiplier applies to profitable close events only**; losses count at
  ×1. `arcadeScore = Σ (close event P&L × its multiplier)`. Discipline builds
  the multiplier, profit collects on it. That split is what makes the streak
  un-farmable: entering and immediately exiting is perfectly compliant and
  will climb the meter, but it earns nothing.
- **Raw realized P&L is never touched**, and stays on screen beside the
  arcade score. Personal best keys off percent return exactly as before; best
  `arcadeScore` is recorded in the same fingerprint bucket as a secondary
  line.
- **Streak meter in the HUD** ([hud.md](./hud.md#top-hud)) — five pips that
  fill one per step and empty on a reset. There is deliberately **no time
  decay**: every version of one creates an incentive to always be in a
  position, and overtrading is a habit this game should not reward. Worse, a
  decay running while a position was open would directly punish letting a
  winner run.
- **A reset needs no new cue.** The meter emptying is the feedback, and the
  dashed advisory line the player just watched price cross is the cause,
  already on screen ([hud.md](./hud.md#top-hud)). Deliberately *not* adding a
  seventh audio event for it: [audio.md](./audio.md)'s `stoppedOut` stinger
  has to stay the most jarring sound in the set, and a breach cue competing
  with it would blunt the one signal that matters most.
- The streak still moves *within* a campaign when it contains several close
  events, while win rate updates only at flat-to-flat — intended, since they
  measure execution and judgement respectively.
- **Risk of over-gamifying**: raw P&L stays visible alongside the arcade
  score always. This reframing removes the specific failure the original
  win-streak design invited — panic-scalping tiny wins to protect a chain —
  since profit no longer builds the meter. Still worth watching in
  playtesting whether the multiplier ever rewards behaviour a real trader
  shouldn't have.

### Where the streak has tension — and where it doesn't

The streak measures the player against their own rule, so what it's worth
depends entirely on which kind of rule they committed to:

- **Advisory stops are where it lives.** Only an advisory level can be
  breached and ignored, so this is the one configuration where the meter can
  actually be lost. That's the same argument
  [stops.md](./stops.md#advisory-mode) already makes for advisory mode
  existing at all, and the streak is its payoff — the strongest reason a
  player has to graduate from enforcing to advisory.
- **Under enforcing stops only, the streak cannot be lost.** The engine
  closes the position at the level, so holding past it is impossible; the
  meter climbs to ×5 and stays. The HUD therefore marks it **automated**
  rather than showing a permanently full gauge, so nobody is misled about
  what it's measuring. This doesn't inflate scores across modes, because
  `stops.active` is part of the run fingerprint below — an enforcing run and
  an advisory run were never in the same personal-best bucket.
- **With no stop active there is no rule, so the meter is dormant** for the
  whole run: no ticks, no resets, multiplier fixed at ×1, `arcadeScore` equal
  to raw P&L. A ruleless run stays a legitimate choice
  ([game-design.md](./game-design.md#risk-management)) and scores normally;
  it simply has no discipline to measure. Rejected alternative: inventing an
  implicit fallback rule for those runs — a rule the player didn't choose
  isn't discipline, and it would contradict the commit-to-a-rule model
  outright.

Which is why **the shipped default is one advisory `trailing-percent` stop**
rather than an empty list (see [config.md](./config.md#stops)). A trainer
whose out-of-the-box configuration carries no risk rule is a strange default
on its own terms, and it means the streak is live on a player's first run
without anything being invented on their behalf.

## New: progression & meta-game

Nothing in the plan yet persists across sessions, which is what makes a
game feel like it has a "shape" beyond one run:

- **Unlockables — considered and rejected.** The original idea was to gate
  some of [character.md](./character.md)'s roster and
  [visuals.md](./visuals.md)/[audio.md](./audio.md)'s themes behind play
  milestones. It was built that way and then removed, because it makes the
  trainer worse at its job: the roster and both moods are cosmetic,
  finished, and cost nothing to offer, and a player who wants to be the
  bear should be the bear on their first run. Locking finished content
  behind a grind buys engagement metrics at the price of the thing the
  player came for. Everything cosmetic is available immediately.

  What the mechanism became instead is the achievements below — same
  registry, same discipline-not-profit rule, no gate.
- **Achievements tied to discipline, not just profit**: "respected your
  stop 10 runs in a row," "held a winner for 20+ bars," "scaled in three
  times on one trend." These are the trainer's actual curriculum, made
  visible as goals.
- **Player stats history**: lifetime win rate / avg win vs avg loss
  trend over time. Seeing the trend line improve is the real reward for a
  training tool.

## New: landmarks in the scroll

Endless runners fight sameness with landmarks — biome changes, distance
markers, boss gates. The price data has natural ones for free:

- **Date banners** scrolling with the world at month/quarter/year
  boundaries ("JAN 2024") — turns an undifferentiated stream of poles into
  a journey with recognizable waypoints.
- **Event flags on specific bars** — earnings dates, dividend dates,
  split dates — rendered as in-world markers on the pole itself. Doubles
  as genuine trading education: "that gap had a reason."
- **Reward marks on poles** rather than collectibles to chase. Worth being
  precise about why: a classic collectible is *anticipatory* — you see a
  coin ahead and steer for it — and the
  [lookahead constraint](#new-composition--the-lookahead-problem) removes
  anticipation entirely, since nothing ahead of the character is ever
  visible. Anything placed on a pole is therefore auto-collected the instant
  it appears, which is feedback, not gameplay. So scope it as feedback
  honestly: a flourish when the character lands on a bar that went the
  player's way, or on an event-flagged bar. Placement uses the seeded PRNG
  ([procedural-assets.md](./procedural-assets.md)) so a given run always
  marks the same bars.

**A general note on this section**: the no-lookahead constraint rules out
the whole family of anticipatory mechanics that endless runners normally
lean on — steering toward pickups, dodging telegraphed obstacles, timing a
jump to a gap you can see. Every "juice" item here has to be *reactive*
(feedback on what just happened) rather than *anticipatory* (information
about what's next). That's a real constraint on how game-like this can feel,
and it's the direct cost of the training goal. Worth holding in mind when
evaluating future polish ideas: if an idea needs the player to see ahead, it
can't work here.

## New: composition & the lookahead problem

Worth calling out because it's a genuine conflict between genre convention
and this game's purpose, and it changes the whole screen layout:

**In a normal side scroller, seeing what's coming is the entire skill** —
you watch the next pipe approach and react. **Here, an upcoming pole is a
future price.** If the player can see poles to the right of the character
before trading them, they can see whether price goes up or down next,
which destroys the training value completely — every trade becomes
trivially correct.

So the "empty" right side of the screen isn't a composition problem to
fill with more visible world; it's a hard requirement. **Decided: the
hybrid** — character pinned ~70–80% to the right, with a strip of open
world beyond it, so there's visual breathing room and a sense of forward
motion without revealing a readable price level. Rationale: a pure
right-edge pin can feel claustrophobic and gives the parallax nothing to
scroll *into*.

**And the constraint is enforced structurally, not visually**: unplayed
poles are never rendered at all (see
[game-design.md](./game-design.md#pole-generation--scroll)) — a pole
spawns only when it reaches the character. So the strip shows background
layers and nothing else. There is no pole silhouette to leak, which means
nothing to tune and no way to regress the constraint by adjusting a
gradient.

**That strip was originally fogged, and the fog has been removed.** Its only
job was atmosphere — it was never hiding anything, since there was nothing
there to hide — and what it did in practice was haze over the parallax
terrain, the right-hand quarter of the scene, and the Y axis. Structural
enforcement is what made the fog optional; removing it is that argument
followed to its end.

Rejected alternatives, for the record:

- **Character pinned hard at the right edge** — the "now" line *is* the
  right edge, matching how real charts and [hud.md](./hud.md)'s
  right-edge axis work, so there's simply nothing to the right to hide.
  Cleanest conceptually, but claustrophobic.
- **Wide hidden bank, character centered** — most classic side-scroller
  framing, but a wider empty region for no gain.

## New: depth & motion refinements

- **Foreground occlusion layer**: a parallax layer *in front* of the
  character at >1x speed (grass blades, leaves, foliage) that briefly
  passes over it. One of the strongest depth cues in 2D side scrollers and
  currently missing — [visuals.md](./visuals.md)'s layer stack tops out at
  the gameplay plane, so this is a genuine addition to that table.
- **Motion trail / afterimage** on the character while in position — cheap,
  and visually distinguishes Active from Waiting at a glance.
- **Screen transitions**: wipes/fades between menu → run → results rather
  than hard cuts. Small, and a big part of why polished games feel
  polished.
- **Title screen with attract mode**: the game playing itself behind the
  menu (a demo run scrolling with no input). Extremely genre-standard,
  and it's just the existing render loop with input disabled — one of the
  cheapest "this is a real game" signals available.
- **Speed ramp over a run**: endless runners almost always accelerate.
  Tension here: `scrollSpeed` is a player config
  ([config.md](./config.md)) *and* now a live control
  ([controls.md](./controls.md#scroll-speed-while-playing)), so a ramp
  should be an *optional* mode layered on the configured base speed, not a
  replacement for it — a trainer whose speed drifts unpredictably is worse
  for learning, and it would also have to decide what happens when the
  player overrides it mid-ramp.

## New: world-alive touches

- **Idle animation variety**: after some time in the Waiting state with
  nothing happening, the character plays a secondary "bored" animation.
  Small and cheap, reads as "alive" rather than static — see any
  Mario-like's idle-fidget animations.
- **Time-of-day/weather drift** over a long run — extends
  [visuals.md](./visuals.md)'s deferred day/night idea into "it changes
  gradually as the run goes on," rather than a single static theme pick
  for the whole session.

## New: platform-native touches

- **Haptics** on buy/sell/stop-out via Capacitor's Haptics API on mobile —
  makes touch input feel tactile rather than flat.
- **Pause/resume** that doesn't lose run state. Note that *settings* are
  not reachable mid-run — config is fixed for the duration of a run (see
  [config.md](./config.md)), so pause offers resume/restart/end/abandon, not
  a settings panel. Stop levels aren't adjustable either: stops are pre-run
  rules that recompute themselves each bar
  ([stops.md](./stops.md#why-this-is-better-than-editable-stop-levels)).

## Sequencing note

Build this pass after mechanics (roadmap steps 1–4) and visuals/audio/
character (steps 6–7) are solid — nearly everything here is presentation
layered on events those systems already emit, and doing it earlier means
re-polishing content that hasn't stabilized yet.

Three exceptions that should *not* wait:

- **The lookahead constraint** (composition section above) — decide it at
  roadmap step 1. It determines where the character sits on screen and
  what the leading edge looks like; retrofitting it means redoing the
  scene layout and possibly the parallax framing.
- **HUD number tweening** — close to free once
  [hud.md](./hud.md)'s P&L readout exists in step 3.
- **Streak/multiplier scoring** — this one touches the trading engine's
  scoring path rather than just presentation. It can't land before step 4,
  though, because a compliance streak needs a committed rule to measure and
  stops arrive there — so build it with step 4 and reserve its HUD space at
  step 3 ([hud.md](./hud.md#top-hud)).
