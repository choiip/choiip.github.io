# PRD — Neon Glide (3D Obstacle Racer)

**Game id:** `racer` · **Module:** `game-hub/js/games/racer/racer.js` · **Storage key:** `racer_highscores`
**Status:** v1 · **Depends on:** existing Game Hub shell (`hub.js`, `style.css`, `index.html`)

## 1. Summary

A fifth game for the Game Hub: a **pseudo-3D endless obstacle racer** in the spirit of OutRun / Pole Position. The player drives a neon low-poly car down a perspective-projected highway, changing between three lanes to dodge obstacles as speed ramps up. Distance = score. Top 5 runs are saved to `localStorage` with 3-character initials, identical to the other four games.

Rendering is **pure Canvas 2D with manual perspective projection** — no WebGL, no Three.js, no runtime dependencies, no downloaded assets. Everything (sky, road, car, obstacles, sounds) is generated procedurally.

## 2. Goals

| # | Goal |
|---|------|
| G1 | Feel genuinely 3D at 60 fps without a 3D engine — perspective scaling, culling, back-to-front painter's ordering |
| G2 | Playable with one thumb on a phone: lane-based steering, no virtual buttons, no on-screen D-pad |
| G3 | Skill-expressive: difficulty ramps with distance; near-misses reward risk |
| G4 | Match the hub's established quality bar — synthwave neon, juice (shake, particles, flash), Web Audio SFX only |
| G5 | Drop into the hub as a fifth card with zero changes to the other games |

## 3. Non-goals (v1)

- Real 3D math libraries, WebGL, shaders, or model files
- Multiplayer, ghost replays, leaderboards beyond local top-5
- Car customisation, garage, upgrades, currencies
- Steering-wheel analogue physics, drifting, track editor
- Curves/hills (deferred to v1.1)

## 4. Platform & constraints

- **Vanilla HTML/CSS/JS only.** Same module contract as the other games:
  ```js
  export function init(container) { /* ... */ return { destroy }; }
  ```
  Loaded by the existing dynamic import in `hub.js`: `./games/${gameId}/${gameId}.js` → forces the id `racer` and the folder/file name `racer/racer.js`.
- **Single canvas**, `class="game-canvas"`, fixed backing store, CSS `max-width: 100%; height: auto` (already global).
- Backing store **440 × 560** (11:14 portrait) — portrait maximises visible road depth on a phone; the road recedes into the upper third.
- **Fixed-timestep logic at 60 Hz** (accumulator) decoupled from a `requestAnimationFrame` render loop — the pattern proven in Snake, Breakout, and Tetris.
- **`prefers-reduced-motion` honoured**: no shake, warp streaks, shatter, slow-mo, red flash, or sun bob. Gameplay unchanged.
- **Audio** via Web Audio oscillators only; context created once, resumed on first user gesture (existing pattern).

## 5. Core loop

```
Card tap → 3-2-1 countdown → drive
  → speed climbs with distance
  → obstacles stream toward the camera
  → lane-switch to dodge (near-misses pay bonus)
  → take a hit → lose a shield, speed penalty, brief invulnerability
  → shields reach 0 → crash sequence → initials modal → Save / Play Again → back to hub
```

A run should last **45–120 s** for a decent player; a beginner should survive ~15 s. Death is always legible.

## 6. Gameplay specification

### 6.1 Lanes

- **Three lanes**, centres at road-space `x = -4, 0, +4` (lane width 4 units, road half-width 6.2).
- Lane change is a **120 ms** `easeOutCubic` tween with a body roll and a damped camera-x lag, so the road swings under a near-centre car (classic OutRun feel).
- **Input queueing:** one pending lane change is buffered and executed when the current tween finishes.

### 6.2 Speed & difficulty

`speed = min(MAX_SPEED, BASE_SPEED + distance * RAMP)` with `BASE = 52`, `MAX = 120` (units/s), `RAMP` tuned so the cap is reached at ~2500 m.

| Distance (m) | Pattern pool |
|---|---|
| 0–300 | barrier, blocker |
| 300–800 | + pillar pair, slalom |
| 800–1500 | + stagger |
| 1500+ | all, weighted toward complex patterns |

- Pattern spacing = `max(30, speed * 0.8)` units → **constant ≥0.8 s reaction lead** at any speed.
- On a hit, speed drops to 72 % and re-earns the ramp over ~1.5 s.

### 6.3 Obstacles

Projected boxes (top / near / side faces, neon edge stroke):

| Type | Footprint | Colour | Role |
|---|---|---|---|
| **Barrier** | 1 lane, low cube | amber `#fbbf24` | the basic dodge |
| **Blocker** | 2 adjacent lanes, tall crate | rose `#fb7185` | forces a commit |
| **Pillar pair** | 2 separated narrow prisms | magenta `#f472b6` | thread the gap |
| **Slalom** | alternating singles, 0.5 s apart | amber | rhythm test |
| **Stagger** | A-B-A lanes, 0.5 s apart | amber | reads as a wall with a seam |

**Fairness rule (asserted in the spawner):** no pattern occupies all three lanes in one z-window; single-lane patterns are spaced by ≥0.8 s of lead.

**Roadside props** (non-colliding, speed cue): neon pylons every 8 m alternating sides, a lit arch every ~120 m. Props fade in from the draw distance.

### 6.4 Scoring

```
score = floor(distance) + 25 * obstaclesPassed + 5 * nearMisses
```

**Near-miss:** passing with lateral gap < 1.0 unit (0.25 lane-widths) at speed > 55 % max → +5, spark burst, whoosh, "+5" floater.

### 6.5 Damage, shields, failure

- **3 shields** (chevrons in the HUD). A hit: -1 shield, 1.2 s invulnerable flicker, speed -28 %, red flash, shake, obstacle shatters into shards, low thud.
- At 0: **crash sequence** — car rolls over, debris, time slows to 35 % for 0.7 s, then the game-over modal.
- Road edges are solid — only obstacles kill (failure attribution stays clean).

## 7. Visual design

| Element | Colour |
|---|---|
| Sky top → horizon | `#0b0e1a` → `#4b2168` (cached offscreen) |
| Sun | gradient `#fde047` → `#fb923c` → `#ec4899`, notched scanlines, halo |
| City silhouette | `#0d0a1c` + sparse warm windows, static (camera-x parallax only) |
| Road | `#0e0e1e` base, `#171730` bands, cyan edge lines, magenta lane dashes |
| Car | periwinkle body, light roof, dark windshield, rose taillight bar, cyan underglow |
| HUD text | white numerals, `#a5b4fc` / `#c4b5fd` secondary |
| Card accent (hub) | `#f472b6` |

Scene layers, drawn back-to-front: sky → sun → skyline → road bands/edges/dashes → props → obstacles (far→near) → horizon fog → car → particles → warp overlay → flash → HUD.

## 8. Projection

World `(x, y, z)`: x lateral, y up, z forward. Camera at height 7.5, behind the car (car at z = 8).

```js
px(wx, z) = W/2 + (wx - camX) * K / z
py(z)     = HORIZON + CAM_H * K / z          // road surface
pyw(z,h)  = HORIZON + (CAM_H - h) * K / z    // height h
```

`K = H * 0.47` (px per world unit at z=1), `HORIZON = H * 0.42`, draw distance 190 units, road bottom crosses the canvas edge at z ≈ 6.05.

Road model: flat, straight, built from 4-unit alternating bands whose index is driven by `distance + z` (so bands scroll toward the camera). Lane dashes use a 3-on/3-off cycle the same way.

## 9. Controls

| Action | Keyboard | Touch |
|---|---|---|
| Steer | `←` / `→` (`A` / `D`) | horizontal swipe ≥ 24 px (ratchet: continuous drag steps one lane per 26 px) |
| Restart (after game over) | `Space` / `Enter` (when no modal focus) | modal buttons |
| Back to hub | back button | back button |

`touchmove` is `{ passive: false }` + `preventDefault()` while playing (no page scroll / pull-to-refresh), same as the other games.

## 10. HUD

- **Above the canvas** (shared element): `div.score-display` → `Score: N`.
- **In-canvas**: top-left score numerals + `km/h` + `m`; top-right `BEST` + three shield chevrons (dimmed when lost).
- **Start countdown** 3 → 2 → 1 with beeps, then a brief `GO!`.

## 11. Juice

- **Warp streaks** from the vanishing point above 70 % speed (intensity ∝ speed)
- Lane-change body roll + camera lag + tyre blip
- Near-miss sparks + whoosh + floater
- Hit: red vignette, 6 px shake, shard burst in the obstacle colour, hit-stop feel via slow re-ramp
- Crash: roll-over spin, debris, time dilation, descending tone
- Engine: sawtooth through a low-pass, pitch/following speed

All disabled under `prefers-reduced-motion` except audio and the score floater.

## 12. Persistence & high scores

- Key `racer_highscores` → `[{ initials, score, date }]`, sorted desc, top 5 — same shape as the other games, so `hub.js`'s trophy popover works unchanged.
- Initials modal reuses the shared markup/classes (`.modal-overlay`, `.modal`, `.leaderboard`, `.initials-form`, `.modal-actions`, `.btn`), ids namespaced `racer-*`.
- 3 chars, uppercased, `???` fallback, input autofocused, `aria-live="polite"` leaderboard.

## 13. Hub integration

| File | Change |
|---|---|
| `index.html` | Fifth `.game-card[data-game="racer"]` with `.play-area`, 🏎️ icon, title "Neon Glide", tagline, and `.trophy-btn[data-trophy="racer"]` |
| `js/hub.js` | `racer: 'Neon Glide'` in `GAME_NAMES` |
| `style.css` | `.game-card[data-game='racer'] { --card-accent: #f472b6; --card-accent-glow: rgba(244, 114, 182, 0.35); }` |
| Favicon | Left unchanged (2×2 of the original four accents) — 5 tiles would crowd it |

## 14. Accessibility

- Canvas `role="img"` + descriptive `aria-label`; keyboard-completable end to end.
- Game-over announced through the existing modal semantics (`role="dialog"`, autofocused input, live leaderboard).
- HUD text ≥ 4.5:1 against sky/road; numerals get a dark stroke.
- Shields change shape (dimmed chevron), not colour alone.
- `prefers-reduced-motion` strips continuous motion and time dilation.

## 15. Performance budgets

- **60 fps** on a mid-range phone; fixed 60 Hz logic.
- ≤ ~120 draw calls/frame; obstacles culled beyond the draw distance and behind the car.
- Sky, sun, and skyline are **pre-rendered offscreen** — no per-frame gradient creation.
- No allocations in the hot loop (swap-pop particle removal, reused maths).

## 16. Architecture

```
game-hub/js/games/racer/racer.js
├── constants, helpers (shade, withAlpha, easeOutCubic, mulberry32)
├── audio (engine osc + filter + gain, blip SFX)
├── backdrop (sky / sun / skyline offscreen canvases)
├── projection (px, py, pyw)
├── scene (road, props, obstacles, car, particles, warp, fog, HUD)
├── spawner (pattern pool + fairness by construction)
├── input (keydown, touch swipe ratchet, lane tween + queue)
├── update(dt) / render(t) / frame(now)
└── lifecycle (resetRun, startCrash, gameOver, destroy)
```

`destroy()` cancels rAF, removes all listeners, stops the engine oscillator, and closes the audio context.

## 17. Verification plan

1. `node --check` the module.
2. Serve `game-hub`, open in the agent browser, assert **zero console errors**.
3. **Pixel assertions:** sky above / road below the horizon with a sharp boundary; road narrows toward the horizon; car centroid shifts ~1 lane after a synthetic swipe; obstacle colour appears for a forced pattern; red frame + chevron count drops on a forced hit; score increases with distance.
4. **Autopilot:** in-page scanner reads the mid-distance band, locates the road centre via the cyan edges, classifies lane occupancy, and dispatches steers; require survival ≥ 30 s with a rising score. A no-input run must die in bounded time (collision proof).
5. **Determinism:** temporary spawner patch (forced patterns), verify, revert, `cmp` against a saved copy (the documented pattern from the Tetris work).
6. **Persistence:** save a score, reload, trophy popover lists it, `BEST` shows it.
7. **Lifecycle:** back to hub → empty container, no leaked rAF.
8. **Viewports:** 375×667 touch + 1280×800 desktop; reduced-motion pass.
9. Screenshots: countdown, mid-run, warp, crash, modal.

## 18. Acceptance criteria (v1)

- [ ] Fifth hub card launches the game; back returns cleanly
- [ ] Convincing perspective road, sky, sun, skyline
- [ ] Lane steering via keyboard and touch swipes; no virtual buttons
- [ ] Obstacles spawn fairly and are dodgeable at all speeds
- [ ] Hits cost shields with clear feedback; 0 shields → crash → modal
- [ ] Score = distance + passes + near-misses; HUD live
- [ ] Top 5 saved with initials; visible in the trophy popover
- [ ] 60 fps, no per-frame allocations, no console errors
- [ ] `prefers-reduced-motion` fully honoured
- [ ] `destroy()` leaves no listeners, timers, or rAF behind

## 19. Deferred to v1.1

Curves and hills, boost pickups, combo multiplier, day-night cycle, rival cars, gear-shift audio.

## 20. Decisions (resolved)

| Question | Decision |
|---|---|
| Name | **Neon Glide** |
| Shields | 3 (fairer on mobile, more juice moments) |
| Canvas | portrait 440×560 |
| Curves/hills | v1.1 |
| Road edges | solid (never fatal) |
| Favicon | unchanged |

## 21. Milestones

| M | Deliverable |
|---|---|
| **M1** | Skeleton: module contract, canvas, cached backdrop, projected road, car, HUD stub, `destroy()` |
| **M2** | Motion: scrolling road, camera, speed ramp, distance/score, spawner |
| **M3** | Gameplay: all patterns, collision, shields, crash, modal, high scores, hub card |
| **M4** | Juice: warp, shatter, sparks, shake, near-miss, engine + SFX, countdown |
| **M5** | Polish: mobile swipe tuning, reduced-motion audit, a11y pass, verification sweep |
