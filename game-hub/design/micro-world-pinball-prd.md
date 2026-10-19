# PRD: Micro-World 3D Pinball

## 1. Project Overview
**Micro-World 3D Pinball** is a physics-driven 3D arcade game where the traditional pinball table is replaced by a cluttered, "micro-world" environment (a home-office desk). Players launch a marble-like ball through a series of makeshift obstacles constructed from everyday stationery and household objects.

## 2. Game Mechanics

### 2.1 Core Gameplay
- **The Table:** A tilted surface simulating a desk. The "walls" are comprised of books, boxes, and other stationery.
- **The Ball:** A high-density marble with realistic elastic collisions.
- **The Flippers:** Two makeshift "flippers" (e.g., plastic rulers or stiff cardboard) controlled by the player to prevent the ball from falling into the "drain."
- **The Launcher:** A spring-loaded mechanism (e.g., a pen spring) to propel the ball into play.

### 2.2 Obstacles & Interactivity
- **Bumpers (The Elastics):** Small, bouncy objects (erasers, rubber bands) that apply a high-impulse force to the ball upon collision.
- **Sling-shots (The Magnets):** High-energy zones that kick the ball sharply in a specific direction.
- **Ramps (The Stationery):** Folded cardboard or plastic rulers that guide the ball to upper levels or different sections of the table.
- **Targets (The Junk):** Specific objects (e.g., a thimble, a coffee mug) that provide score bonuses or trigger environmental events when entered.

### 2.3 Environmental Hazards
- **The Sneeze:** A random gust of wind that applies a short-term force vector to the ball.
- **The Spill:** Occasional "ink spills" that create high-friction zones, slowing the ball down.
- **External Interference:** Rare events (e.g., a cat's paw) that physically shift an obstacle.

## 3. Technical Requirements

### 3.1 3D Engine & Physics
- **Engine:** Web-based 3D (Three.js or similar).
- **Physics:** A robust physics engine (Rapier or Cannon.js) to handle high-velocity collisions and avoid "tunneling" through thin walls.
- **Gravity:** Constant downward force along the Y-axis, adjusted by the tilt of the table.

### 3.2 Visuals & Aesthetics
- **Macro-Perspective:** Implementation of a shallow depth of field (bokeh effect) to emphasize the "tiny" scale.
- **Materials:** High-fidelity textures for wood, rubber, plastic, and metal.
- **Lighting:** Soft, desk-lamp style lighting with realistic shadows.

### 3.3 Audio Design (ASMR Focus)
- **Collision Sounds:** Material-specific sounds (Marble-on-Wood, Marble-on-Rubber, Marble-on-Metal).
- **Atmospheric Sound:** Low-level background noise of a quiet room (clock ticking, distant traffic).

## 4. User Interface (UI)
- **Score Display:** A handwritten-style scoreboard on a sticky note attached to the desk.
- **Ball Count:** Represented by actual marbles sitting in a tray.
- **Game Over:** A "Clean up your desk!" message appearing on a small scrap of paper.

## 5. Success Criteria
- **Feel:** The ball movement must feel heavy and satisfying; collisions must be snappy.
- **Performance:** Stable 60fps on modern browsers.
- **Engagement:** A variety of table layouts or a procedurally generated "clutter" system to ensure replayability.
