# Product Requirements Document (PRD): Breakout

## 1. Product Overview
Breakout is a classic arcade game where the player controls a paddle to bounce a ball against a wall of bricks. The objective is to destroy all the bricks to win the game, while preventing the ball from falling past the paddle. Destroyed bricks may drop catchable power-up capsules, and the ball gradually accelerates as the wall breaks down.

## 2. Game Mechanics

### 2.1 Layout
- **Canvas Dimensions**: 480 $\times$ 320 px.
- **Paddle**: A horizontal bar at the bottom of the screen.
- **Ball**: A circular projectile that bounces off walls, the paddle, and bricks.
- **Bricks**: A grid of bricks (3 rows $\times$ 5 columns) arranged at the top of the screen.

### 2.2 Physics and Movement
- **Ball Trajectory**: The ball moves at a constant speed, reflecting off the top, left, and right walls.
- **Paddle Interaction**:
    - The ball reflects off the paddle.
    - **Angle Bounce**: The return angle of the ball is determined by where it hits the paddle (hitting the edges creates a sharper angle).
- **Brick Collision**: When the ball hits a brick, the brick is destroyed, the ball reflects, and the player earns points.
- **Difficulty Ramp**: Ball speed increases by 3% per destroyed brick, capped at +50% of base speed.

### 2.3 Ready Launch and Lives
- **Sticky Start**: The game (and every subsequent life) begins in a `ready` state with the ball parked on the paddle center. The player may move the paddle freely, then launches with `Space` (keyboard) or a tap (touch). Launch angle is $\pm15°$ off vertical.
- **Lives**: The player starts with 3 lives (displayed as glowing pips, top-right). Losing all active balls costs one life; power-ups and capsules are cleared, and the game returns to the `ready` state. At 0 lives the game ends.

### 2.4 Power-ups
Destroyed bricks have a 25% chance to drop a falling capsule (rounded pill, $\approx$90 px/s, gentle horizontal bob). Catching a capsule with the paddle applies its effect; re-catching a timed effect refreshes its duration. Effects are cleared on life loss and game over. Positive capsules glow in cool/warm colors; negative ones glow rose-red so the player can deliberately dodge them.

| Capsule | Glyph | Effect | Sign | Duration |
| :--- | :---: | :--- | :--- | :--- |
| Expand | W | Paddle width +50% | Positive | 10 s |
| Slow | S | Ball speed $\times$0.6 | Positive | 8 s |
| Catch | C | Paddle catches the ball; `Space`/tap releases it | Positive | 8 s |
| Multi-ball | M | Spawns 2 extra balls at $\pm25°$ (max 7 balls) | Positive | Instant |
| Shrink | N | Paddle width −40% | Negative | 6 s |
| Fast | F | Ball speed $\times$1.35 | Negative | 6 s |
| Extra Life | + | +1 life (max 5) | Positive | Instant |

Drop weights: Expand 20, Slow 18, Catch 15, Multi 15, Shrink 15, Fast 10, Extra Life 5. Active timed effects are shown top-left with a shrinking countdown bar.

### 2.5 Win/Loss Conditions
- **Win**: All bricks in the grid are destroyed.
- **Loss**: All lives are lost.

### 2.6 Scoring
- **Brick**: $10 \times$ current speed multiplier (so the ramp and effects scale the payout; minimum $\approx$6).
- **Catch bonus**: +25 for any positive capsule, +100 for Extra Life. Negative capsules award nothing.

## 3. User Interface (UI)

### 3.1 Visuals
- **Theme**: "Warm Neon" aesthetic with a color palette of Rose, Amber, and Orange.
- **Bricks**: 
    - Each row has a distinct color.
    - Bricks feature a 3D raised effect with a light top highlight and a dark bottom edge.
- **Paddle**: A neon-glow gradient bar (glow shifts amber while the Catch effect is active).
- **Ball**: A glowing sphere with a radial gradient.
- **Capsules**: Gradient pills with a colored glow and a dark letter glyph.
- **HUD**: Score counter and a mute toggle above the canvas; lives and active-effect strip drawn inside the canvas.

### 3.2 Controls
| Action | Keyboard | Touch |
| :--- | :--- | :--- |
| Move Left | `ArrowLeft` | Drag Left |
| Move Right | `ArrowRight` | Drag Right |
| Launch / release caught ball | `Space` | Tap |
| Mute music & SFX | — | Mute button (HUD) |

### 3.3 Game Over state
- **Modal**: Displays "You Win!" or "Game Over" along with the final score.
- **Persistence**: High scores are saved to `localStorage` under the key `breakout_highscores`.
- **Score Submission**: Allows players to enter up to 3 initials to record their score.

### 3.4 Audio & Music
- **Sound Effects**: Synthesized via Web Audio API (see §4.2).
- **Background Music**: A synthesized 4-bar chiptune loop (triangle-wave bass over Am–F–C–G with a square-wave arpeggio), scheduled with a lookahead against `audioCtx.currentTime` from the render loop — no audio files, no extra timers. Starts on the first user gesture (autoplay policy) and loops seamlessly.
- **Mute Toggle**: A button in the HUD mutes both music and SFX; the preference persists to `localStorage` under `breakout_muted`.

## 4. "Juice" and Polish (UX)

### 4.1 Animations
- **Comet Trail**: A fading trail of particles follows each ball during movement.
- **Smashed Bricks**: Bricks explode into colored "shards" upon destruction.
- **Flash**: A white radial flash appears at the point of impact when a brick is broken.
- **Squeezing/Squash**: The ball undergoes a brief "squash and stretch" animation upon colliding with walls or the paddle.
- **Screen Shake**: Triggered when bricks are destroyed, the ball launches, or a life is lost.
- **Confetti**: Spawns across the screen upon winning the game.
- **Capsule Bob**: Falling capsules sway gently to draw the eye; catch bursts spawn colored sparks and a floating label (e.g., `WIDE +25`).
- **Launch Hint**: A pulsing "PRESS SPACE / TAP TO LAUNCH" prompt during the `ready` state.

### 4.2 Audio
- **Sound Effects**: Synthesized via Web Audio API:
    - **Brick Hit**: A sine wave with a frequency that increases based on the brick's row (higher rows sound higher).
    - **Paddle Hit**: A mid-range sine wave.
    - **Launch / Catch release**: A triangle-wave blip.
    - **Positive Catch**: A rising triangle blip; **Negative Catch**: a low sawtooth buzz.
    - **Life Lost**: A short sawtooth fall; **Game Over**: a low-frequency sawtooth wave.

## 5. Technical Constraints
- **Physics Step**: Uses a fixed physics timestep (60Hz) to ensure consistent ball behavior across different refresh rates.
- **Collision Detection**: Implements a "least penetration" check for brick collisions to determine the correct reflection axis.
- **Ball Model**: Balls are stored in an array with normalized direction vectors; the movement magnitude is derived each step from `baseSpeed × ramp × effect multipliers`.
- **Music Scheduling**: Note scheduling runs inside the `requestAnimationFrame` loop and re-anchors `nextNoteTime` when the tab is backgrounded, avoiding note bursts on resume. No timers to leak.
- **Accessibility**: 
    - Supports `prefers-reduced-motion` to disable trails, shards, capsule bob, pulses, and screen shake.
    - The mute toggle is a real `<button>` with `aria-label` and `aria-pressed`.
- **XSS**: Initials rendered into the leaderboard modal pass through the shared `escapeHtml` helper.
