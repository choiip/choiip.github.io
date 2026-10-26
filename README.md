# 🎮 Game Hub

[![Play Now](https://img.shields.io/badge/Play-Now-green?style=for-the-badge)](https://choiip.github.io/game-hub)

A minimalist, vanilla JavaScript arcade hub featuring a collection of self-contained browser games. Built with a "no-framework" philosophy, utilizing plain ES modules, HTML5 Canvas, and the Web Audio API.

**🌐 Live Demo:** [choiip.github.io/game-hub](https://choiip.github.io/game-hub)


## 🚀 Featured Games

| Game | Icon | Description |
| :--- | :---: | :--- |
| **Snake** | 🐍 | Classic snake. Eat, grow, don’t crash. |
| **Tetris** | 🧱 | Rotate, stack, clear lines. |
| **Breakout** | 🎾 | Keep the ball alive, smash the wall. |
| **Flappy Bird** | 🐦 | Tap to flap. Dodge the pipes. Survive. |
| **Neon Glide** | 🏎️ | Dodge neon traffic down a 3D synthwave highway. |
| **Micro Pinball** | 🎱 | A marble gets lost on a cluttered desk. Plunger, flippers, big bonks. |
| **Neural Strike** | ⚡ | Sync to the data stream and breach the corporate mainframe. |
| **Gravity Faller** | 🌀 | Rotate gravity, land soft, break glass at speed. |


## 🛠️ Technical Architecture

The project is designed for extreme simplicity and performance:
- **Zero Dependencies**: No `npm`, no build steps, no frameworks.
- **Modular Design**: Each game is a self-contained ES module. Adding a new game does not affect existing ones.
- **Performance**: Uses fixed-timestep logic via `setInterval` for consistent physics and `requestAnimationFrame` for fluid rendering.
- **Audio**: Pure synthesized sound using the Web Audio API (no external audio files).
- **Controls**: Supports both keyboard input and mobile touch (swipe gestures).

## 🏃 How to Run

Because the project uses dynamic `import()` for game modules, it must be served over HTTP.

1. Clone the repository.
2. Navigate to the `game-hub` directory:
   ```sh
   cd game-hub
   ```
3. Start a local server (e.g., using Python):
   ```sh
   python3 -m http.server 8000
   ```
4. Open your browser to `http://localhost:8000`.

## 📂 Project Structure

- `index.html` - The main hub entry point and game shell.
- `js/hub.js` - The orchestration layer handling game loading, unloading, and high scores.
- `js/games/` - Individual game directories containing the game logic and assets.
- `style.css` - Global styles for the hub and all game interfaces.
- `design/` - Product Requirement Documents (PRDs) defining the mechanics for each game.

## 🏆 High Scores

High scores are persisted locally using `localStorage`. Each game maintains its own leaderboard of the top 5 scores, including player initials and dates.
