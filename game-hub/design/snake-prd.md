# Product Requirements Document (PRD): Snake

## 1. Product Overview
Snake is a classic arcade game where the player controls a growing snake that moves across a grid. The goal is to consume food to increase the snake's length and score while avoiding collisions with the game boundaries or the snake's own body.

## 2. Game Mechanics

### 2.1 Playing Field
- **Grid Dimensions**: 20 $\times$ 20 tiles (total 400 $\times$ 400 px).
- **Grid System**: The game operates on a discrete tile-based movement system.

### 2.2 Movement
- **Constant Motion**: Once the game starts, the snake moves in a straight line at a fixed speed (one tile every 150ms).
- **Directional Control**: The snake can change direction (Up, Down, Left, Right).
- **Collision Constraints**:
    - **Self-Collision**: If the snake's head collides with any of its own body segments, the game ends.
    - **Boundary Collision**: If the snake's head exits the grid boundaries, the game ends.
- **Anti-Reversal**: The snake cannot perform a $180^\circ$ turn into itself.

### 2.3 Food and Growth
- **Spawning**: A single piece of food spawns at a random valid grid location.
- **Consumption**: When the snake's head occupies the same tile as the food:
    - The snake grows by one segment.
    - The score increases by 10 points.
    - A new piece of food is randomly generated in a non-occupied cell.

## 3. User Interface (UI)

### 3.1 Visuals
- **Background**: A dark theme with a subtle green checkerboard pattern to aid grid alignment.
- **Snake Appearance**:
    - **Head**: A rounded square with a distinct bright green color (`#4ade80`) and eyes that face the direction of travel.
    - **Body**: A tapered gradient from bright green at the head to deep green at the tail.
- **Food Appearance**: A red apple with a 3D radial gradient, a brown stem, a green leaf, and a glossy highlight.
- **HUD**: A simple score counter displayed above the canvas.

### 3.2 Controls
| Action | Keyboard | Touch |
| :--- | :--- | :--- |
| Change Direction | `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` | Swipe in the desired direction |

### 3.3 Game Over State
- **Modal**: Displays the final score and a leaderboard of the top 5 all-time high scores.
- **Persistence**: High scores are saved to `localStorage` under the key `snake_highscores`.
- **Score Submission**: Allows players to enter up to 3 initials to record their score.

## 4. "Juice" and Polish (UX)

### 4.1 Animations
- **Smooth Movement**: The game uses interpolation between grid ticks to ensure the snake glides smoothly at 60fps.
- **Dynamic Apple**: The food pulses slightly in size.
- **Eating Effect**:
    - **Pop**: The snake's head briefly expands when consuming food.
    - **Particles**: Multi-colored particles spawn at the food's location upon consumption.
- **Game Over**: The canvas applies a blur filter when the game ends.

### 4.2 Audio
- **Sound Effects**: Synthesized via Web Audio API:
    - **Consumption**: A short, high-frequency sine wave.
    - **Game Over**: A low-frequency sawtooth wave.

## 5. Technical Constraints
- **Performance**: Uses a fixed physics timestep (`TICK_MS`) decoupled from the rendering loop for consistent gameplay.
- **Accessibility**: 
    - Supports `prefers-reduced-motion` to disable pulsing and particle effects.
    - Game-over modal identifies as a dialog with `aria-modal="true"`.
