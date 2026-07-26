# Accessibility

Spans visuals, audio, and motion, so it lives in one place rather than
scattered across those docs.

## Profit/loss coloring — never color alone

Red/green is the default language of trading and simultaneously the worst
possible choice for red-green colorblindness (~8% of men). Since P&L
direction is *the* information this game conveys, it can never be encoded
by hue alone.

Every profit/loss indication carries at least two channels:

- **Sign and shape**, always: explicit `+`/`−` prefixes, and arrow or
  triangle glyphs pointing up/down, on floating P&L text
  ([game-feel.md](./game-feel.md)), the HUD readout
  ([hud.md](./hud.md)), and the results screen.
- **Position**, where available: gains above the reference line, losses
  below.
- **Color** as reinforcement, from a colorblind-safe pair — **blue/orange**
  rather than red/green as the default palette, which stays distinguishable
  under all common forms of colorblindness. A `redGreen` palette option
  remains available for players who prefer the familiar trading
  convention.

The theme accent palettes in [visuals.md](./visuals.md) must not override
this — mood themes skin the world, not the P&L semantics.

## Motion

- **Screen shake toggle** ([game-feel.md](./game-feel.md)), default on but
  prominently disableable.
- A broader **reduced-motion setting** that also damps parallax layer
  movement, particle bursts, and screen transitions. Honor the OS-level
  `prefers-reduced-motion` as the initial default rather than making
  players find the setting.
- The foreground occlusion layer ([visuals.md](./visuals.md)) is the most
  likely motion irritant since it crosses the character — reduced motion
  should thin or disable it.

## Audio

- Nothing may be conveyed by sound alone. The audio design in
  [audio.md](./audio.md) is already additive — sonification and stingers
  duplicate information that's visible on screen — and it must stay that
  way, since the game has to be fully playable muted.
- Independent volume/mute per channel is already specified there.

## Readability

- Minimum font sizes on the HUD, which is dense with numbers and is the
  first thing to become unreadable on a phone.
- The `visibleBarCount` default (~60, see
  [game-design.md](./game-design.md#scroll-speed-timing-and-pole-geometry))
  exists partly for this reason — more bars means thinner, less legible
  poles.
- `scrollSpeed` is configurable down to 0.5 bars/sec, which doubles as an
  accessibility affordance for players who need more time to react.
