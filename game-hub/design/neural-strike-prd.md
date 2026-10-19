# Product Requirements Document (PRD): NEURAL STRIKE

## 1. Project Overview
**NEURAL STRIKE** is a high-energy, cyberpunk-themed rhythm game where the player acts as a "Net-Runner" infiltrating a corporate mainframe. The core gameplay involves synchronizing inputs with a music-driven data stream to "breach" security layers.

### 1.1 Goal
To create a visually stunning, responsive rhythm experience that blends classic "note-highway" mechanics with a "hacking" narrative and a high-fidelity cyberpunk aesthetic.

### 1.2 Target Audience
- Rhythm game enthusiasts.
- Fans of the Cyberpunk aesthetic (Synthwave, Industrial).
- Casual players looking for a high-polish, short-session experience.

---

## 2. Gameplay Mechanics

### 2.1 The Core Loop
The player monitors a "Data Stream" (a 3D-perspective highway). Notes travel toward a "Hit Zone." The player must trigger the corresponding input at the exact moment the note overlaps the Hit Zone.

### 2.2 Note Types
| Note Type | Input Action | Visual Description | Description |
| :--- | :--- | :--- | :--- |
| **Synapse Tap** | Single Press | A sharp, neon-colored block | A standard beat synchronization. |
| **Data Link** | Press & Hold | A long, glowing trail | Requires holding the input for the duration of the note. |
| **System Breach** | Swipe/Shift | A sliding arrow across lanes | Requires a fluid movement across multiple lanes. |
| **Overload** | Simultaneous Press | A large, flashing barrier | Requires hitting all active lanes at once to clear a gate. |

### 2.3 Scoring & Timing
Accuracy is measured by the offset between the player's input and the target timestamp:
- **PERFECT:** $\pm 15\text{ms}$ (Max points, increases combo)
- **GREAT:** $\pm 40\text{ms}$ (High points, maintains combo)
- **GOOD:** $\pm 80\text{ms}$ (Low points, maintains combo)
- **MISS:** $> 80\text{ms}$ (No points, resets combo, triggers "glitch" effect)

---

## 3. Visuals & Audio

### 3.1 Cyberpunk Aesthetic
- **Colors:** Obsidian black background with Electric Purple, Acid Green, and Cyan accents.
- **Effects:** 
    - **Chromatic Aberration:** Triggered during high combo streaks.
    - **Screen Glitch:** Triggered on "MISS" or "Overload" failure.
    - **BPM-Sync:** Background elements (circuitry, neon grids) pulse in time with the music.

### 3.2 Audio Requirements
- **Genre:** High-BPM Synthwave, Industrial Techno, or Phonk.
- **Sfx:** Metallic clicks for hits, digital distortion for misses, and a "system unlock" sound upon level completion.

---

## 4. Technical Requirements

### 4.1 Architecture
- **Clock System:** Must use `Web Audio API` (`audioContext.currentTime`) as the single source of truth for timing to avoid drift associated with `requestAnimationFrame`.
- **Beatmap Format:** JSON-based definition.
    ```json
    {
      "song": "CyberCity_Night.mp3",
      "bpm": 128,
      "notes": [
        { "time": 1.25, "type": "tap", "lane": 1 },
        { "time": 2.10, "type": "hold", "lane": 2, "duration": 0.5 }
      ]
    }
    ```

### 4.2 Tech Stack (Proposed)
- **Frontend:** React or Vue.js for UI.
- **Rendering:** Three.js (for 3D perspective) or HTML5 Canvas (for 2D performance).
- **Audio:** Web Audio API.

---

## 5. Roadmap

### Phase 1: Prototype (The Heartbeat)
- Basic audio-to-clock synchronization.
- JSON beatmap parser.
- Simple 2D lanes with "Tap" notes.

### Phase 2: Visual Interface (The Neural Link)
- Implementation of 3D perspective "Data Stream."
- Addition of "Hold" and "Slide" notes.
- Core UI (Combo counter, Health/Sync bar).

### Phase 3: Polish & Effects (The Cyber-Vibe)
- Integration of glitch effects and chromatic aberration.
- Background reactivity based on BPM.
- "Overload" barrier mechanics.

### Phase 4: Content & Balance
- Level design for 3-5 curated tracks.
- Difficulty scaling (Easy, Hacker, Elite).
- Final performance optimization.
