# PRD: Star Cadet Pinball

A full-table, sci-fi pinball machine in the spirit of the classic Microsoft Pinball
Arcade tables (3D Pinball for Windows — Space Cadet). Original artwork and naming;
same arcade feel: a dense, lit-up playfield with ramps, spinners, drop targets,
kickbacks, and a ball-save system. Replaces the former "Micro-World" desk-themed
table entirely.

## 1. Overview

- **Genre:** Single-screen top-down pinball, dependency-free canvas + hand-rolled
  physics (same engine family as the previous version, generalized).
- **Canvas:** 460 × 760. The machine fills the frame: LED-score HUD strip on top,
  cabinet rails and a starfield background around the playfield, apron below.
- **Hub identity:** game id stays `pinball` (storage key `pinball_highscores`,
  hub contract unchanged). Display name: **Star Cadet Pinball**.

## 2. Table anatomy (top → bottom)

- **Dome** with ringed-planet artwork; balls wrap around it after launch.
- **Top rollover lanes (3):** wire dividers; each lane's value steps up as you
  roll it (100 → 250 → 500 → 1000, persists all game). Lighting all three
  lanes steps the multiplier ×2 → ×3 → ×4 → ×5 (cap) and re-lights them.
- **Pop bumpers (3)** in a triangle + a small **jet bumper** upper-left.
- **"Black Hole" saucer** upper-left: a gravity well — the rubber ring has a
  mouth facing the field, and inside a ~2.2-unit radius the hole's pull
  (with a light swirl) out-competes the table tilt, so passing balls visibly
  curve toward it. Slow balls (under ~19 u/s) entering the mouth are swallowed
  for 0.9 s (+4,000 × mult) and re-enter via the left inlane kicker; fast
  shots rebound off the rubber lip or skip across the hole.
- **Right ramp with spinner:** entry mouth above the right flipper area, one-way
  (needs a solid upward shot). Riding the ramp spins the spinner (250/spin × mult).
  Completing the ramp = 1,500 × mult and a ball-feed into the top lanes.
- **Drop-target bank (5)** at the left flank: completing the bank = 2,500 × mult,
  re-arms ball save, resets the bank.
- **Stand-up targets (2)** on the right: light the outlane kickbacks; both lit =
  +2,000 and clears.
- **Lower wiring (both sides):** outlane (with rollover + kickback plunger),
  guide rail, inlane (rollover + top kicker feeding the orbit), slingshot above
  each flipper, narrow center drain between long flippers.
- **Shooter lane** on the right with a charging plunger and a one-way gate at the
  lane mouth; a weak launch simply re-seats the plunger (no ball lost).

## 3. Systems

- **Ball save:** auto-armed 18 s at every ball start (siren + HUD countdown);
  re-armed by drop-bank completion and by hitting a lit stand-up pair. A saved
  ball re-enters through the left inlane. The first ball of the game is always
  saved (no ball is ever lost on ball 1's first plunge).
- **Kickbacks:** left outlane rollover lights the left kickback, right outlane
  rollover lights the right. A lit kickback fires when its ball reaches the
  outlane bottom — but only 70 % of the time: a dud thuds audibly, the ball
  carries on down, and the charge stays lit for the next ball through.
- **Hot bumpers:** 30 % of pop-bumper hits land "hot" and kick the ball
  10–20 % faster (extra sparks, higher-pitched pop).
- **Inlane rollovers:** left inlane = +500 × mult and re-arms a short (6 s) ball
  save; right inlane = lights the right ramp — the next ramp completion while
  lit scores 5,000 + re-arms 8 s ball save.
- **Ramp lit-jackpot:** ≥5 spinner rotations on one ride adds +5,000.
- **Extra ball (rare):** the first completed drop bank of the game lights
  "EXTRA BALL" for the rest of the game; one later bank completion awards
  exactly one bonus ball (max once per game).
- **Skill shot:** releasing the plunger with the charge meter in the marked
  window (82–95 %) = 1,500 × mult + 8 s ball save.
- **Multiplier:** persists across balls; resets to ×1 only on a new game.
- **3 balls** per game. No multiball, no missions/rank ladder, no nudge/tilt
  (deliberately out of scope).

## 4. Physics requirements

- Fixed 60 Hz logic, 6 substeps/frame, speed clamp; primitives: wall segments,
  arc-sampled rails, open rubber rings, one-way gate plane, slings, flippers
  (eased-angle capsule with surface-velocity impulse), kickers (directional,
  only when the ball moves into them).
- Black-hole well: inside its radius the hole's radial pull + tangential swirl
  replace the table tilt, and a light accretion drag bleeds orbit energy so any
  captured spiral decays into the swallow; hard shots (~20 u/s+) curve through
  and keep most of their speed.
- Ramp ride: ball attaches to a parameterized path, decelerated by the slope's
  gravity component; backs out of the mouth if too slow; ejects into the top
  lanes if it reaches the end. No tunneling through 0.1-unit walls at max speed.
- Anti-stuck: a slow-motion timer pokes the ball; gate pocket and lane are
  covered by the re-seat logic.

## 5. Visuals & HUD

- Dark indigo playfield with faint starfield texture, neon lane guides, glowing
  inserts under every rollover/target, chrome cabinet rails, planet art in the
  dome, "STAR CADET PINBALL" apron text below the table.
- LED-scoreboard strip: zero-suppressed 8-digit gold score with a "blackout"
  flash on big awards, BALL n, MULT, BEST, and small lights KB·L, KB·R, SAVE
  countdown, X-BALL. Banner text for events (BALL SAVE, EXTRA BALL, JACKPOT…).
- Screen shake, sparks, floating score text — all disabled under
  `prefers-reduced-motion`.

## 6. Audio (procedural Web Audio, no files)

Material "clack/thock" collisions retained; new voices: spinner tick, drop-target
clatter + bank-reset ratchet, saucer whoosh, kicker/kickback thump, ball-save
siren, extra-ball jingle, ramp roll sweep.

## 7. Controls

- Keyboard: `Space`/`↑`/`W` hold-and-release plunger (charge meter with skill-shot
  window); `←`/`A` and `→`/`D` flippers.
- Touch: hold anywhere to charge, release to launch; then left/right halves are
  the flippers. Same as the previous version.

## 8. Game over / scores

Unchanged hub pattern: initials entry (1–3 A–Z, only when score > 0), top-5
localStorage leaderboard under `pinball_highscores`, Play Again / Home buttons,
`hub:home` event.
