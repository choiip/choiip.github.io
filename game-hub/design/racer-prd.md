# Product Requirements Document (PRD): Neon Glide (Racer)

## 1. Product Overview
Neon Glide is a high-speed, 3D-perspective lane-dodging racer. The player controls a futuristic car speeding down an infinite neon road, dodging obstacles to maximize distance and score.

## 2. Game Mechanics

### 2.1 World and Perspective
- **Pseudo-3D Projection**: Uses a vanishing-point projection system to simulate 3D depth on a 2D canvas.
- **Environment**: A stylized neon world featuring a dark sky, a synth-wave sun, and a scrolling cityscape skyline.
- **Road System**: A three-lane road with scrolling bands and neon edge markers.

### 2.2 Vehicle Control
- **Lanes**: The car can occupy one of three lanes (Left, Center, Right).
- **Lane Changing**: Switching lanes is handled via a smooth interpolation (tween) to create a natural lateral shift.
- **Banking**: The car tilts slightly (banks) into the direction of the lane change.

### 2.3 Obstacles and Difficulty
- **Obstacle Types**:
    - **Barriers**: Single-lane blocks.
    - **Blockers**: Wide obstacles covering multiple lanes.
    - **Pillars**: Multiple narrow blocks leaving only one lane open.
    - **Slaloms/Staggers**: Series of staggered blocks requiring precise weaving.
- **Tiered Spawning**: Obstacle complexity increases as the player covers more distance (Tiered Pool).
- **Dynamic Speed**: The base speed ramps up as the distance increases.

### 2.4 Combat and Health
- **Shields**: The player starts with 3 shields.
- **Collision**:
    - **Hit**: Colliding with an obstacle consumes one shield and triggers a brief period of invulnerability.
    - **Penalty**: A hit causes a temporary speed penalty.
- **Game Over**: Occurs when shields are depleted. The game enters a "crashing" state with slow-motion physics before fully stopping.

### 2.5 Scoring
- **Distance**: Primary score driver based on meters traveled.
- **Near Misses**: Dodging obstacles closely at high speeds grants bonus points (+5).
- **Passed Obstacles**: Passing through a gap successfully adds to the score.

## 3. User Interface (UI)

### 3.1 Visuals
- **The Car**: A detailed futuristic vehicle with a body, cabin, taillights, and a neon underglow.
- **Environment**: 
    - **Sky**: Gradient background with stars and a stylized "scanline" sun.
    - **Road**: Scrolling neon bands and la-dashes.
    - **Props**: Neon pylons and landmark arches that pass by at scale.
- **HUD**:
    - **Real-time Stats**: Displays current score, speed (km/h), and distance (m).
    - **Shield Indicator**: Visual representation of remaining shields (cyan chevrons).
    - **Best Score**: Displays the all-time high score.

### 3.2 Controls
| Action | Keyboard | Touch |
| :--- | :--- | :--- |
| Move Left | `ArrowLeft` / `A` | Swipe Left |
| Move Right | `ArrowRight` / `D` | Swipe Right |

### 3.3 Game Flow
- **Countdown**: A 3-second "GET READY" countdown precedes the start of the race.
- **Game Over**: A blur effect and a high-score submission modal.

## 4. "Juice" and Polish (UX)

### 4.1 Animations and Effects
- **Warp Streaks**: Radial lines emerge from the vanishing point when the car reaches high speeds.
- **Screen Shake**: Triggered during collisions.
- **Particles**: 
    - **Shards**: Spawn upon hitting obstacles.
    - **Sparks**: Spawn during "near miss" events.
- **Bobs and Sways**: The car has a subtle vertical bob and a "crash" bounce during the game-over sequence.
- **Holographic UI**: HUD elements feature strong outlines and neon colors.

### 4.2 Audio
- **Engine**: A continuous sawtooth wave through a low-pass filter; pitch and filter cutoff scale with current speed.
- **Sfx**: 
    - **Lane Change**: A quick triangle wave blip.
    - **Collision**: A low-frequency sawtooth thud.
    - **Near Miss**: A high-frequency triangle chime.

## 5. Technical Constraints
- **Physics Engine**: Uses a fixed-timestep (60Hz) loop decoupled from the render loop to ensure consistent gameplay regardless of frame rate.
- **Optimization**: 
    - Pre-rendered offscreen canvases for the sky, sun, and skyline.
    - Z-sorting for obstacle rendering to ensure correct layering.
- **Persistence**: High scores saved to `localStorage` under `racer_highscores`.
