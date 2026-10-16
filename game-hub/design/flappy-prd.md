# Product Requirements Document (PRD): Flappy Bird

## 1. Product Overview
Flappy Bird is a side-scrolling arcade game where the player controls a bird flying through a series of gaps between vertical pipes. The objective is to fly as far as possible without colliding with the pipes or the ground.

## 2. Game Mechanics

### 2.1 Physics and Movement
- **Gravity**: The bird is constantly pulled downward by a gravity constant.
- **Flapping**: When the player triggers a "flap", the bird is given a sudden upward velocity.
- **Terminal Velocity**: There is a maximum falling speed to prevent the bird from accelerating infinitely.
- **Ceiling Clamp**: The bird is prevented from flying above the top of the screen.

### 2.2 Obstacles (Pipes)
- **Generation**: Pipes are spawned at regular intervals with a randomized gap position.
- **Pipe Structure**: Each obstacle consists of a top pipe and a bottom pipe with a fixed gap between them.
- **Collision**: Colliding with any part of a pipe or the ground results in an immediate game over.
- **Scoring**: The player earns 1 point for every pair of pipes successfully passed.

### 2.3 Difficulty Scaling
- **Dynamic Speed**: The scrolling speed of the world increases gradually as the player's score increases, making the game more challenging.

## 3. User Interface (UI)

### 3.1 Visuals
- **Setting**: A nighttime scene with a dark blue gradient sky, stars, and drifting semi-transparent clouds.
- **The Bird**: A yellow bird with a wing that flaps based on the current game state.
- **Pipes**: Green neon-style pipes with distinct caps at the ends of the gaps.
- **The Ground**: A dark blue surface with a green top border and scrolling "ticks" to simulate motion.
- **HUD**: A simple score counter displayed above the canvas.

### 3.2 Controls
| Action | Keyboard | Touch/Pointer |
| :--- | :--- | :--- |
| Flap | `Space` / `ArrowUp` | Tap / Press |

### 3.3 Game Flow
- **Ready State**: The bird bobs gently in the air with a "Press Space or tap to flap" hint displayed.
- **Playing State**: The game starts as soon as the first flap is triggered.
- **Game Over State**: The game stops, and a modal appears with the final score and a high-score leaderboard.

## 4. "Juice" and Polish (UX)

### 4.1 Animations
- **Bobs and Flaps**: 
    - The bird's body rotates based on its current vertical velocity (tilting up when flapping, diving when falling).
    - The wings flap at different frequencies depending on whether the bird is idle or flying.
- **Parallax Scrolling**: Clouds move at a slower speed than the pipes and ground to create a sense of depth.
- **Blinking**: The bird's eyes animate (blink) during the game.

### 4.2 Audio
- **Sound Effects**: Synthesized via Web Audio API:
    - **Flap**: A short, high-frequency sine wave.
    - **Point**: A higher-pitched sine wave upon passing a pipe.
    - **Game Over**: A low-frequency sawtooth wave.

## 5. Technical Constraints
- **Collision Detection**: Uses circle-to-rectangle collision logic to accurately determine if the bird's radius overlaps with the pipe boundaries.
- **Performance**: Scenery (stars, clouds) is generated once and recycled to minimize memory allocation during the main loop.
- **Persistence**: High scores are saved to `localStorage` under the key `flappy_highscores`.
