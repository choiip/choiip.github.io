# Product Requirements Document (PRD): Breakout

## 1. Product Overview
Breakout is a classic arcade game where the player controls a paddle to bounce a ball against a wall of bricks. The objective is to destroy all the bricks to win the game, while preventing the ball from falling past the paddle.

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

### 2.3 Win/Loss Conditions
- **Win**: All bricks in the grid are destroyed.
- **Loss**: The ball falls below the bottom edge of the canvas.

## 3. User Interface (UI)

### 3.1 Visuals
- **Theme**: "Warm Neon" aesthetic with a color palette of Rose, Amber, and Orange.
- **Bricks**: 
    - Each row has a distinct color.
    - Bricks feature a 3D raised effect with a light top highlight and a dark bottom edge.
- **Paddle**: A neon-glow gradient bar.
- **Ball**: A glowing sphere with a radial gradient.
- **HUD**: A simple score counter displayed above the canvas.

### 3.2 Controls
| Action | Keyboard | Touch |
| :--- | :--- | :--- |
| Move Left | `ArrowLeft` | Drag Left |
| Move Right | `ArrowRight` | Drag Right |

### 3.3 Game Over state
- **Modal**: Displays "You Win!" or "Game Over" along with the final score.
- **Persistence**: High scores are saved to `localStorage` under the key `breakout_highscores`.
- **Score Submission**: Allows players to enter up to 3 initials to record their score.

## 4. "Juice" and Polish (UX)

### 4.1 Animations
- **Comet Trail**: A fading trail of particles follows the ball during movement.
- **Smashed Bricks**: Bricks explode into colored "shards" upon destruction.
- **Flash**: A white radial flash appears at the point of impact when a brick is broken.
- **Squeezing/Squash**: The ball undergoes a brief "squash and stretch" animation upon colliding with walls or the paddle.
- **Screen Shake**: Triggered when bricks are destroyed.
- **Confetti**: Spawns across the screen upon winning the game.

### 4.2 Audio
- **Sound Effects**: Synthesized via Web Audio API:
    - **Brick Hit**: A sine wave with a frequency that increases based on the brick's row (higher rows sound higher).
    - **Paddle Hit**: A mid-range sine wave.
    - **Game Over**: A low-frequency sawtooth wave.

## 5. Technical Constraints
- **Physics Step**: Uses a fixed physics timestep (60Hz) to ensure consistent ball behavior across different refresh rates.
- **Collision Detection**: Implements a "least penetration" check for brick collisions to determine the correct reflection axis.
- **Accessibility**: 
    - Supports `prefers-reduced-motion` to disable trails, shards, and screen shake.
