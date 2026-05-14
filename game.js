'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Central place for every tunable game parameter.
// Change values here to adjust difficulty, board size, or layout without
// touching any of the gameplay logic below.
const CFG = {
  // ── Board dimensions ───────────────────────────────────────────────────────
  COLS: 8,    // Number of columns. Increase for a wider board.
  ROWS: 8,    // Number of rows.    Increase for a taller board.
  CELL: 64,   // Pixel size of each square cell (width & height).
              // Changing CELL also scales all candy and hit-area sizes automatically.

  // ── Game rules ─────────────────────────────────────────────────────────────
  TYPES: 5,   // Distinct candy colors. Range 3–7 recommended.
              // Fewer types → more accidental matches (easier).
              // More  types → fewer matches (harder).
              // Must match the length of the COLORS / DARK_COLORS arrays below.
  // Note: score target and move budget are now per-level — see the LEVELS array below.

  // ── Layout (derived from COLS, ROWS, CELL) ─────────────────────────────────
  OX: 44,   // Board left edge X in pixels.  Formula: (W - COLS*CELL) / 2
  OY: 80,   // Board top  edge Y in pixels.  Leaves 80 px for the HUD bar above.
  W: 600,   // Canvas width  in pixels.
  H: 640,   // Canvas height in pixels.
};

// ── Candy color palette ────────────────────────────────────────────────────
// Each index corresponds to one candy type (0 … CFG.TYPES-1).
// COLORS      : main body fill color.
// DARK_COLORS : shadow/depth layer (should be a darker shade of the matching COLORS entry).
//
// To change a candy's appearance: update both arrays at the same index.
// To add a new type: append a color to both arrays and increment CFG.TYPES.
const COLORS      = [0xE74C3C, 0x3498DB, 0x2ECC71, 0xF1C40F, 0x9B59B6];
const DARK_COLORS = [0xB03A2E, 0x2E86C1, 0x239B56, 0xD4AC0D, 0x7D3C98];

// ── Level definitions ────────────────────────────────────────────────────────
// Each entry defines one stage of the 3-level progression.
//   target : score the player must reach to clear the level.
//   moves  : move budget for that level (fewer = harder).
// Add more entries to extend the game; everything else adapts automatically.
const LEVELS = [
  { target: 1000, moves: 20 }, // Level 1 — introductory
  { target: 1200, moves: 20 }, // Level 2 — intermediate
  { target: 1500, moves: 18 }, // Level 3 — challenging
];

// ─── BOOT SCENE ──────────────────────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }
  create() { this.scene.start('GameScene'); }
}

// ─── GAME SCENE ──────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  /**
   * Receives the level index when scene.restart({ level: n }) is called.
   * Defaults to 0 (Level 1) on first launch or after a full reset.
   * Phaser calls init() before create() on every scene start/restart.
   *
   * @param {{ level?: number }} data - Startup data passed from scene.restart().
   */
  init(data) {
    this.currentLevel = (data && data.level != null) ? data.level : 0;
  }

  create() {
    const lvl         = LEVELS[this.currentLevel]; // pull this level's config
    this.target       = lvl.target;  // score needed to clear this level
    this.movesMax     = lvl.moves;   // starting move budget for this level
    this.board    = [];   // board[r][c] = type id (0-4), -1 = empty
    this.sprites  = [];   // sprites[r][c] = Phaser.GameObjects.Graphics
    this.selected = null; // currently selected candy sprite
    this.score    = 0;
    this.moves    = this.movesMax;
    this.busy     = false; // blocks input during animations

    this.drawBackground();
    this.initBoard();
    this.createAllSprites();
    this.createHUD();
  }

  // ── BACKGROUND ─────────────────────────────────────────────────────────────
  /**
   * Draws all static, non-interactive visual layers:
   *   - Dark full-canvas backdrop.
   *   - HUD bar rectangle behind the score/moves text.
   *   - Alternating checker-style tile colors behind each candy cell.
   *
   * Tuning:
   *   - Alternating cell shades (0x2C3E50 / 0x34495E): the two tile colors.
   *   - HUD bar color (0x2C3E50): unify with tile color for a seamless look.
   */
  drawBackground() {
    // Dark page fill
    this.add.rectangle(CFG.W / 2, CFG.H / 2, CFG.W, CFG.H, 0x1A2634);
    // HUD bar
    this.add.rectangle(CFG.W / 2, 40, CFG.W, 80, 0x2C3E50);

    // Checker-style board cells
    for (let r = 0; r < CFG.ROWS; r++) {
      for (let c = 0; c < CFG.COLS; c++) {
        const x     = CFG.OX + c * CFG.CELL + CFG.CELL / 2;
        const y     = CFG.OY + r * CFG.CELL + CFG.CELL / 2;
        const shade = (r + c) % 2 === 0 ? 0x2C3E50 : 0x34495E;
        this.add.rectangle(x, y, CFG.CELL - 2, CFG.CELL - 2, shade);
      }
    }
  }

  // ── BOARD INITIALISATION ───────────────────────────────────────────────────
  /**
   * Entry point for board generation.
   * Calls fillBoard() repeatedly until the resulting board has at least one
   * legal swap (i.e., is not in a deadlock state from the very start).
   *
   * Tuning:
   *   - Max attempts (100): safety cap to prevent infinite loops on unusual
   *     configurations. In practice 1–2 iterations are almost always enough
   *     on a standard 8×8 grid with 5 candy types.
   */
  initBoard() {
    let attempts = 0;
    do {
      this.fillBoard();
      attempts++;
    } while (!this.hasValidMoves() && attempts < 100);
  }

  /**
   * Fills the board 2D array with random candy type IDs (0 … CFG.TYPES-1).
   * Uses wouldMatchAt() to reject any placement that would immediately create
   * a 3-in-a-row, ensuring the board starts in a clean, match-free state.
   *
   * Tuning:
   *   - Inner retry limit (50): max re-rolls per cell before giving up and
   *     accepting a potentially matching type. Increase if CFG.TYPES is small
   *     (3 or fewer), where valid placements are rarer.
   */
  fillBoard() {
    this.board = [];
    for (let r = 0; r < CFG.ROWS; r++) {
      this.board[r] = [];
      for (let c = 0; c < CFG.COLS; c++) {
        let type, tries = 0;
        do {
          type = Phaser.Math.Between(0, CFG.TYPES - 1);
          tries++;
        } while (this.wouldMatchAt(r, c, type) && tries < 50);
        this.board[r][c] = type;
      }
    }
  }

  /**
   * Returns true if placing `type` at grid position (r, c) would create a
   * horizontal or vertical run of 3 identical candies.
   *
   * Only checks leftward and upward because the board is filled top-left →
   * bottom-right, so cells to the right and below have not yet been placed.
   *
   * @param {number} r    - Row index of the candidate cell.
   * @param {number} c    - Column index of the candidate cell.
   * @param {number} type - Candy type ID being tested.
   * @returns {boolean}
   */
  wouldMatchAt(r, c, type) {
    if (c >= 2 && this.board[r][c - 1] === type && this.board[r][c - 2] === type) return true;
    if (r >= 2 && this.board[r - 1][c] === type && this.board[r - 2][c] === type) return true;
    return false;
  }

  /**
   * Deadlock detector. Simulates every possible adjacent swap on the board
   * and checks whether any produces at least one match. Each simulated swap
   * is immediately reversed so the board data is never permanently changed.
   *
   * Called in two places:
   *   1. After fillBoard() — guarantees a playable starting board.
   *   2. After every cascade — detects mid-game deadlocks (triggers a loss).
   *
   * Performance note: O(ROWS × COLS × 2) swap simulations, each followed by
   * a full findMatches() scan. Acceptable for 8×8; consider caching for
   * significantly larger grids.
   *
   * @returns {boolean} True if at least one valid swap exists.
   */
  hasValidMoves() {
    for (let r = 0; r < CFG.ROWS; r++) {
      for (let c = 0; c < CFG.COLS; c++) {
        if (c + 1 < CFG.COLS) {
          this.swapBoard(r, c, r, c + 1);
          const ok = this.findMatches().length > 0;
          this.swapBoard(r, c, r, c + 1);
          if (ok) return true;
        }
        if (r + 1 < CFG.ROWS) {
          this.swapBoard(r, c, r + 1, c);
          const ok = this.findMatches().length > 0;
          this.swapBoard(r, c, r + 1, c);
          if (ok) return true;
        }
      }
    }
    return false;
  }

  /**
   * Swaps the candy type values of two cells in the board data array in-place.
   * Pure data operation — does not move sprites or trigger any animation.
   * Used by hasValidMoves() for simulation and by trySwap() for actual moves.
   *
   * @param {number} r1 - Row of the first cell.
   * @param {number} c1 - Column of the first cell.
   * @param {number} r2 - Row of the second cell.
   * @param {number} c2 - Column of the second cell.
   */
  swapBoard(r1, c1, r2, c2) {
    [this.board[r1][c1], this.board[r2][c2]] = [this.board[r2][c2], this.board[r1][c1]];
  }

  // ── MATCH DETECTION ────────────────────────────────────────────────────────
  /**
   * Scans the entire board for horizontal and vertical runs of 3 or more
   * identical candy types and returns every matched cell position.
   *
   * Algorithm: single-pass run-length counting across each row, then each
   * column. A Set of "r,c" strings deduplicates cells that belong to both
   * a horizontal and a vertical run simultaneously.
   *
   * Cells with value -1 (cleared/in-flight) are never included in a run.
   *
   * Tuning:
   *   - Minimum run length (3): the constant embedded in `run >= 3`.
   *     Change to 4 for a harder variant where only 4-in-a-row counts.
   *
   * @returns {Array<{r: number, c: number}>} Unique matched cell positions.
   */
  findMatches() {
    const set = new Set();

    // Horizontal runs
    for (let r = 0; r < CFG.ROWS; r++) {
      let run = 1;
      for (let c = 1; c <= CFG.COLS; c++) {
        if (c < CFG.COLS && this.board[r][c] !== -1 && this.board[r][c] === this.board[r][c - 1]) {
          run++;
        } else {
          if (run >= 3) for (let k = c - run; k < c; k++) set.add(`${r},${k}`);
          run = 1;
        }
      }
    }

    // Vertical runs
    for (let c = 0; c < CFG.COLS; c++) {
      let run = 1;
      for (let r = 1; r <= CFG.ROWS; r++) {
        if (r < CFG.ROWS && this.board[r][c] !== -1 && this.board[r][c] === this.board[r - 1][c]) {
          run++;
        } else {
          if (run >= 3) for (let k = r - run; k < r; k++) set.add(`${k},${c}`);
          run = 1;
        }
      }
    }

    return [...set].map(s => { const [r, c] = s.split(',').map(Number); return { r, c }; });
  }

  // ── SPRITES ────────────────────────────────────────────────────────────────
  /**
   * Initialises the sprites 2D array and creates one candy Graphics sprite
   * for every cell in the board. Called once during scene setup, after the
   * board data has been generated by initBoard().
   */
  createAllSprites() {
    this.sprites = [];
    for (let r = 0; r < CFG.ROWS; r++) {
      this.sprites[r] = [];
      for (let c = 0; c < CFG.COLS; c++) {
        this.sprites[r][c] = this.makeSprite(r, c, this.board[r][c]);
      }
    }
  }

  /**
   * Creates and returns a single interactive Graphics candy sprite positioned
   * at the screen coordinates of grid cell (r, c).
   *
   * The logical state (row, col, candyType) is stored directly on the object
   * so input handlers and gravity logic can read it without looking up the
   * board array.
   *
   * Tuning:
   *   - Hit circle radius (CFG.CELL / 2 - 4): decrease if adjacent candies
   *     steal clicks from each other; increase (up to CFG.CELL / 2) for a
   *     larger click target.
   *
   * @param {number} r    - Row index.
   * @param {number} c    - Column index.
   * @param {number} type - Candy type ID (0 … CFG.TYPES-1).
   * @returns {Phaser.GameObjects.Graphics}
   */
  makeSprite(r, c, type) {
    const x   = CFG.OX + c * CFG.CELL + CFG.CELL / 2;
    const y   = CFG.OY + r * CFG.CELL + CFG.CELL / 2;
    const gfx = this.add.graphics();
    gfx.setPosition(x, y);
    this.paintCandy(gfx, type, false);
    gfx.setInteractive(
      new Phaser.Geom.Circle(0, 0, CFG.CELL / 2 - 4),
      Phaser.Geom.Circle.Contains
    );
    gfx.row       = r;
    gfx.col       = c;
    gfx.candyType = type;
    gfx.on('pointerdown', () => { if (!this.busy) this.onCandyClick(gfx); });
    return gfx;
  }

  /**
   * Redraws the visual appearance of a candy Graphics object from scratch.
   * Layers are painted bottom-to-top:
   *   1. White selection ring  (only when selected = true).
   *   2. Dark drop-shadow circle (offset slightly down-right for depth).
   *   3. Main colored body circle.
   *   4. Semi-transparent white specular highlight (top-left gloss dot).
   *
   * Called by makeSprite() on creation and by select()/deselect() whenever
   * the selection state changes.
   *
   * Tuning:
   *   - rad (CFG.CELL / 2 - 5): candy body radius. Decrease for more gap between candies.
   *   - Shadow offset (2 px right, 4 px down): increase for a more pronounced 3-D look.
   *   - Highlight alpha (0.38): lower for a flatter/matte style; raise toward 1.0 for glossy.
   *   - Highlight radius (rad * 0.3) and position (-rad * 0.27): control the gloss shape.
   *   - Selection ring stroke width (3) and outset (+5 px): adjust the selection indicator.
   *
   * @param {Phaser.GameObjects.Graphics} gfx      - Graphics object to redraw.
   * @param {number}                      type     - Candy type index (picks color).
   * @param {boolean}                     selected - Whether to draw the selection ring.
   */
  paintCandy(gfx, type, selected) {
    gfx.clear();
    const rad = CFG.CELL / 2 - 5;

    // Selection ring
    if (selected) {
      gfx.lineStyle(3, 0xFFFFFF, 1);
      gfx.strokeCircle(0, 0, rad + 5);
    }

    // Drop shadow
    gfx.fillStyle(DARK_COLORS[type], 1);
    gfx.fillCircle(2, 4, rad);

    // Main body
    gfx.fillStyle(COLORS[type], 1);
    gfx.fillCircle(0, 0, rad);

    // Specular highlight
    gfx.fillStyle(0xFFFFFF, 0.38);
    gfx.fillCircle(-rad * 0.27, -rad * 0.27, rad * 0.3);
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  /**
   * Builds the heads-up display overlay:
   *   - Score label (top-left): current score vs. level target.
   *   - Level badge (top-center): "LEVEL X / 3" in gold.
   *   - Moves label (top-right): remaining moves.
   *   - Progress bar (below labels): fills left-to-right as score climbs toward target.
   *
   * All elements use depth 2 so they always render above board sprites (depth 0)
   * but below the end-game overlay (depth 10+).
   *
   * Tuning:
   *   - Progress bar track width (302) and max fill (300): keep the 1 px margin.
   *   - Progress bar fill color (0xF1C40F / gold): change to match your theme.
   *   - Font sizes ('17px'): increase for larger/higher-DPI displays.
   */
  createHUD() {
    this.scoreText = this.add.text(16, 12, '', {
      fontSize: '17px', color: '#ECF0F1', fontFamily: 'Arial',
    }).setDepth(2);

    // Centered level badge — gold to stand out from the white score/moves text.
    // Tuning: change color or fontStyle to match your theme.
    this.levelText = this.add.text(CFG.W / 2, 12, '', {
      fontSize: '17px', color: '#F1C40F', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(2);

    this.movesText = this.add.text(CFG.W - 110, 12, '', {
      fontSize: '17px', color: '#ECF0F1', fontFamily: 'Arial',
    }).setDepth(2);

    // Progress bar track
    this.add.rectangle(CFG.W / 2, 57, 302, 14, 0x4A6278).setDepth(2);
    // Progress bar fill (grows from left)
    this.progressFill = this.add.rectangle(CFG.W / 2 - 150, 57, 0, 12, 0xF1C40F)
      .setOrigin(0, 0.5)
      .setDepth(2);

    this.updateHUD();
  }

  /**
   * Syncs all HUD elements to the current game state.
   * Called after every valid swap and after each cascade chain resolves.
   *
   * The progress bar width scales linearly from 0 to 300 px as the score
   * climbs from 0 to this.target, then is clamped at 300 so it never
   * overflows the track rectangle.
   */
  updateHUD() {
    this.levelText.setText(`LEVEL ${this.currentLevel + 1} / ${LEVELS.length}`);
    this.scoreText.setText(`Score: ${this.score} / ${this.target}`);
    this.movesText.setText(`Moves: ${this.moves}`);
    this.progressFill.width = Math.min(300 * (this.score / this.target), 300);
  }

  // ── INPUT ──────────────────────────────────────────────────────────────────
  /**
   * Click state machine — the single entry point for all player interaction.
   *
   * Three possible outcomes per click:
   *   1. Nothing selected   → select the clicked candy.
   *   2. Same candy again   → deselect it (toggle off).
   *   3. Different candy:
   *        a. Adjacent (Manhattan distance = 1) → attempt a swap.
   *        b. Non-adjacent                      → change selection to new candy.
   *
   * Calls are silently ignored while this.busy is true (animations in progress).
   *
   * @param {Phaser.GameObjects.Graphics} sprite - The candy that was clicked.
   */
  onCandyClick(sprite) {
    if (this.selected === null) {
      this.select(sprite);
    } else if (this.selected === sprite) {
      this.deselect();
    } else {
      const dr = Math.abs(sprite.row - this.selected.row);
      const dc = Math.abs(sprite.col - this.selected.col);
      if (dr + dc === 1) {
        // Adjacent — try swap
        const prev = this.selected;
        this.deselect();
        this.trySwap(prev, sprite);
      } else {
        // Not adjacent — change selection
        this.deselect();
        this.select(sprite);
      }
    }
  }

  /**
   * Marks a candy as the active selection.
   * Repaints it with the white ring and starts an infinite scale-pulse tween
   * so the player knows which candy is "held".
   *
   * Tuning:
   *   - Pulse peak scale (1.12): how large the candy grows each cycle.
   *     1.0 = no pulse. Values above ~1.2 can feel jittery.
   *   - Pulse half-cycle duration (220 ms): time to grow or shrink once.
   *     Lower for a faster heartbeat; higher for a slow, calm pulse.
   *
   * @param {Phaser.GameObjects.Graphics} sprite - Candy to select.
   */
  select(sprite) {
    this.selected = sprite;
    this.paintCandy(sprite, sprite.candyType, true);
    this.tweens.add({
      targets: sprite, scaleX: 1.12, scaleY: 1.12,
      duration: 220, yoyo: true, repeat: -1,
    });
  }

  /**
   * Clears the current selection: kills the pulse tween, resets scale to 1,
   * and repaints the candy without the selection ring.
   * Safe to call when nothing is selected (no-op guard at the top).
   */
  deselect() {
    if (!this.selected) return;
    this.tweens.killTweensOf(this.selected);
    this.selected.setScale(1);
    this.paintCandy(this.selected, this.selected.candyType, false);
    this.selected = null;
  }

  // ── SWAP LOGIC ─────────────────────────────────────────────────────────────
  /**
   * Full swap pipeline for two adjacent candies.
   *
   * Phase 1 — Animate both sprites to each other's pixel position.
   * Phase 2 — Commit the swap in the board data and sprite-tracking arrays.
   * Phase 3 — Run match detection on the updated board.
   *   • No matches → invalid swap: revert board data, sprite tracking, and
   *     animate both sprites back. Move counter is NOT decremented.
   *   • Matches found → valid swap: decrement move counter, update HUD,
   *     then hand off to processMatches().
   *
   * Sets this.busy = true for the entire duration to block further input.
   *
   * @param {Phaser.GameObjects.Graphics} s1 - First candy.
   * @param {Phaser.GameObjects.Graphics} s2 - Second candy (must be adjacent to s1).
   */
  trySwap(s1, s2) {
    this.busy = true;
    const r1 = s1.row, c1 = s1.col, r2 = s2.row, c2 = s2.col;
    const x1 = s1.x,  y1 = s1.y,  x2 = s2.x,  y2 = s2.y;

    // Animate forward
    this.animSwap(s1, s2, x2, y2, x1, y1, () => {
      // Commit swap on board and sprite tracking
      this.swapBoard(r1, c1, r2, c2);
      s1.row = r2; s1.col = c2;
      s2.row = r1; s2.col = c1;
      this.sprites[r2][c2] = s1;
      this.sprites[r1][c1] = s2;

      const matches = this.findMatches();
      if (matches.length === 0) {
        // Invalid — revert everything
        this.swapBoard(r1, c1, r2, c2);
        s1.row = r1; s1.col = c1;
        s2.row = r2; s2.col = c2;
        this.sprites[r1][c1] = s1;
        this.sprites[r2][c2] = s2;
        this.animSwap(s1, s2, x1, y1, x2, y2, () => { this.busy = false; });
      } else {
        this.moves--;
        this.updateHUD();
        this.processMatches(matches, 1);
      }
    });
  }

  /**
   * Fires two simultaneous position tweens (one per sprite) and invokes
   * onDone exactly once after both have finished.
   * A shared counter ensures the callback is never called early or twice,
   * even if both tweens happen to complete on the same frame.
   *
   * Tuning:
   *   - duration (200 ms): slide speed. Lower = snappier; higher = more fluid.
   *   - ease ('Power2'): Phaser easing. 'Back.easeOut' adds a fun overshoot.
   *
   * @param {Phaser.GameObjects.Graphics} s1/s2       - Sprites to animate.
   * @param {number}   nx1, ny1 - Target pixel position for s1.
   * @param {number}   nx2, ny2 - Target pixel position for s2.
   * @param {Function} onDone   - Callback fired once both tweens complete.
   */
  animSwap(s1, s2, nx1, ny1, nx2, ny2, onDone) {
    let done = 0;
    const tick = () => { if (++done === 2) onDone(); };
    this.tweens.add({ targets: s1, x: nx1, y: ny1, duration: 200, ease: 'Power2', onComplete: tick });
    this.tweens.add({ targets: s2, x: nx2, y: ny2, duration: 200, ease: 'Power2', onComplete: tick });
  }

  // ── MATCH PROCESSING ───────────────────────────────────────────────────────
  /**
   * Handles one round of matched candies (player-triggered or cascade).
   *
   * Steps:
   *   1. Score:   pts = matchedCells × 10 × cascadeDepth
   *              (depth=1 on the player's swap, +1 for each subsequent chain).
   *   2. HUD:    update score display and progress bar.
   *   3. Float:  show a "+pts" label near the centre of the cleared group.
   *   4. Clear:  shrink-and-destroy each matched candy sprite with a tween.
   *   5. Gravity: once the last sprite is gone, call applyGravity().
   *
   * Tuning:
   *   - Base points per candy (10): increase for more generous scoring.
   *   - Cascade multiplier formula (× depth): change to e.g. (× depth²) or
   *     (+ depth * 50) for a different bonus curve on long chains.
   *   - Destroy tween duration (180 ms): how long the shrink-out animation takes.
   *
   * @param {Array<{r,c}>} matches - Cell positions cleared in this round.
   * @param {number}       depth   - Cascade depth (1 = first clear, 2 = first chain, …).
   */
  processMatches(matches, depth) {
    const pts = matches.length * 10 * depth;
    this.score += pts;
    this.updateHUD();
    this.showFloatText(matches, `+${pts}`);

    let remaining = matches.length;
    matches.forEach(({ r, c }) => {
      const sp = this.sprites[r][c];
      this.board[r][c]   = -1;
      this.sprites[r][c] = null;
      this.tweens.add({
        targets: sp, scaleX: 0, scaleY: 0, alpha: 0,
        duration: 180,
        onComplete: () => {
          sp.destroy();
          if (--remaining === 0) this.applyGravity(depth);
        },
      });
    });
  }

  // ── GRAVITY & REFILL ───────────────────────────────────────────────────────
  /**
   * Compacts each column downward after candies have been cleared, then fills
   * empty top slots with newly spawned candies that fall in from above the board.
   *
   * Algorithm (per column):
   *   1. Collect all surviving (non-empty) candies into alive[], bottom-to-top.
   *   2. Re-assign them to the bottommost rows (they "fall" into gaps).
   *      Any that have not moved are skipped (no tween needed).
   *   3. For each empty slot remaining at the top, create a new random candy
   *      above the visible board area and tween it down into place.
   *   4. Track all active fall tweens; once the last one completes, call
   *      afterGravity() to check for cascades.
   *
   * Tuning:
   *   - Existing-candy fall duration (280 ms): speed of existing candies dropping.
   *   - New-candy fall duration (320 ms): slightly slower so new ones feel heavier.
   *   - New-candy stagger delay (aboveIdx × 40 ms): staggers the entrance of new
   *     candies from top — set to 0 for all new candies to fall simultaneously.
   *   - Easing ('Cubic.easeIn'): accelerating fall. 'Bounce.easeOut' adds a
   *     bouncy landing but can feel chaotic during long cascades.
   *
   * @param {number} depth - Current cascade depth, forwarded to afterGravity().
   */
  applyGravity(depth) {
    let total = 0;
    let done  = 0;
    const onFall = () => { if (++done >= total) this.afterGravity(depth); };

    for (let c = 0; c < CFG.COLS; c++) {
      // Collect surviving (non-empty) candies bottom-to-top
      const alive = [];
      for (let r = CFG.ROWS - 1; r >= 0; r--) {
        if (this.board[r][c] !== -1) {
          alive.push({ type: this.board[r][c], sp: this.sprites[r][c] });
        }
      }

      for (let i = 0; i < CFG.ROWS; i++) {
        const r       = CFG.ROWS - 1 - i;                       // bottom → top
        const targetY = CFG.OY + r * CFG.CELL + CFG.CELL / 2;

        if (i < alive.length) {
          // Existing candy falls into its new row
          const { type, sp } = alive[i];
          this.board[r][c]   = type;
          this.sprites[r][c] = sp;
          sp.row = r;
          sp.col = c;
          if (Math.abs(sp.y - targetY) > 0.5) {
            total++;
            this.tweens.add({
              targets: sp, y: targetY,
              duration: 280, ease: 'Cubic.easeIn',
              onComplete: onFall,
            });
          }
        } else {
          // New candy spawns above the board and falls in
          const aboveIdx = i - alive.length;          // 0 = closest to board
          const newType  = Phaser.Math.Between(0, CFG.TYPES - 1);
          const sp       = this.makeSprite(r, c, newType);
          sp.y = CFG.OY - (aboveIdx + 1) * CFG.CELL + CFG.CELL / 2;
          this.board[r][c]   = newType;
          this.sprites[r][c] = sp;
          total++;
          this.tweens.add({
            targets: sp, y: targetY,
            duration: 320, ease: 'Cubic.easeIn',
            delay: aboveIdx * 40,
            onComplete: onFall,
          });
        }
      }
    }

    // Safety: if nothing needed to move
    if (total === 0) this.afterGravity(depth);
  }

  /**
   * Called once all falling animations (existing + new candies) have completed.
   * Re-scans the board for matches created by the newly settled arrangement.
   *
   *   • New matches found → pause briefly so the player can register the settled
   *     board, then call processMatches() with an incremented depth (cascade).
   *   • No new matches   → call checkEnd() to evaluate win / lose / continue.
   *
   * Tuning:
   *   - Cascade pause (120 ms): breathing room before processing a chain.
   *     Increase to ~300 ms for a more deliberate pace; lower toward 0 for
   *     a rapid-fire cascade feel.
   *
   * @param {number} depth - Cascade depth passed into the next processMatches().
   */
  afterGravity(depth) {
    const newMatches = this.findMatches();
    if (newMatches.length > 0) {
      // Cascade — brief pause so the player can see new board state
      this.time.delayedCall(120, () => this.processMatches(newMatches, depth + 1));
    } else {
      this.checkEnd();
    }
  }

  // ── WIN / LOSE ─────────────────────────────────────────────────────────────
  /**
   * Evaluates the game state after all cascades have resolved.
   *
   * Priority order:
   *   1. score ≥ this.target             → Level win.
   *        • More levels remain          → showLevelComplete() (small-win interstitial).
   *        • Final level cleared         → showVictory() (grand-finale screen).
   *   2. moves remaining = 0             → Lose (exhausted all moves).
   *   3. No valid swap exists (deadlock) → Lose (board is stuck).
   *   4. Otherwise                       → continue; release the busy lock.
   *
   * Cases 1–3 lock input (busy = true) and schedule the overlay after a short
   * delay so the player can see the final board state before it appears.
   *
   * Tuning:
   *   - Overlay delay (300 ms): pause between last cascade settling and the
   *     overlay appearing. Increase for a more dramatic finish.
   */
  checkEnd() {
    if (this.score >= this.target) {
      this.busy = true;
      if (this.currentLevel < LEVELS.length - 1) {
        // More levels ahead — show the level-complete interstitial
        this.time.delayedCall(300, () => this.showLevelComplete());
      } else {
        // Final level cleared — grand victory!
        this.time.delayedCall(300, () => this.showVictory());
      }
    } else if (this.moves <= 0) {
      this.busy = true;
      this.time.delayedCall(300, () => this.showResult());
    } else if (!this.hasValidMoves()) {
      this.busy = true;
      this.time.delayedCall(300, () => this.showResult());
    } else {
      this.busy = false;
    }
  }

  /**
   * "Game Over" overlay — only called for losses (ran out of moves or deadlock).
   * Level wins use showLevelComplete() and showVictory() instead.
   *
   * Always restarts from Level 1 so the player retries the whole journey.
   *
   * Tuning:
   *   - Dim overlay alpha (0.65): raise toward 1.0 for a darker background.
   *   - Button color (0x2980B9 / hover 0x3498DB): any hex pair.
   */
  showResult() {
    this.busy = true;
    const cx = CFG.W / 2;
    const cy = CFG.H / 2;

    // Dim overlay
    this.add.rectangle(cx, cy, CFG.W, CFG.H, 0x000000, 0.65).setDepth(10);

    // Card
    this.add.rectangle(cx, cy, 340, 260, 0x2C3E50).setDepth(11);
    this.add.rectangle(cx, cy, 336, 256, 0xC0392B, 0.25).setDepth(11);

    this.add.text(cx, cy - 97, '💔', { fontSize: '44px' })
      .setOrigin(0.5).setDepth(12);

    // Title
    this.add.text(cx, cy - 52, 'GAME OVER', {
      fontSize: '36px', color: '#E74C3C',
      fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);

    // Stats
    this.add.text(cx, cy + 4, `Level ${this.currentLevel + 1}  |  Score: ${this.score}`, {
      fontSize: '18px', color: '#ECF0F1', fontFamily: 'Arial',
    }).setOrigin(0.5).setDepth(12);

    this.add.text(cx, cy + 34, `Moves used: ${this.movesMax - this.moves} / ${this.movesMax}`, {
      fontSize: '15px', color: '#BDC3C7', fontFamily: 'Arial',
    }).setOrigin(0.5).setDepth(12);

    this.add.text(cx, cy + 60, 'Better luck next time!', {
      fontSize: '15px', color: '#7F8C8D', fontFamily: 'Arial', fontStyle: 'italic',
    }).setOrigin(0.5).setDepth(12);

    // Try Again — restarts from Level 1
    const btn = this.add.rectangle(cx, cy + 103, 190, 50, 0x2980B9)
      .setDepth(12)
      .setInteractive({ useHandCursor: true });

    this.add.text(cx, cy + 103, 'Try Again', {
      fontSize: '20px', color: '#FFFFFF', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(13);

    btn.on('pointerover',  () => btn.setFillStyle(0x3498DB));
    btn.on('pointerout',   () => btn.setFillStyle(0x2980B9));
    btn.on('pointerdown',  () => this.scene.restart({ level: 0 }));
  }

  // ── FLOATING SCORE TEXT ────────────────────────────────────────────────────
  /**
   * Spawns a short-lived score label that floats upward and fades out near
   * the centre of the cleared candy cluster, giving the player instant
   * visual feedback on how many points they just earned.
   *
   * The label is anchored to the middle element of the matches array so it
   * appears roughly in the centre of the cleared group regardless of shape.
   *
   * Tuning:
   *   - Rise distance (y - 50 px): how far the label travels upward.
   *     Increase for a more dramatic float; decrease for a subtle nudge.
   *   - Fade duration (750 ms): time until the label fully disappears.
   *     Lower for a quick flash; raise to keep it readable longer.
   *   - Font size ('22px'): increase for more visual impact.
   *   - Text color (#F1C40F / gold): adjust to suit the board palette.
   *
   * @param {Array<{r,c}>} matches - Cleared cells used to find the label position.
   * @param {string}       label   - Text to display (e.g. "+30").
   */
  showFloatText(matches, label) {
    if (matches.length === 0) return;
    const m = matches[Math.floor(matches.length / 2)];
    const x = CFG.OX + m.c * CFG.CELL + CFG.CELL / 2;
    const y = CFG.OY + m.r * CFG.CELL + CFG.CELL / 2;
    const txt = this.add.text(x, y, label, {
      fontSize: '22px', color: '#F1C40F',
      fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(5);
    this.tweens.add({
      targets: txt, y: y - 50, alpha: 0,
      duration: 750,
      onComplete: () => txt.destroy(),
    });
  }

  // ─── LEVEL PROGRESSION OVERLAYS ─────────────────────────────────────────────

  /**
   * Small-win interstitial shown when the player clears a level that is NOT
   * the final level. Congratulates them with a per-level message and advances
   * to the next level when the button is pressed.
   *
   * scene.restart({ level: next }) passes the incremented index to init() so
   * create() pulls the correct entry from LEVELS[].
   *
   * Tuning:
   *   - msgs[]: change the icon, title, or subtitle for any level.
   *   - Card tint (0x27AE60 green): swap for another color to vary the mood.
   *   - Button color (0x27AE60 / hover 0x2ECC71): any hex pair.
   */
  showLevelComplete() {
    this.busy = true;
    const cx   = CFG.W / 2;
    const cy   = CFG.H / 2;
    const next = this.currentLevel + 1;

    // Per-level compliment content (indexed by currentLevel, i.e. the level just cleared)
    const msgs = [
      { icon: '🍬', title: 'Level 1 Complete!', sub: 'Sweet start!  Ready for more?' },
      { icon: '🍭', title: 'Level 2 Complete!', sub: 'Incredible!  The final challenge awaits…' },
    ];
    const msg = msgs[this.currentLevel] ||
      { icon: '⭐', title: `Level ${this.currentLevel + 1} Complete!`, sub: 'On to the next!' };

    // Dim overlay
    this.add.rectangle(cx, cy, CFG.W, CFG.H, 0x000000, 0.60).setDepth(10);

    // Card with green tint
    this.add.rectangle(cx, cy, 360, 270, 0x2C3E50).setDepth(11);
    this.add.rectangle(cx, cy, 356, 266, 0x27AE60, 0.25).setDepth(11);

    // Icon
    this.add.text(cx, cy - 105, msg.icon, { fontSize: '52px' })
      .setOrigin(0.5).setDepth(12);

    // Title
    this.add.text(cx, cy - 48, msg.title, {
      fontSize: '30px', color: '#2ECC71',
      fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);

    // Subtitle
    this.add.text(cx, cy + 4, msg.sub, {
      fontSize: '17px', color: '#BDC3C7', fontFamily: 'Arial',
    }).setOrigin(0.5).setDepth(12);

    // Mini stats — moves left carry no value but let player feel their efficiency
    this.add.text(cx, cy + 36, `Score: ${this.score}  |  Moves left: ${this.moves}`, {
      fontSize: '14px', color: '#7F8C8D', fontFamily: 'Arial',
    }).setOrigin(0.5).setDepth(12);

    // Next Level button
    const btn = this.add.rectangle(cx, cy + 92, 200, 50, 0x27AE60)
      .setDepth(12)
      .setInteractive({ useHandCursor: true });

    this.add.text(cx, cy + 92, `Level ${next + 1}  \u2192`, {
      fontSize: '20px', color: '#FFFFFF', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(13);

    btn.on('pointerover',  () => btn.setFillStyle(0x2ECC71));
    btn.on('pointerout',   () => btn.setFillStyle(0x27AE60));
    btn.on('pointerdown',  () => this.scene.restart({ level: next }));
  }

  /**
   * Grand-finale screen shown only when the player clears the last level.
   * Displays a trophy, champion title, stars, and a "Play Again" button that
   * restarts the whole journey from Level 1.
   *
   * Tuning:
   *   - Dim alpha (0.70): slightly darker than the level-complete overlay for
   *     extra emphasis on the momentous occasion.
   *   - Card tint (0xF39C12 amber/gold): warm color to complement the trophy theme.
   *   - Button color (0xD35400 / hover 0xE67E22): deep amber pair.
   */
  showVictory() {
    this.busy = true;
    const cx = CFG.W / 2;
    const cy = CFG.H / 2;

    // Dim overlay — slightly darker for extra weight
    this.add.rectangle(cx, cy, CFG.W, CFG.H, 0x000000, 0.70).setDepth(10);

    // Card with gold tint
    this.add.rectangle(cx, cy, 380, 320, 0x2C3E50).setDepth(11);
    this.add.rectangle(cx, cy, 376, 316, 0xF39C12, 0.25).setDepth(11);

    // Trophy icon
    this.add.text(cx, cy - 128, '\uD83C\uDFC6', { fontSize: '60px' })
      .setOrigin(0.5).setDepth(12);

    // Champion title
    this.add.text(cx, cy - 58, "YOU'RE A CHAMPION!", {
      fontSize: '26px', color: '#F1C40F',
      fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);

    // Flavour subtitle
    this.add.text(cx, cy - 14, 'All 3 levels conquered!', {
      fontSize: '18px', color: '#ECF0F1', fontFamily: 'Arial',
    }).setOrigin(0.5).setDepth(12);

    // Final score
    this.add.text(cx, cy + 22, `Final Score: ${this.score}`, {
      fontSize: '16px', color: '#BDC3C7', fontFamily: 'Arial',
    }).setOrigin(0.5).setDepth(12);

    // Star row
    this.add.text(cx, cy + 58, '\u2B50  \u2B50  \u2B50', {
      fontSize: '32px',
    }).setOrigin(0.5).setDepth(12);

    // Play Again button — goes back to Level 1
    const btn = this.add.rectangle(cx, cy + 114, 190, 50, 0xD35400)
      .setDepth(12)
      .setInteractive({ useHandCursor: true });

    this.add.text(cx, cy + 114, 'Play Again', {
      fontSize: '20px', color: '#FFFFFF', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(13);

    btn.on('pointerover',  () => btn.setFillStyle(0xE67E22));
    btn.on('pointerout',   () => btn.setFillStyle(0xD35400));
    btn.on('pointerdown',  () => this.scene.restart({ level: 0 }));
  }
}

// ─── PHASER GAME CONFIG ───────────────────────────────────────────────────────
const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: CFG.W,
  height: CFG.H,
  backgroundColor: '#1A2634',
  scene: [BootScene, GameScene],
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});
