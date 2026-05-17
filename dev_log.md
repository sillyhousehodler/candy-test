# Candy Crush Clone — Game Design Document

## Overview

A browser-based match-3 puzzle game inspired by Candy Crush, built with **Phaser 3.60.0** on a fixed 600×640 px canvas. The player swaps adjacent gems on an 8×8 grid to form runs of 3 or more identical colors. Matching clears the gems, earns points, and triggers gravity + cascade chains. The game spans three levels of increasing difficulty; clearing all three shows a grand-victory screen.

---

## Board & Gems

| Property | Value |
|---|---|
| Grid size | 8 columns × 8 rows |
| Cell size | 64 × 64 px |
| Gem types | 5 distinct colors |
| Board origin | X = 44 px, Y = 80 px (leaves room for the HUD above) |

Each gem is a `Phaser.GameObjects.Graphics` circle rendered with a drop-shadow, a colored body, and a specular highlight for a glossy 3-D look. The five colors are red, blue, green, yellow, and purple.

### Board Generation

The board fills top-left to bottom-right, rejecting any placement that would immediately create a 3-in-a-row. After filling, a deadlock check simulates every possible adjacent swap; if none produces a match the board is regenerated (up to 100 attempts). This guarantees the starting board is always clean (no pre-existing matches) and always playable (at least one valid move exists).

---

## Match Rules

- A **match** is a horizontal or vertical run of **3 or more** identical gem colors.
- Matches are detected by a single-pass run-length scan across all rows then all columns. A `Set` deduplicates cells that belong to both a horizontal and a vertical run.
- Gems with board value `-1` (cleared / in flight) are never counted in a run.

---

## Scoring

```
points = matched_cells × 10 × cascade_depth
```

- `cascade_depth` starts at **1** for the player's direct swap.
- Each automatic chain after gravity increments depth by 1, so deeper cascades score exponentially more.
- A floating `+N` label animates upward from the centre of the cleared group immediately after each clear.

---

## Levels

| Level | Score Target | Move Budget |
|---|---|---|
| 1 | 1 000 | 20 |
| 2 | 1 200 | 20 |
| 3 | 1 500 | 25 |

Levels are defined in the `LEVELS` array and can be extended by adding entries without touching gameplay logic.

### Win / Lose Conditions

- **Level win**: score reaches the target.  
  - Levels 1–2 → level-complete interstitial → advance to next level.  
  - Level 3 → grand-victory screen.
- **Loss**: move budget reaches 0, **or** the board enters a deadlock (no valid swaps remain). Both lead to the Game Over screen and restart from Level 1.

---

## Cascades & Gravity

After every clear:

1. **Gravity** — each column compacts downward. Surviving gems fall into gaps with a 280 ms `Cubic.easeIn` tween. New random gems spawn above the visible board and fall in with a 320 ms tween, staggered by 40 ms per row so they appear to queue up from above.
2. **Cascade check** — once all falls settle, the board is scanned again. New matches trigger another `processMatches()` call with `depth + 1` after a 120 ms pause (breathing room for the player to see the settled state). This repeats until no matches remain.
3. **End check** — after the cascade chain resolves, the game evaluates win/lose/continue.

---

## UI / HUD

All HUD elements sit at depth 2 (above the board at depth 0, below overlays at depth 10+).

| Element | Position | Content |
|---|---|---|
| Score label | Top-left | `Score: N / target` |
| Level badge | Top-center (gold) | `LEVEL X / 3` |
| Moves label | Top-right | `Moves: N` |
| Progress bar | Below labels | Fills left-to-right as score climbs toward target (max 300 px wide) |

---

## Input & Gem Control

### Pointer Events

| Event | Handler | Purpose |
|---|---|---|
| `pointerdown` on gem | `onDragStart` | Begin drag |
| `pointermove` (global) | `onDragMove` | Move gem / update preview |
| `pointerup` (global) | `onDragEnd` | Resolve swap or snap back |

---

### Drag Start (`onDragStart`)

When the pointer goes down on a gem:

- The gem is stored as `dragSprite` and floated to render depth 1 (above its neighbours).
- `_origX / _origY` capture the exact grid-centre pixel position before any movement.
- Axis-lock state (`dragAxis`), axis reference (`axisRefX/Y`), frame-velocity trackers (`prevPointerX/Y`), and `previewNeighbor` are all reset so each drag starts clean.

---

### Gem Follows Mouse (`onDragMove`)

#### Axis Lock

Movement is free until the pointer travels more than **8 px** from the drag-start reference. At that point the dominant direction (horizontal or vertical) is locked for the rest of the drag. The gem is constrained to move only along the locked axis, capped at exactly one cell width (64 px) in either direction — it can never overshoot the adjacent slot.

#### Live Preview Swap

While dragging, the game tracks which grid cell the gem's centre currently occupies:

- When the centre enters an **adjacent cell**, the gem that lives there (`previewNeighbor`) slides to the dragged gem's home slot with a smooth 200 ms `Power2` tween. This gives immediate visual feedback that a swap is pending.
- When the dragged gem's centre returns to its **own cell**, the preview gem slides back home with a matching 200 ms tween (cancelled preview).
- If the drag crosses a different adjacent cell, the old preview is cancelled and a new one starts for the new neighbor.

The neighbor's home coordinates are always computed from its logical `row/col` (not its current pixel position) to prevent mid-tween drift if previews are triggered rapidly.

#### Axis Switch

The player can change drag direction only when all of the following are true:

1. The dragged gem's centre is back **in its own cell** (not hovering over a neighbor).
2. **No preview is active** (the neighbor has returned home or was never started).
3. The perpendicular **frame-velocity** exceeds `CFG.AXIS_SWITCH_VEL` (default **8 px/frame**).

Condition 3 filters out the tiny cross-axis jitter that always accompanies real mouse and touch input, preventing the gem from snapping back to centre unexpectedly during a clean horizontal or vertical drag.

When triggered:
- The axis flips (h → v or v → h).
- The axis reference point resets to the current pointer position (so the new axis starts measuring delta from zero).
- The gem snaps instantly to its home slot centre, then immediately begins following the new axis.

---

### Drag End (`onDragEnd`)

Three resolution paths:

#### 1. Confirm Swap (gem centre in adjacent cell)
The gem's centre is over an adjacent cell when the button is released.

- Both tweens are killed immediately (preview tween on the neighbor, any remaining tween on the dragged gem).
- The dragged gem is snapped to the neighbor's slot centre (`setPosition`) — no forward animation needed because the player already dragged it there.
- The neighbor is snapped to the dragged gem's original slot centre — no animation needed because the preview already moved it there.
- `trySwap` runs the match check. If valid the swap commits; if invalid both gems animate back to their original positions.

#### 2. Snap Back (gem centre in own cell)
The player released the button before the gem crossed into the neighbor's territory.

- Any active preview is cancelled (neighbor returns home with a 200 ms tween).
- The dragged gem springs back to its own slot with a 200 ms `Back.easeOut` tween (springy overshoot).

#### 3. Fast Swipe (axis never locked)
The pointer moved and lifted so quickly that `onDragMove` never fired far enough to lock an axis. The gem is still visually at its home position.

- If the net pointer displacement is ≥ 30% of a cell (≈ 19 px), a swap is attempted in the dominant swipe direction using a normal animated `trySwap`.
- Otherwise it was a plain tap — no action.

---

### Swap Animation (`animSwap`)

Two simultaneous 200 ms `Power2` position tweens (one per gem). A shared counter fires the completion callback exactly once after both finish. Used for:

- The **forward animation** in the fast-swipe path (axis-never-locked).
- The **revert animation** when a swap produces no match (both gems animate back).

---

## Tuning Reference

All tunable values live in the `CFG` object at the top of `game.js` or in clearly labeled `LEVELS`/color arrays. No magic numbers are scattered through the logic.

| Constant | Default | Effect |
|---|---|---|
| `CFG.COLS / ROWS` | 8 / 8 | Board dimensions |
| `CFG.CELL` | 64 | Cell size in pixels; scales everything automatically |
| `CFG.TYPES` | 5 | Number of distinct gem colors (3–7 recommended) |
| `CFG.AXIS_SWITCH_VEL` | 8 | Perpendicular px/frame threshold to switch drag axis (raise to reduce sensitivity; suggested range 5–20) |
| `LEVELS[n].target` | 1000/1200/1500 | Score needed to clear each level |
| `LEVELS[n].moves` | 20/20/18 | Move budget per level |

---

## Overlay Screens

| Screen | Trigger | Action |
|---|---|---|
| Level Complete | Score ≥ target, not the last level | Advances to next level |
| Victory | Score ≥ target on Level 3 | Restarts from Level 1 |
| Game Over | Moves = 0 **or** deadlock | Restarts from Level 1 |
