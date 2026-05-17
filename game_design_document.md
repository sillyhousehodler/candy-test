# Candy Crush Clone — Game Design Document

## Overview

A browser-based match-3 puzzle game inspired by Candy Crush. The player swaps adjacent gems on an 8×8 grid to form lines of 3 or more identical colors. Matching gems clear the board, earn points, and trigger satisfying cascade chains. The game spans three levels of increasing difficulty, culminating in a grand-victory screen when all three are cleared.

---

## The Board

The board is an 8×8 grid of colorful gems in five colors: **red, blue, green, yellow,** and **purple**. Each game starts with a fresh board — no pre-existing matches, and always at least one valid move available so the player is never immediately stuck.

---

## How to Play

**Press and drag** any gem toward an adjacent neighbor. The gem follows the finger/cursor, and the neighbor slides toward the vacated slot as a live preview of the pending swap. Release to confirm.

- If the resulting arrangement forms a match, the swap goes through.
- If it doesn't form a match, both gems spring back to their original positions.

**Dragging feels like a mobile game:**

- The gem locks onto the horizontal or vertical axis of the initial movement, so accidental diagonal drags never happen.
- A live preview shows the neighbor sliding into place *while* the player is still dragging — there's no need to guess whether a swap will work.
- If the player changes their mind mid-drag and brings the gem back to its starting slot, the preview resets and the direction can be switched freely.
- A quick flick (without a slow drag) also triggers a swap in the flick direction.

---

## Scoring

Every cleared gem earns **10 points**, multiplied by the current **cascade depth**:

| Event | Multiplier | Example (3 gems cleared) |
|---|---|---|
| Player's direct swap | ×1 | +30 pts |
| First automatic chain | ×2 | +60 pts |
| Second automatic chain | ×3 | +90 pts |

Cascades happen automatically: after cleared gems are removed, remaining gems fall down and new ones drop in from above. If the new arrangement creates fresh matches, they clear too — and the multiplier keeps climbing. A floating score label pops up above each clear so the player always knows what they earned.

---

## Level Design

| Level | Score Target | Moves | Feel |
|---|---|---|---|
| 1 | 1 000 | 20 | Introduction — learn the controls, easy matches |
| 2 | 1 200 | 20 | More pressure — same budget, higher bar |
| 3 | 1 500 | 18 | Challenge — tighter budget, biggest target |

Each level starts fresh with a new board. Clearing a level shows a congratulations screen before advancing. Move count and score do **not** carry over between levels.

---

## Victory & Defeat

**Level clear:** reach the score target before running out of moves. A level-complete screen celebrates the achievement and moves the player on to the next level. Clearing Level 3 shows the grand-victory screen.

**Game over:** two conditions end the game early:
1. The move budget hits zero before the score target is reached.
2. The board reaches a deadlock — no swap on the entire board would produce a match.

Both outcomes show the Game Over screen with the player's score and a prompt to try again from Level 1.