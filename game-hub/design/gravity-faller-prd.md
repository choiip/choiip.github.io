# PRD: Gravity Faller (Working Title)

## 1. Executive Summary
A high-speed, endless descent game where the player manipulates gravity to navigate a procedurally generated vertical labyrinth. Instead of traditional platforming, the challenge lies in rotating the direction of "down" to avoid hazards and reach the bottom of an infinite shaft.

## 2. Core Gameplay Mechanics

### 2.1 The Descent
*   **Infinite Fall:** The player is constantly moving "down" (relative to the current gravity vector).
*   **Gravity Shifting:** The core mechanic. The player can rotate gravity in 90-degree increments (Up, Down, Left, Right).
*   **Momentum:** Changing gravity doesn't instantly change velocity; the player arcs toward the new "down," requiring predictive movement.

### 2.2 Controls
*   **Left/Right Input:** Aim gravity left / right (shortest 90° rotation, eased on the compass). `Down` returns to falling down.
*   **Action/Burst:** A short-range "push" in the opposite direction of current gravity to make micro-adjustments. Consumes one energy cell.
*   **Mobile:** Swipe left/right to aim gravity, swipe down to fall down, tap or swipe up to burst.

### 2.3 Hazards & Obstacles
*   **Static Walls:** Solid blocks that kill the player on hard impact. Landing softly (below crash speed) is safe and lets the player slide. **Any face that gravity pushes the player into acts as a floor** — it can be stood on or slid along.
*   **Shatter-Glass:** Platforms that only break when hit at high speed (≥ 85% of max speed). Soft contact bounces off. Breaking glass awards +25 bonus.
*   **Energy Fields:** Zones that disable gravity shifting while the player is inside. The lock releases when the player exits the zone **or after ~4 seconds (lock decay)** — the decay guarantees a resting player can never be trapped forever. A HUD bar shows remaining lock time.
*   **Void Gaps:** Rifts across the shaft with a safe "bridge" strip in the middle; crossing outside the bridge is instant death (a shield can absorb it and drop the player back onto the bridge).

### 2.4 Resources & Power-ups
*   **Energy Cells:** Collected to fuel gravity shifts (if using a limited-energy system) or to trigger the "Burst" move.
*   **Slowing Orbs:** Temporarily slows down time to allow for precise gravity rotations.
*   **Shields:** Provides a single hit of protection against walls.

## 3. Game Loop & Progression

### 3.1 Primary Loop
`Fall` $\rightarrow$ `Analyze Obstacles` $\rightarrow$ `Shift Gravity` $\rightarrow$ `Avoid Collision` $\rightarrow$ `Collect Resource` $\rightarrow$ `Repeat`.

### 3.2 Difficulty Scaling
As the player descends further:
*   **Increased Velocity:** The base falling speed increases.
*   **Tighter Corridors:** Gaps between walls become narrower.
*   **Dynamic Obstacles:** Walls begin to move, rotate, or disappear/reappear.
*   **Shorter Reaction Windows:** The distance between "safe zones" decreases.

## 4. Technical Requirements

### 4.1 Engine/Stack
*   **Rendering:** HTML5 Canvas or a 2D Game Engine (e.g., Phaser, PixiJS).
*   **Physics:** Custom AABB collision detection or a simplified physics engine (e.g., Matter.js) configured for varying gravity vectors.
*   **Generation:** A seed-based procedural generator that creates "chunks" of the level to ensure endless play.

### 4.2 Key Systems
*   **Gravity Manager:** A global state handler that updates the physics acceleration vector based on player input.
*   **Chunk Manager:** Handles the instantiation and cleanup of level segments as the player moves.
*   **Collision Resolver:** Handles the interaction between the player's bounding box and the geometry of the world.

## 5. Visual & Audio Direction
*   **Visuals:** Neon-minimalist or "Cyber-Void" aesthetic. High contrast between the player, the background, and the lethal walls.
*   **Audio:** A dynamic synth-wave soundtrack that increases in tempo as the fall velocity increases. Satisfying "thud" sounds for near-misses and "shatter" sounds for breaking through glass.
