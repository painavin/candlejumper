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
- **Color** as reinforcement only, never as the carrier. The default palette is
  **red/green**, because that is the language traders already read and this is a
  trading trainer; **blue/orange** is available as one setting away, and stays
  distinguishable under all common forms of colorblindness.

  The default is a deliberate choice, and it is only defensible *because* of the
  two channels above. Red/green as the sole encoding would make the game's
  central signal unreadable for ~8% of men; red/green on top of an explicit
  `+`/`−`, an up/down arrow, and position relative to the reference line is a
  redundant third channel. If any P&L indication ever ships relying on hue
  alone, this default has to be revisited rather than the encoding rule bent.

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
  first thing to become unreadable on a phone. Enforced in one place
  (`render/hud/hudFont.ts`) rather than spread across the literals that
  set sizes — a floor repeated in six files is a convention, not a floor.
- **Every HUD glyph is outlined**, in a colour the theme supplies as
  `accent.outline`. This is structural rather than cosmetic: the HUD is
  drawn directly over a moving scene — a sky gradient, clouds passing
  behind it, candles scrolling through it — so **no single fill colour is
  legible everywhere**. Choosing a better fill can only move which part of
  the frame is unreadable; an outline makes the contrast travel with the
  text instead of depending on what happens to be behind it.

  Two consequences worth stating, because both look like mistakes:

  - `accent.dim` is *close* to `accent.text` in both themes rather than
    much darker. With an outline, secondary text reads as light-on-dark-edge,
    so pushing it toward the text colour raises contrast. A darker `dim`
    would fight the outline rather than rest on it.
  - A theme with **dark** HUD text would need a light outline. That's why
    the colour is theme data and not a constant.

  Style goes through `render/hud/hudText.ts` for the same reason sizes go
  through `hudFont.ts`: seven files construct HUD `Text` objects, and a
  treatment applied seven times decays the first time someone adds an
  eighth.
- Axis price labels are drawn in the **primary** text colour, not the dim
  one. A price level is a value the player reads off the chart to decide
  with, so it isn't secondary information.
- The `visibleBarCount` default (~60, see
  [game-design.md](./game-design.md#scroll-speed-timing-and-pole-geometry))
  exists partly for this reason — more bars means thinner, less legible
  poles.
- `scrollSpeed` is configurable down to 0.5 bars/sec, which doubles as an
  accessibility affordance for players who need more time to react.
