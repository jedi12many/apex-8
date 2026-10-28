/*
 * APEX isometric dungeon: the reference for dungeon maps and the hero's movement. Integer maths only,
 * so a 6502 port that follows the same steps lands on exactly the same position every frame.
 *
 *   - the map is square tiles: 0 void, 1 floor, 2 wall; outside the map is void
 *   - positions are 8.8 fixed point in tiles (256 = one tile); x runs down-right on the screen,
 *     y down-left (isometric 2:1: a tile is a 32x16 pixel diamond)
 *   - one tick per 50 Hz frame; input is the joystick's bits: 1 up, 2 down, 4 left, 8 right
 *   - the hero walks the 8 screen directions at one speed, and only on floor
 *
 * parse(text) reads a map; hero(map) makes a hero at its start; tick(map, h, input) moves it one
 * frame; screen(h) is where it stands in screen pixels.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXISO = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 256;
  const VOID = 0, FLOOR = 1, WALL = 2;
  // The hero's square on the floor: RADIUS each way from its position.
  const RADIUS = 64;
  // A step per frame for each joystick direction (by its bits). Screen left and right move along both
  // axes, 2 pixels a frame; screen up and down 1 pixel a frame; the diagonals along one axis. All are
  // about 22/256 of a tile.
  const STEP = 16, DIAG = 22;
  const DIRS = [];
  DIRS[1] = [-STEP, -STEP]; DIRS[2] = [STEP, STEP]; DIRS[4] = [-STEP, STEP]; DIRS[8] = [STEP, -STEP];
  DIRS[5] = [-DIAG, 0]; DIRS[9] = [0, -DIAG]; DIRS[6] = [0, DIAG]; DIRS[10] = [DIAG, 0];

  // Map text: one character per tile, '#' wall, '.' floor, 'P' the start (floor); anything else is
  // void. Lines starting with ';' are comments; the first names the map.
  function parse(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const name = (lines.find(l => l.startsWith(';')) || '; dungeon').slice(1).trim();
    const rows = lines.filter(l => !l.startsWith(';') && l.length);
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const tiles = new Uint8Array(w * h);
    let start = null;
    rows.forEach((r, y) => {
      for (let x = 0; x < w; x++) {
        const ch = r[x] || ' ';
        tiles[y * w + x] = ch === '#' ? WALL : ch === '.' || ch === 'P' ? FLOOR : VOID;
        if (ch === 'P') start = { x, y };
      }
    });
    if (!start) throw new Error('map has no P');
    return { name, w, h, tiles, start };
  }

  const tileAt = (M, tx, ty) => (tx < 0 || ty < 0 || tx >= M.w || ty >= M.h ? VOID : M.tiles[ty * M.w + tx]);
  // Is the hero's square at (x, y) all on floor?
  function clear(M, x, y) {
    for (const ty of [(y - RADIUS) >> 8, (y + RADIUS - 1) >> 8])
      for (const tx of [(x - RADIUS) >> 8, (x + RADIUS - 1) >> 8]) if (tileAt(M, tx, ty) !== FLOOR) return false;
    return true;
  }

  function hero(M) {
    return { x: M.start.x * TILE + TILE / 2, y: M.start.y * TILE + TILE / 2, facing: 1, frame: 0, moving: false };
  }

  // One frame: step along x, then along y, each only if the square stays on floor.
  function tick(M, h, input) {
    const d = DIRS[input & 15];
    const x0 = h.x, y0 = h.y;
    if (d) {
      if (clear(M, h.x + d[0], h.y)) h.x += d[0];
      if (clear(M, h.x, h.y + d[1])) h.y += d[1];
      const sdx = d[0] - d[1]; // screen x direction
      if (sdx) h.facing = sdx > 0 ? 1 : -1;
    }
    h.moving = h.x !== x0 || h.y !== y0;
    h.frame = h.moving ? (h.frame + 1) & 15 : 0;
    return h;
  }

  // Where the hero stands on the screen's isometric plane, in whole pixels.
  const screen = h => ({ x: (h.x - h.y) >> 4, y: (h.x + h.y) >> 5 });

  return { TILE, VOID, FLOOR, WALL, RADIUS, DIRS, parse, tileAt, clear, hero, tick, screen };
});
