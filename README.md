# Candle Jumper

A Flappy Bird–style side scroller where the poles are real daily stock prices
and the only inputs are **buy** and **sell**. There is no death condition — the
run ends when the price data runs out or you choose to stop. It's a
trading-habit trainer wearing an arcade runner's clothes: you're scored on
realized P&L and on whether you honoured your own risk rules, not on survival.

Everything runs in the browser. No server, no API, no art or audio files —
every visual and every sound is generated at runtime.

**Playing now at <https://www.candlejumper.com>** — deployed from `main` on every
push (see [deploying](#deploying)).

## Requirements

- **Node 20.19+** or **22.12+** (Vite 8 requires one of those)
- npm

## Run it

```sh
npm install
npm run dev
```

Vite prints a local URL (usually <http://localhost:5173>). You land on the title
screen with the game playing itself behind it. **Play** starts a run with the
current settings, **Surprise me** picks a random ticker and date window, and
**Settings** is there when you want to change something — the defaults are a
perfectly good first run.

The title screen plays the selected theme's music bed, and only that: there's
nothing to sonify behind a menu. It starts on your first click or keypress rather
than on page load, because browsers refuse to start audio before a user gesture.

## Build it

```sh
npm run build     # typechecks, then builds to dist/
npm run preview   # serve the built output
```

`dist/` is plain static files — an `index.html` plus hashed assets. There is
nothing server-side, so any static host will serve it (see
[deploying](#deploying)).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run check` | typecheck + lint + tests — run this before committing |
| `npm test` | run the test suite once |
| `npm run test:watch` | tests in watch mode |
| `npm run typecheck` | `tsc --noEmit` plus `svelte-check` |
| `npm run lint` | ESLint, including the import-zone rules |
| `npm run build` | typecheck then production build |
| `npm run preview` | serve `dist/` locally |
| `npm run desktop:dev` | Tauri dev shell — **needs a Rust toolchain** |
| `npm run desktop:build` | Tauri release build — same |
| `npm run android:sync` | build, then sync into the Capacitor Android project |

Neither native CLI is a dependency; those scripts fetch on first use, so the web
build's install stays small. See [docs/packaging.md](docs/packaging.md) — the
shells are **configured but unbuilt**.

## Controls

| Action | Keys | Touch |
|---|---|---|
| **Buy** — open a long, add to a long, or reduce a short | `↑` or `W` | button, bottom right |
| **Sell** — reduce a long, or open/add a short when shorting is enabled | `↓` or `S` | button, bottom left |
| **Flatten** — close every open unit at once | **hold** `↓`/`S` for ~400ms | **hold** the left button |
| **Pause** | `Esc` or `P` | icon, top right |

Thumb buttons appear on a coarse pointer only — a small desktop window still has
a mouse, and the keyboard is the better control there.

Up-is-buy is deliberate: the character jumps *up* onto poles when long and
hangs *beneath* them when short, so the control direction, the price direction,
and the character's position all agree.

Note that `↑` on a short is an **exit**, not an entry. Presses are counted in
units, and N entries always take exactly N exits to get back to flat — the unit
count in the HUD is how many exit presses you have left.

**How to play** on the title screen says all of this in the game, and adapts to
whether you're on a keyboard or a touchscreen.

## What you're looking at

- **Poles** are daily closing prices. One pole per trading day.
- **Nothing to the right of the character.** A pole only appears once it reaches
  you. That's not a rendering choice — an upcoming pole is a future price, and
  being able to see one would make every trade trivially correct.
- **The newest pole grows** from the ground up to its close, and you land on it
  as it finishes. You commit before you see the final height, which is the same
  commitment a real trader makes intraday.
- **The dashed line** is an *advisory* stop — the shipped default. It shows you
  where your own rule says to exit but never closes the position for you. A
  solid line is an enforcing stop, which does.
- **The five pips** are the discipline streak. It measures whether you honour
  your rule, not whether you win: a loss taken because your rule said to exit
  builds the streak exactly as a win does. Only ignoring a breached level breaks
  it.
- **Faint vertical lines** mark month, quarter, and year boundaries — so you can
  tell where you are in a run without the date readout.
- **Ghosts trailing the jumper** are your open units, one each, so "I'm three
  deep" reads at a glance. Past five it becomes a badge.

**Nothing is locked.** Every jumper and both moods are available from the first
run — hiding finished cosmetics behind a grind would make the game worse at what
it's for. Badges record habits worth noticing instead, and they're earned on
discipline rather than profit: finishing a run that traded and broke no rule
counts, a lucky number doesn't. **Record** on the title screen shows your lifetime
totals, led by clean runs rather than P&L.

## Your own stop rules and indicators

**Settings → Plugins** imports ES modules that default-export the stop or
indicator contract. They run in a **Web Worker** with no DOM, no filesystem, and
no access to the app — that sandbox is the only place imported code executes, and
it matters more here than in a plain browser tab because the packaged desktop and
mobile builds hand the web view a bridge to native APIs.

A stop that throws or stops answering is **disabled and announced on screen**: a
dead stop silently removes risk protection mid-position, which is the one failure
worth interrupting a run for. A dead *indicator* just draws nothing.

## Deploying

Live at **<https://www.candlejumper.com>**, on Azure Static Web Apps' free tier.
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publishes every
push to `main`, and gives each pull request its own preview URL.

The build output is entirely static, so any static host works. Two ways to wire
one up, and the difference matters:

| | Host builds it | Build in CI *(what this repo does)* |
|---|---|---|
| `app_location` | `/` | `dist` |
| `output_location` | `dist` | *(empty)* |
| `api_location` | *(empty — there is no API)* | *(empty)* |
| `skip_app_build` | — | `true` |

With the host building, `output_location` is where its build system will leave
the result. With the build already done, there is no build step to leave anything
anywhere, so the artifact path is `app_location` itself.

Building in CI is worth the extra lines: it pins the Node version, and it means
`npm run check` gates the deploy. `npm run build` only typechecks, so a
host-built deploy will happily publish a commit that fails every test.

Four things that will bite you:

- **Check what registry your lockfile points at.** If `npm config get registry`
  names an internal mirror, every `resolved` URL in `package-lock.json` points
  there too, and `npm ci` fails on any runner that can't reach it. Nothing local
  catches this — `npm ci` passes on the machine that can. `.npmrc` pins the public
  registry, but an `npm_config_registry` environment variable outranks it, so
  check the env too.
- **Pin the Node version** — `engines` here, or your workflow's platform version.
  A build platform defaulting to an older Node is the most likely cause of a
  failed deploy.
- **Downloading a ticker doesn't work on a plain static host.** The dev server
  proxies the price APIs to dodge CORS; a built bundle has no proxy, so visitors
  need a CORS extension unless the host can rewrite to an external origin. See
  [data-sources.md](./docs/data-sources.md#cors-is-the-whole-difficulty). Bundled
  datasets and CSV/JSON import work everywhere.
- **`localStorage` is per-origin**, so nothing follows you from `localhost:5173`
  to the deployed site — personal bests, settings, and the downloaded price
  library all start empty there. Within an origin it's also per-browser and
  doesn't sync across devices, which is the intended scope, but on a public URL
  it means a visitor's history disappears if they clear site data.

## Project layout

```
src/
├── shared/      contracts at every seam; imports nothing at all
├── config/      the config tree, validation, run fingerprint
├── content/     themes and characters as parameter sets — plain data
├── engine/      the trading engine. No PixiJS, no Tone.js, no DOM. Ever.
├── generation/  procedural art as numbers, so it's snapshot-testable
├── data/        the bundled OHLCV datasets, the source interface, downloads
├── plugins/     the worker sandbox, the host, and the shipped plugins
├── render/      PixiJS lives here and only here
├── audio/       Tone.js lives here and only here
├── input/       device listeners and gestures; the last place button names exist
├── platform/    the ONLY place Tauri/Capacitor APIs may be imported
├── ui/          Svelte. Menus and screens only, never the game world.
└── app/         composition root: screen routing, run lifecycle, the loop
```

Those boundaries are **enforced by lint rules**, not convention — `npm run lint`
fails if the engine imports PixiJS, if the plugin worker imports anything but
`shared/`, if anything outside `platform/` touches a native bridge API, or if
`Math.random()` appears anywhere. See
[docs/code-structure.md](docs/code-structure.md) for why each rule exists.

## Documentation

Design docs live in [`docs/`](docs/), indexed by
[docs/README.md](docs/README.md). Start with
[game-design.md](docs/game-design.md) for the core loop and
[roadmap.md](docs/roadmap.md) for build order.

Decisions taken while implementing — including the ones the design docs left
open — are logged in
[docs/implementation-details.md](docs/implementation-details.md). Where that log
and a design doc disagree, the doc wins.

## Status

All eleven roadmap steps are implemented, with one honest exception: the native
shells (step 11) are **configured but never built**, because Tauri needs a Rust
toolchain and Capacitor needs the Android SDK, and neither was available in the
environment they were written in. Expect to fix something there;
[docs/packaging.md](docs/packaging.md) lists what's known to be missing.

Deliberately deferred, each recorded in the owning doc: mood-reactive backgrounds,
day/night drift, FIFO cost basis, a post-run replay mode, rebindable controls,
indicators beyond SMA and ATR, margin interest on shorts, and shorting exposed by
default (the engine supports it; `allowShorting` ships off).

The numeric defaults marked *provisional* in
[docs/config.md](docs/config.md) still are: they were chosen for internal
consistency and want playtesting, not arithmetic.

## License

MIT — see [LICENSE](LICENSE).
