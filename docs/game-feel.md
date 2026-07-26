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
  biggest win/loss, stop-rule compliance — pulling directly from
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
  same ticker at `scrollSpeed: 0.5` with shorting enabled is a completely
  different challenge from `scrollSpeed: 8` long-only, and pooling them
  makes the personal best meaningless.

  Included in the fingerprint (changing any of these starts a new bucket):

  | Key | Why |
  |---|---|
  | `data.source`, `data.ticker`, `data.dateRange` | Different price path entirely |
  | `scrollSpeed` | Reaction time available — the single biggest difficulty lever |
  | `visibleBarCount` | How much history is readable when deciding |
  | `allowShorting` | Doubles the available strategies |
  | `startingCapital`, `entrySize` | Determine position granularity and how many units a full deployment takes |
  | `stops.active` (plugin ids + params) | A trailing stop materially changes achievable outcomes |
  | `priceTransform`, `normalizationMode` | Change what patterns are legible on screen |

  Deliberately **excluded** — cosmetic or accessibility settings that don't
  change the challenge, so a player is never penalized for making the game
  comfortable: `visuals.*` (theme, seed, reduced motion, shake, palette),
  `audio.*`, `character.selected`, `indicators.*` and `volume.enabled`
  (analysis aids the player chooses; excluding them keeps someone from
  gaming the leaderboard by hiding indicators, and more importantly means
  turning on a helpful indicator doesn't orphan their history),
  `hud.showStopLevelOnChart`.

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

## New: the arcade scoring layer (streaks & multipliers)

The most genre-defining thing missing so far. Sonic's ring chains, Tony
Hawk's combo meter, Jetpack Joyride's token runs — endless runners nearly
all put a *second*, faster-moving score on top of the base one, and it's
what creates moment-to-moment tension. It maps unusually well here,
because the arcade mechanic and the training goal want the same behavior:

- **Win-streak multiplier**: consecutive profitable **close events** build a
  multiplier applied to P&L score; a loss or a stop-out resets it. Close
  events rather than campaigns is deliberate — see
  [game-design.md](./game-design.md#what-counts-as-one-trade) for the two
  units and why streak uses the finer one: a campaign can run a hundred bars,
  and a streak that updates once per campaign gives no moment-to-moment
  feedback. Consequence: the streak can fluctuate *within* a single campaign
  when partial exits go both ways, while win rate updates only at
  flat-to-flat. That's intended — they measure execution and judgement
  respectively.
  The arcade incentive ("don't break the chain") is *the same* incentive as
  the trading lesson ("cut losers, let winners run"), so the game-feel layer
  reinforces the habit rather than competing with it.
- **Streak meter in the HUD**, visibly filling/draining — a live gauge
  gives the eye something moving between trades, which is exactly what the
  Waiting state currently lacks.
- **Discipline bonus**: award bonus score for exiting *before* a stop
  triggers, i.e. taking responsibility rather than getting bailed out.
  Directly gamifies [game-design.md](./game-design.md#risk-management)'s
  stop-compliance stat.
- **Risk of over-gamifying**: keep the multiplier a *presentation* layer
  on top of true realized P&L, and always show raw P&L too. If the
  multiplier ever encourages behavior a real trader shouldn't have (e.g.
  panic-scalping tiny wins to protect a streak), it's actively
  anti-educational — worth watching in playtesting.

## New: progression & meta-game

Nothing in the plan yet persists across sessions, which is what makes a
game feel like it has a "shape" beyond one run:

- **Unlockables**: gate some of [character.md](./character.md)'s roster
  and [visuals.md](./visuals.md)/[audio.md](./audio.md)'s themes behind
  play milestones instead of having everything available immediately.
  Costs no new systems — the registries already exist, this just adds a
  locked/unlocked flag.
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
hybrid** — character pinned ~70–80% to the right, with a short fogged
strip beyond it, so there's visual breathing room and a sense of forward
motion without revealing a readable price level. Rationale: a pure
right-edge pin can feel claustrophobic and gives the parallax nothing to
scroll *into*, while a wide fog bank with a centered character risks the
silhouette of an upcoming pole being readable through it.

**And the constraint is enforced structurally, not visually**: unplayed
poles are never rendered at all (see
[game-design.md](./game-design.md#pole-generation--scroll)) — a pole
spawns only when it reaches the character. So the fogged strip shows
background layers and nothing else. There is no pole silhouette to leak,
which means no fog-opacity tuning to get right and no way to regress the
constraint by making a gradient prettier. The fog is purely atmospheric.

Rejected alternatives, for the record:

- **Character pinned hard at the right edge** — the "now" line *is* the
  right edge, matching how real charts and [hud.md](./hud.md)'s
  right-edge axis work, so there's simply nothing to the right to hide.
  Cleanest conceptually, but claustrophobic.
- **Wide fog bank, character centered** — most classic side-scroller
  framing, but a wider hidden region and more reliance on the fog reading
  as opaque.

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
  ([config.md](./config.md)), so a ramp should be an *optional* mode
  layered on the configured base speed, not a replacement for it —
  a trainer whose speed drifts unpredictably is worse for learning.

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
  [config.md](./config.md)), so pause offers resume/restart/quit, not a
  settings panel. Adjusting stop levels on an open position is a trading
  action and stays available during play.

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
  scoring path rather than just presentation, so fold it in with step 3's
  P&L work rather than bolting it on later.
