# Game Hub — project instructions

Vanilla JS + Canvas arcade hub. No framework, no build step, no dependencies,
no `package.json`. Plain ES modules loaded by the browser.

## Run

Serve the folder over HTTP (required — dynamic `import()` fails on `file://`):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

There is no test suite or linter. Verify changes by playing the affected game
in a browser (desktop keyboard + mobile swipe) and checking the console for
errors. After editing JS/CSS, do a hard refresh.

## Structure

- `index.html` — hub screen (game cards + trophy buttons) and game screen
  (`#game-container`, where every game injects its DOM). One static file; no
  per-game markup.
- `js/hub.js` — shared shell: card → startGame, dynamic module import, back
  button, trophy high-score popover. Reads `data-game` / `data-trophy`
  attributes.
- `js/games/<id>/<id>.js` — one self-contained module per game. Adding a game
  never touches other game files.
- `js/games/<id>/` — per-game shared-module subfolders live here if needed.
- `style.css` — the single global stylesheet (hub + all games). Games only add
  inline styles for things scoped to their canvas (e.g., filter blur).
- `design/` — one PRD per game (`<game>-prd.md`). PRDs are the source of truth
  for mechanics, visuals, controls, and high-score behavior. Read the game's
  PRD before implementing or changing that game.
- `reference/` — visual reference assets (images). Never read images unless
  explicitly asked; they are art references, not code.

## How games plug in (contract — do not change)

Each `js/games/<id>/<id>.js` module exports exactly one factory:

```js
export function init(container) {
    // build canvas + HUD, add listeners, start loop
    return {
        destroy() {
            // cancel rAF, clearIntervals, remove ALL window/document listeners
        },
    };
}
```

- `hub.js` calls `module.init(gameContainer)` after `import
  ('./games/<id>/<id>.js')`; the returned `destroy()` runs on "Back to Hub"
  and before any new game starts.
- `destroy()` must leave no leak: the game's interval timers, animation
  frames, `window`/`document`/canvas listeners, and appended DOM must all be
  cleaned up. Use a `destroyed` flag so pending frames no-op early.
- Global `GAME_NAMES` in `hub.js` and the `data-game`/`data-trophy` attributes
  (`snake, tetris, breakout, flappy, racer, pinball`) are the hub↔game ID
  contract.

## Common logic

- **High scores**: `localStorage` key `<gameId>_highscores`, an array of
  `{ initials, score, date }`, sorted desc (`b.score - a.score`), capped at
  the top 5. `hub.js` reads the same key for the trophy popover.
- **Game over modal**: build an overlay div (`modal-overlay` / `modal`,
  `role="dialog"`), show final score, render the leaderboard via
  `escapeHtml`, collect 0–3 uppercase initials (default `'???'`), save once,
  then offer Play Again.
- **Loop shape**: fixed-timestep logic via `setInterval(tick, TICK_MS)`, fluid
  rendering via `requestAnimationFrame` interpolating between ticks. Cancel
  and re-create both on reset; never start a second one.
- **Audio**: Web Audio API oscillator (`playSound(freq, type, duration)`),
  resume a suspended AudioContext before playing, no audio files.
- **Input**: keyboard via `window.keydown` switch on `e.key`; touch via swipe
  delta on the canvas (threshold ~24px) with `{ passive: false }` and
  `preventDefault` to block page scroll/pull-to-refresh.
- **Reduced motion**: honor `prefers-reduced-motion: reduce` — disable pulse,
  particles, pop animations when it matches.
- **XSS**: any user text (initials!) inserted through `innerHTML` must go
  through the `escapeHtml` helper.

## Style

- 4-space indentation; double quotes in HTML/CSS, single quotes in JS.
- Colors: use tokens from `:root` in `style.css` (`--bg-base`, `--accent`,
  `--text-primary`, `--surface`…). Game-canvas art colors may be per-game
  literals like snake's `#4ade80` but stay within the dark theme.
- Keep globals in `style.css` with a `[hidden] { display: none !important; }`
  and `overscroll-behavior: none` invariant — don't defeat them.
- Switch statements over `e.key` for controls; `document.createElement`
  (not `innerHTML`) for canvas/HUD DOM where feasible.
- Keep each game module self-contained; do not import between game modules.

## Don't

- Don't add frameworks, npm dependencies, or a build step.
- Don't edit generated files or turn `index.html` markup into dynamic DOM.
- Don't break accessibility: keep `aria-label`s on buttons, `role="dialog"`
  + `aria-modal` on modals, skip link intact.
- Don't commit `.DS_Store` or binary assets without need.
