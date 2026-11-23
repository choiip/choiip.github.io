# PRD: Blocade

## 1. Executive Summary
A faithful digital adaptation of **Blockade / Cul-de-sac** (Philip Slater, Lakeside, 1975) —
a two-player wall-racing board game. Each player races two pawns from their home squares to
the rival's home squares while spending a limited supply of walls to box the rival in. Before
every game the player chooses an opponent: **three AI levels** (Rookie / Tactician /
Grandmaster) or a **human friend** (pass & play).

## 2. Board & Setup
* **Board:** 11 columns × 14 rows of square cells.
* **Pawns:** 2 per player. Red (player 1, top) starts on its homes at (col 4, row 4) and
  (col 8, row 4); Cyan (player 2, bottom) on (col 4, row 11) and (col 8, row 11) — 1-indexed.
* **Walls:** 9 green (vertical) + 9 blue (horizontal) per player. A wall is a 2-cell spanner
  that sits on grid lines. Wall *color indicates orientation only* (like the original) —
  walls belong to whoever placed them but are drawn identically.
* Red always moves first (no swap rule).

## 3. Turn Structure
A turn is exactly two phases, in order:
1. **Move** one of your pawns (you must move; you may not skip).
2. **Place one wall** — mandatory while you have walls left *and* at least one legal
   placement exists. If no legal wall placement exists, the placement is skipped with a toast.
   When a player is out of walls, their turns are move-only from then on.

## 4. Pawn Movement
* A pawn moves **1 or 2 spaces** along orthogonal steps. The two steps may change direction
  (an L-shaped path). Every passage crossed must be wall-free.
* A pawn may **not** end on a space occupied by another pawn, and may not pass through one —
  **except**:
  * **Jump:** if the first step lands directly onto an adjacent pawn and the space straight
    beyond it is free (no wall between), the pawn may hop over and land there. This uses the
    full 2-space move.
  * **Home capture:** a pawn may land directly on an enemy pawn that occupies one of *your*
    target home squares. The enemy pawn is **removed from the game** ("you may not protect a
    home space by leaving a pawn on it" — original rulebook).
* The connectivity invariant (§6) guarantees every living pawn always has ≥ 1 legal move.

## 5. Wall Placement & Validity
A wall is placed at a grid intersection `(x, y)` (x ∈ 1..10, y ∈ 1..13; walls never hang off
the board). A **vertical (green)** wall at (x, y) stands on the column boundary x and blocks
left–right passage through cells (x−1, y−1)/(x, y−1) and (x−1, y)/(x, y). A **horizontal
(blue)** wall lies on the row boundary y and blocks up–down passage through the two cell
pairs above/below. A placement is legal iff:
1. **Supply:** you have a wall of that orientation left.
2. **No overlap:** neither blocked cell-pair already has a wall over it.
3. **No crossing / no T-junctions:** no perpendicular wall at the same intersection (walls
   never cross) or at the four neighboring intersections in the perpendicular axis (a wall
   end never meets the middle of another wall — "cannot be put in the middle of three").
   Collinear end-to-end joins are allowed.
4. **Connectivity (§6).**

## 6. The Connectivity Invariant ("never seal")
After every placement, **every living pawn of both players must still have a wall-respecting
path to all four home squares**. Illegal placements are rejected with a red ghost, a buzz,
and an explanatory toast. This kills suicide-walls and stalemates alike.

## 7. Victory
* A player wins immediately at the end of their move when **both of the rival's home squares
  are occupied by their own two pawns**.
* A player with zero living pawns instantly loses (possible only after home captures).

## 8. Opponents
Chosen on a start overlay; persisted for "Play Again".
| Opponent | Move policy | Wall policy |
| --- | --- | --- |
| **Rookie (easy)** | 50% random legal move, 50% shortest-path greedy | Random legal wall |
| **Tactician (medium)** | Shortest-path greedy (min Σ BFS distance of its pawns to target homes) | Greedy: maximizes rival's distance increase − 0.4 × own distance loss; 25% chance plays 2nd/3rd best |
| **Grandmaster (hard)** | 2-ply search: own move + best wall vs rival's top replies + their best greedy wall; small score noise for variety | Same greedy wall model used at both plies |
| **2 Players** | Pass & play — both sides human | |

BFS distance = wall-aware, pawn-blocked shortest path to the nearest target home.
The search prunes to the top ~10 root moves × 6 rival replies with capped wall candidates.
AI turns run on `setTimeout` (~0.4–0.6 s "thinking") with move/wall animations.

## 9. UI / UX
* **Layout (top→bottom):** turn badge (pulsing color dot + name/thinking), aria-live phase
  text, wall counters for both players, wall-orientation chips (human wall phase only),
  canvas board (406 × 508), toast line.
* **Board:** dark theme tokens; checker-tinted cells; home squares ringed in the owner's
  color; walls green `#4ade80` (vertical) / blue `#38bdf8` (horizontal); pawns
  `#f87171` / `#22d3ee`.
* **Controls (pointer):** move phase — tap a highlighted pawn, then a highlighted destination
  (dots; home-capture targets get a red ring). Wall phase — pick orientation chip, hover for
  a ghost wall (red when illegal), tap a grid corner to place. Touch: taps place directly.
* **Opponent select:** modal (`role="dialog"`) with four full-width buttons
  (Rookie/Tactician/Grandmaster/2 Players) + "How to play".
* **Game-over modal:** winner headline + one-line cause, then **Play Again** (same opponent),
  **Change Opponent**, **Home** (`hub:home` event). No initials form — no leaderboard (§11).
* **How to play:** modal carousel, 5 steps, each with a looping mini-canvas animation
  (cancel rAF on step change/close/destroy; static annotated frame under
  `prefers-reduced-motion`):
  1. **The race** — two pawns glide from home squares into the rival's, homes glow.
  2. **Movement** — three panels: one step / two steps / L-shaped path.
  3. **The jump** — a legal hop over an enemy, then a ✗ landing on an occupied space.
  4. **Walls** — a green wall lands ✓; crossing ✗; T-junction ✗; legal blue wall ✓.
  5. **Never seal** — a dashed path vanishes when a wall drops in the only doorway (✗, wall
     bounces out), then a legal wall beside it (✓).
  Entry points: the opponent-select screen and a persistent ❓ Rules button in the HUD.

## 10. Visual & Audio Direction
* Canvas-drawn everything; no image assets. Oscillator SFX only: pawn tap, slide, capture
  thud, wall thunk, invalid buzz, win/lose jingles.
* Animations: pawn slide (200 ms ease-out), wall pop (160 ms), capture ring, pulsing
  movable-pawn rings. All pulse/pop effects disabled under `prefers-reduced-motion: reduce`
  (slides shorten to 90 ms).

## 11. High-Score Behavior
**By design there is no leaderboard**: Blocade is a versus game, so the hub card carries no
trophy button and the end modal shows no initials form (zero-score rule is moot).

## 12. Out of Scope (original variant rules deliberately dropped)
Bombs, 3–4 player games, alternate-first rule, per-player wall artwork.
