# Product Requirements Document (PRD): Tetris

## 1. Product Overview
Tetris is a classic tile-matching puzzle game where players must manipulate falling geometric shapes (tetrominoes) to create complete horizontal lines. The objective is to maximize the score by clearing lines and avoiding the accumulation of blocks to the top of the playing field.

## 2. Game Mechanics

### 2.1 Playing Field
- **Grid Dimensions**: 12 columns $\times$ 20 rows.
- **Gravity**: Pieces drop by one cell at the current speed level's interval (see §2.6; 1,000ms at level 1).
- **The "Arena"**: A backing store that tracks occupied cells and their colors.

### 2.2 Tetrominoes
The game implements the standard seven tetromino shapes, each with a unique color:
- **I**: Cyan
- **J**: Blue
- **L**: Amber
- **O**: Yellow
- **S**: Green
- **T**: Purple
- **Z**: Rose

### 2.3 Piece Generation
- **7-Bag System**: To ensure fair distribution, the game uses a "bag" system. A random permutation of all seven unique tetrominoes is generated; the game draws from this bag until empty, then generates a new one.
- **Next Piece Preview**: The game tracks and displays the next piece to appear in the side panel.

### 2.4 Movement and Rotation
- **Lateral Movement**: Pieces can move left or right unless blocked by the arena boundaries or other occupied cells.
- **Rotation**: Pieces can rotate $90^\circ$. If a rotation would cause a collision, the rotation is cancelled.
- **Soft Drop**: Accelerates the downward movement (via `ArrowDown` or touch-hold/drag-down). Awards +1 point per cell.
- **Hard Drop**: Instantly snaps the piece to the lowest possible valid position and locks it. Awards +2 points per cell fallen.

### 2.5 Line Clearing and Scoring
- **Line Clear**: A horizontal line is cleared when all 12 cells in that row are occupied.
- **Clear Naming**: Clears are announced by name — SINGLE, DOUBLE, TRIPLE, TETRIS (4 lines).
- **Base Score**: $\text{lines cleared}^2 \times 10 \times \text{level}$ (e.g. a 4-line clear at level 3 = 480 pts).
- **Back-to-back Tetris**: A Tetris cleared immediately after another Tetris (no non-Tetris clear in between) earns a $\times 1.5$ multiplier and is tagged "B2B". Any non-Tetris clear breaks the chain.
- **Combo**: Each consecutive locking piece that clears at least one line increments the combo counter; the clear earns an additional $10 \times \text{combo}$ points and a "COMBO ×n" floater. A piece that locks without clearing resets the combo.
- **Game Over**: Occurs when a new piece is generated and immediately collides with occupied cells at the start position, or when a pressure row (§2.7) is pushed while the top row is occupied (headline "Field Overflow").

### 2.6 Speed Levels
- **Level**: Starts at 1 and advances by one for every 10 cumulative lines cleared, capped at level 12. Displayed as LEVEL in the side panel.
- **Gravity Table (ms per cell, by level)**: 1000, 850, 720, 610, 510, 420, 340, 270, 210, 160, 120, 90.
- Soft-drop and hard-drop behavior are unaffected by level.
- A level-up plays a rising two-note jingle and floats "LEVEL n" in the field.

### 2.7 Pressure Line
- **Timer**: Time accumulated without clearing a line, ticking only while the game is live (paused during line-clear animations, stopped after game over). At the threshold, a dull-gray garbage row with one random gap is pushed in at the bottom of the field; the whole field shifts up one row and the active piece rides up with it.
- **Threshold**: 22.5s at level 1, reduced by 1s per level, floor 12.5s.
- **Rewind**: Each cleared line rewinds the timer by 7.5s (never below 0); a 4-line clear rewinds 30s.
- **Warning**: During the final 5s the panel's PRESSURE bar turns red, a red glow pulses along the field's bottom edge, and soft ticks sound at 5s and 2.5s remaining.
- **Overflow**: If the top row is occupied when the push happens, the run ends with the "Field Overflow" headline.

## 3. User Interface (UI)

### 3.1 Visuals
- **Canvas Rendering**: The game uses a HTML5 Canvas with a dark gradient background.
- **Spritework**: Blocks are rendered with pre-baked bevels, neon glows, and glossy highlights for a 3D aesthetic. Garbage rows render as flat gray tiles (no glow) to read as foreign intrusions.
- **Ghost Piece**: A semi-transparent outline of the current piece is projected onto the arena to show where the piece will land.
- **Side Panel**: Displays the "Next" piece preview, total lines cleared, current level, best score, the active combo multiplier (when combo > 1), and a PRESSURE bar showing progress toward the next garbage row.
- **Score Display**: A prominent real-time score counter.

### 3.2 Controls
| Action | Keyboard | Touch |
| :--- | :--- | :--- |
| Move Left | `ArrowLeft` | Drag Left |
| Move Right | `ArrowRight` | Drag Right |
| Soft Drop | `ArrowDown` | Drag Down / Hold Still |
| Rotate | `ArrowUp` | Tap |
| Hard Drop | `Space` | N/A |

### 3.3 Game Over State
- **Modal**: Upon game over, a modal appears showing the final score, the level reached, and total lines cleared. Overflow deaths are headlined "Field Overflow".
- **Leaderboard**: Displays the top 5 all-time high scores stored in `localStorage`.
- **Score Submission**: Players can enter up to 3 initials to save their score to the leaderboard.

## 4. "Juice" and Polish (UX)

### 4.1 Animations
- **Slam/Squash**: When a piece locks, it undergoes a brief "squash" animation.
- **Line Clear Flash**: A white flash occurs across the cleared rows.
- **Collapse**: Rows above the cleared lines ease downward smoothly.
- **Garbage Row Rise**: The whole field eases upward one cell (~200ms) when a pressure row lands.
- **Pressure Glow**: Pulsing red gradient at the field's bottom edge during the 5s warning window.
- **Screen Shake**: High-impact events (hard drops, line clears, garbage landings) trigger a random offset shake of the canvas.
- **Particles**: "Shards" spawn during line clears and "dust" spawns during hard drops.
- **Floating Text**: Clear announcements (e.g. "TETRIS +1600", gold for Tetris), "COMBO ×n" (cyan), and "LEVEL n" (pale gold) float upward.
- **Piece Pop**: Next-piece previews animate into the panel with a scale-up effect.

### 4.2 Audio
- **Sound Effects**: Synthesized via Web Audio API:
    - **Soft Lock**: Low-frequency sine wave.
    - **Hard Drop**: Thump sound (sine).
    - **Line Clear**: A multi-note arpeggio (square wave); a Tetris appends an extra high sparkle note.
    - **Back-to-back / Combo**: Communicated via the announce floaters over the Tetris jingle.
    - **Level Up**: Rising two-note square-wave jingle.
    - **Pressure Warning**: Soft triangle-wave ticks at 5s and 2.5s remaining.
    - **Background Music**: A quiet 16-step A-minor ostinato (sawtooth bass, square arpeggio, click hats) synthesized on its own gain node. It starts on the player's first input (AudioContext unlock), accelerates with the speed level and as the pressure row nears, and its arpeggio twists into a dissonant E/E♭ dread-tremolo during the 5s warning window.
    - **Garbage Landing**: Low sawtooth thud.
    - **Game Over**: Descending sawtooth wave.

## 5. Technical Constraints
- **Performance**: Block sprites are pre-rendered to avoid expensive `shadowBlur` calculations during the main render loop.
- **Accessibility**: 
    - Supports `prefers-reduced-motion` to disable shakes, particles, the field-rise animation, and glow pulsing (the pressure state stays readable via the panel bar).
    - Uses `aria-modal` and `aria-live` attributes for the game-over interface.
- **Persistence**: High scores are stored using the `tetris_highscores` key in the browser's `localStorage`.
