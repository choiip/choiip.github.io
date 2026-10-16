# Product Requirements Document (PRD): Tetris

## 1. Product Overview
Tetris is a classic tile-matching puzzle game where players must manipulate falling geometric shapes (tetrominoes) to create complete horizontal lines. The objective is to maximize the score by clearing lines and avoiding the accumulation of blocks to the top of the playing field.

## 2. Game Mechanics

### 2.1 Playing Field
- **Grid Dimensions**: 12 columns $\times$ 20 rows.
- **Gravity**: Pieces drop by one cell every 1,000ms (base speed).
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
- **Soft Drop**: Accelerates the downward movement (via `ArrowDown` or touch-hold).
- **Hard Drop**: Instantly snaps the piece to the lowest possible valid position and locks it.

### 2.5 Line Clearing and Scoring
- **Line Clear**: A horizontal line is cleared when all 12 cells in that row are occupied.
- **Scoring**: Points are awarded based on the number of lines cleared simultaneously:
    - Formula: $\text{lines cleared}^2 \times 10$ (e.g., 1 line = 10pts, 4 lines = 160pts).
- **Game Over**: Occurs when a new piece is generated and immediately collides with occupied cells at the start position.

## 3. User Interface (UI)

### 3.1 Visuals
- **Canvas Rendering**: The game uses a HTML5 Canvas with a dark gradient background.
- **Spritework**: Blocks are rendered with pre-baked bevels, neon glows, and glossy highlights for a 3D aesthetic.
- **Ghost Piece**: A semi-transparent outline of the current piece is projected onto the arena to show where the piece will land.
- **Side Panel**: Displays the "Next" piece preview, total lines cleared, and the best score (high score).
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
- **Modal**: Upon game over, a modal appears showing the final score.
- **Leaderboard**: Displays the top 5 all-time high scores stored in `localStorage`.
- **Score Submission**: Players can enter up to 3 initials to save their score to the leaderboard.

## 4. "Juice" and Polish (UX)

### 4.1 Animations
- **Slam/Squash**: When a piece locks, it undergoes a brief "squash" animation.
- **Line Clear Flash**: A white flash occurs across the cleared rows.
- **Collapse**: Rows above the cleared lines ease downward smoothly.
- **Screen Shake**: High-impact events (hard drops, line clears) trigger a random offset shake of the canvas.
- **Particles**: "Shards" spawn during line clears and "dust" spawns during hard drops.
- **Floating Text**: Score increments (e.g., "+160") float upward from the cleared area.
- **Piece Pop**: Next-piece previews animate into the panel with a scale-up effect.

### 4.2 Audio
- **Sound Effects**: Synthesized via Web Audio API:
    - **Soft Lock**: Low-frequency sine wave.
    - **Hard Drop**: Thump sound (sine).
    - **Line Clear**: A multi-note arpeggio (square wave).
    - **Game Over**: Descending sawtooth wave.

## 5. Technical Constraints
- **Performance**: Block sprites are pre-rendered to avoid expensive `shadowBlur` calculations during the main render loop.
- **Accessibility**: 
    - Supports `prefers-reduced-motion` to disable shakes and complex animations.
    - Uses `aria-modal` and `aria-live` attributes for the game-over interface.
- **Persistence**: High scores are stored using the `tetris_highscores` key in the browser's `localStorage`.
