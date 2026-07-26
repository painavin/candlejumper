# Design Review Findings

Review of the full doc set for implementation completeness. All open questions
were identified by cross-referencing every doc against every other doc;
findings are grouped by severity.

---

## 🔴 Blocking — Must Resolve Before Implementation

### 1. Trade sizing unit is never defined

**Affects:** `game-design.md`, `config.md`, `character.md`

`buyUnitSize` is a cash amount; `sellUnitSize` is a fraction of the open
position. The underlying unit of position size — shares, fractional shares, or
abstract "press-units" — is never stated. This breaks:

- The ghost-stack count: 1 ghost = 1 buy press? 1 share?
- Repeated 25% sells never cleanly reach zero — no rounding/flat-threshold rule.
- Buying to cover a short: `buyUnitSize` (cash) doesn't map sensibly to
  reducing a short position in shares.

**Needs:** An explicit order-intent matrix — for each state (`flat`/`long`/
`short`) × action (`buy`/`sell`), the role (entry / add / reduce / close /
no-op) and which config key governs the size amount. Plus a precision and
flat-threshold rounding rule.

---

### 2. Fill price contradicts the bar-forming animation

**Affects:** `game-design.md`

Two statements that can't both be true appear in the same section:

> *"Fill is at the close of the pole the character is currently standing on —
> that price is already visible on screen when the player presses."*

> *"The newest bar grows from the ground up to its close height… the character
> rides it up or down."*

If the bar is still growing, its final close is not yet visible. A developer
reading both sentences cannot determine the actual fill price.

**Needs:** An explicit statement that the growth animation is purely
cosmetic and fills always execute at the bar's completed close, or an
alternative model stated without contradiction.

---

### 3. Stop level adjustment mid-run has no UI or interaction design

**Affects:** `controls.md`, `hud.md`, `config.md`, `game-design.md`

All four docs agree stop levels can be adjusted on an open position during a
run, and `config.md` calls this a deliberate exception. None of them specify
*how* — no keyboard binding, no HUD widget, no mobile interaction surface.
Additionally, when editing a trailing stop, the semantics of "best price
reached" after the edit are unspecified: does it reset to current price, carry
forward, or apply the new percent from the existing best?

**Needs:** A concrete control path for desktop and mobile, and explicit math
for trailing-stop edits.

---

### 4. Key TypeScript interfaces are never defined

**Affects:** `data-sources.md`, `indicators.md`

Three types are used throughout the docs but their shapes are never given:

- `OhlcvBar` — referenced in `indicators.md`'s contract; no field names, types,
  or date format defined.
- `PriceSeriesSource` — described conceptually; no method signatures.
- `ParamSpec` — used in `IndicatorPlugin.params: ParamSpec[]`; the shape
  (name, type, min/max, default, unit) is never specified.

Without `ParamSpec` the settings UI for indicators can't be built. Without
`OhlcvBar` the data layer and every indicator are built against an unknown
shape.

**Needs:** Explicit TS interface definitions for all three, including async
behaviour, timestamp format, ticker metadata, and optional fixed-range
metadata for oscillator indicators.

---

### 5. `log-price` can't be expressed by the single-field normalization config

**Affects:** `game-design.md`, `config.md`

`game-design.md` correctly describes `log-price` as a *pre-transform, not a
standalone method* — it composes with another method (e.g. "log +
visible-window-min-max"). `config.md` models `poleHeightNormalization` as a
single string enum and lists `log-price` as one of its values, making valid
combinations impossible to represent.

**Needs:** Split into two config fields:
`priceTransform: 'none' | 'log10'` and
`normalizationMode: 'visible-window-min-max' | 'fixed-price-per-pixel' | 'starting-price-relative'`.

---

### 6. Shorting has no margin or account model

**Affects:** `game-design.md`, `config.md`

Long buying power is bounded by `startingCapital`. For shorts there is no
equivalent: does a short require margin? Do short-sale proceeds go into cash
(increasing long buying power), or are they locked as collateral? Without
this, `allowShorting: on` cannot be implemented without inventing the rules.

**Needs:** A minimal short-account model — maximum short notional, whether
proceeds are locked, and the buying-power formula for short positions.

---

### 7. Per-tick order of operations is unspecified

**Affects:** `game-design.md`, `controls.md`

Same-bar edge cases are partially covered (buy+sell on same bar: both apply
in press order; stop + manual exit: first one wins). The full deterministic
pipeline is not defined:

- Does stop evaluation happen before or after input collection?
- When does the new bar spawn relative to input processing?
- Is input ignored during the `Stopped-out` transient state, and for how long?

**Needs:** An explicit ordered tick pipeline, e.g.:

1. Collect inputs
2. Apply in press order
3. Evaluate stop triggers
4. Resolve auto-close if triggered
5. Finalize bar / spawn next
6. Update HUD, audio, and state

---

### 8. Run termination states and transitions are undefined

**Affects:** `controls.md`, `game-feel.md`, `game-design.md`

`game-design.md` says the run ends "when data runs out or the player chooses
to stop." `controls.md` only defines `pause → resume / restart / quit`. Does
quit score the run and show the results screen? Discard it silently? Return
to settings? The phrase "player chooses to stop" is used without mapping to
any concrete input.

**Needs:** An explicit state diagram: `Playing → Paused →
(resume / restart / end-with-score / quit-without-score)` and
`Data Exhausted → Results Screen`, with each transition's effect on
persistence and stats.

---

## 🟡 Notable — Should Be Resolved Before the Affected Milestone

### 9. "Denied" cue has no audio or visual design

**Affects:** `audio.md`, `character.md`

`game-design.md` and `controls.md` both require a "denied" feedback cue for
disallowed actions (sell while flat with shorting off, entry with no buying
power). `audio.md` does not include a denied stinger in any theme.
`character.md` does not describe any visual feedback for the state.

**Needs:** The denied cue assigned a home in at least one of `audio.md` or
`character.md`, and noted as theme-supplied.

---

### 10. Short-side exits are conflated with "sell" in audio and game-feel

**Affects:** `audio.md`, `game-feel.md`

`audio.md` names stingers `sellProfit` / `sellLoss`. `game-feel.md` triggers
floating P&L text "on every sell." When short, the closing action is `buy`,
not `sell` — these systems will misfire on short exits.

**Needs:** Redefine the triggering events as `positionClosed/profit` and
`positionClosed/loss` (plus direction and action), not raw button names.
Update stinger names and floating-text trigger accordingly.

---

### 11. Win/loss/trade unit is undefined for scaled entries and exits

**Affects:** `game-design.md`, `game-feel.md`

`game-design.md` tracks "win/loss trade count, average win size, average loss
size." `game-feel.md` builds a win-streak multiplier on top of this. But what
counts as one trade? Each buy/sell press? Each full flat-to-flat cycle? When
scaling (3 buys, 2 partial sells, 1 final close), that is 1 campaign or 6
events — the streak mechanic gives different results for each interpretation.

**Needs:** A definition of "trade" for stats purposes (recommendation:
flat-to-flat campaign for win/loss, individual close events for streak ticks).

---

### 12. Streak meter is missing from the HUD layout

**Affects:** `hud.md`, `game-feel.md`, `roadmap.md`

`game-feel.md` specifies a "streak meter in the HUD, visibly filling/draining"
and the roadmap folds this into step 3 (before visuals). `hud.md` does not
mention it, so no screen real estate is reserved — especially a problem on
mobile where the layout is already tight.

**Needs:** Streak meter placement added to `hud.md`, including mobile
behaviour.

---

### 13. Portrait phone wireframe (roadmap step 0a) does not exist

**Affects:** `roadmap.md`

The roadmap explicitly requires a wireframe showing the top HUD, right-edge
axis, character position, sub-panes, and mobile control strip together in
both landscape and portrait *before* writing the render loop. This wireframe
is not in the docs. It is the one item the roadmap itself says to produce
before implementation begins.

**Needs:** The wireframe, created as step 0a before starting step 1.

---

### 14. Bundled dataset is unspecified

**Affects:** `data-sources.md`

`data-sources.md` says to bundle "a few tickers' daily OHLCV bars" but does
not name which tickers, which date ranges, or whether the data is
split-adjusted. A split-unadjusted series with a 4:1 split mid-run would look
like a 75% crash in the game.

**Needs:** Named tickers, date ranges, and confirmation that all bundled data
is split-adjusted (and dividend-adjusted, or not, with the choice stated).

---

### 15. Personal-best fingerprint is not defined

**Affects:** `game-feel.md`, `tech-stack.md`, `config.md`

The docs are careful about score comparability (% return for cross-ticker
comparison), but don't define what makes two runs comparable for personal-best
purposes. A run at `scrollSpeed=2` vs. `scrollSpeed=0.5` on the same ticker is
not the same challenge.

**Needs:** A run fingerprint definition — the set of config keys (ticker, date
range, scrollSpeed, allowShorting, startingCapital, …) that must match for two
runs to share a personal-best bucket. Keys intentionally excluded from the
fingerprint should be listed too.

---

## Summary Table

| # | Finding | Severity | Doc(s) to update |
|---|---|---|---|
| 1 | Trade sizing unit and rounding model | 🔴 Blocking | `game-design.md`, `config.md` |
| 2 | Fill price vs. bar-forming animation contradiction | 🔴 Blocking | `game-design.md` |
| 3 | Stop level adjustment mid-run — no UI or semantics | 🔴 Blocking | `controls.md`, `hud.md` |
| 4 | `OhlcvBar`, `PriceSeriesSource`, `ParamSpec` interfaces missing | 🔴 Blocking | `data-sources.md`, `indicators.md` |
| 5 | `log-price` as pre-transform can't be expressed in single-field config | 🔴 Blocking | `config.md`, `game-design.md` |
| 6 | Shorting has no margin/account model | 🔴 Blocking | `game-design.md` |
| 7 | Per-tick order of operations missing | 🔴 Blocking | `game-design.md` |
| 8 | Run termination states and transitions undefined | 🔴 Blocking | `controls.md`, `game-feel.md` |
| 9 | "Denied" cue has no audio/visual design | 🟡 Notable | `audio.md`, `character.md` |
| 10 | Short-side exits conflated with "sell" in audio/feel | 🟡 Notable | `audio.md`, `game-feel.md` |
| 11 | Win/loss/trade unit undefined for scaling in/out | 🟡 Notable | `game-design.md`, `game-feel.md` |
| 12 | Streak meter missing from HUD layout | 🟡 Notable | `hud.md` |
| 13 | Portrait wireframe (roadmap step 0a) not produced | 🟡 Notable | New artifact |
| 14 | Bundled dataset tickers/ranges/split-adjustment unspecified | 🟡 Notable | `data-sources.md` |
| 15 | Personal-best run fingerprint not defined | 🟡 Notable | `game-feel.md`, `tech-stack.md` |
