/*
 * APEX platformer: the reference for side-scrolling levels and player movement. Integer maths only,
 * so a 6502 port that follows the same steps lands on exactly the same position every frame.
 *
 *   - positions are 12.4 fixed point in pixels (16 = one pixel), velocities in 1/16 pixel a frame
 *   - one tick per 50 Hz frame; input bits: 1 left, 2 right, 4 jump (held)
 *   - levels are blocks of 16x16 pixels; outside the level left and right is solid, below is a pit
 *
 * parse(text) reads a level; player(level) makes a player at its start; tick(level, p, input) moves it
 * one frame; follow(level, p, cam) moves the camera.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXPLAT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUB = 16, BLOCK = 16 * SUB;
  // Feel. Speeds in 1/16 pixel a frame, accelerations in 1/16 pixel a frame a frame.
  const PHYS = {
    width: 12 * SUB, height: 20 * SUB, // the player's box
    accel: 4, airAccel: 3, friction: 6, maxRun: 32, // 2 pixels a frame running
    gravity: 6, maxFall: 72,
    jump: 104, // 3.5 blocks high
    jumpCut: 32, // releasing jump while rising faster than this slows to it
    coyote: 5, // frames after leaving a ledge that a jump still works
    buffer: 6, // frames a jump press waits for the ground
  };
  // The camera keeps the player between these screen x positions (pixels) of a VIEW-wide view.
  const VIEW = 304, DEAD = [112, 176];

  // Level text: one character per 16x16 block, '#' solid, '.' or space empty, 'P' the player's start
  // (standing on the block below). Lines starting with ';' are comments; the first names the level.
  function parse(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const name = (lines.find(l => l.startsWith(';')) || '; level').slice(1).trim();
    const rows = lines.filter(l => !l.startsWith(';') && l.length);
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const solid = new Uint8Array(w * h);
    let start = null;
    rows.forEach((r, y) => {
      for (let x = 0; x < w; x++) {
        const ch = r[x] || '.';
        if (ch === '#') solid[y * w + x] = 1;
        else if (ch === 'P') start = { x, y };
      }
    });
    if (!start) throw new Error('level has no P');
    if (solid.subarray(0, w).some(v => v)) throw new Error('the top row must be empty (block tops are drawn above it)');
    return { name, w, h, solid, start };
  }

  const solidAt = (L, bx, by) => (bx < 0 || bx >= L.w ? 1 : by < 0 || by >= L.h ? 0 : L.solid[by * L.w + bx]);
  // Is any block under the box [x, x + w) x [y, y + h) (12.4) solid?
  function hits(L, x, y, w, h) {
    for (let by = Math.floor(y / BLOCK); by <= Math.floor((y + h - 1) / BLOCK); by++)
      for (let bx = Math.floor(x / BLOCK); bx <= Math.floor((x + w - 1) / BLOCK); bx++) if (solidAt(L, bx, by)) return true;
    return false;
  }

  function player(L) {
    return {
      x: L.start.x * BLOCK + (BLOCK - PHYS.width) / 2, y: (L.start.y + 1) * BLOCK - PHYS.height,
      vx: 0, vy: 0, ground: true, coyote: 0, buffer: 0, held: 0, facing: 1, frame: 0,
    };
  }

  // One frame of movement. Horizontal first, then vertical, each stopped at the block it would enter.
  function tick(L, p, input) {
    const P = PHYS, left = input & 1, right = input & 2, jump = input & 4;
    const acc = p.ground ? P.accel : P.airAccel;
    if (left && !right) { p.vx = Math.max(p.vx - acc, -P.maxRun); p.facing = -1; }
    else if (right && !left) { p.vx = Math.min(p.vx + acc, P.maxRun); p.facing = 1; }
    else if (p.ground) p.vx = p.vx > 0 ? Math.max(0, p.vx - P.friction) : Math.min(0, p.vx + P.friction);
    if (p.vx) {
      const nx = p.x + p.vx;
      if (!hits(L, nx, p.y, P.width, P.height)) p.x = nx;
      else {
        p.x = p.vx > 0 ? Math.floor((nx + P.width) / BLOCK) * BLOCK - P.width : (Math.floor(nx / BLOCK) + 1) * BLOCK;
        p.vx = 0;
      }
    }

    p.buffer = jump && !(p.held & 4) ? P.buffer : Math.max(0, p.buffer - 1);
    p.coyote = p.ground ? P.coyote : Math.max(0, p.coyote - 1);
    if (p.buffer && p.coyote) { p.vy = -P.jump; p.buffer = 0; p.coyote = 0; }
    if (!jump && p.vy < -P.jumpCut) p.vy = -P.jumpCut;
    p.vy = Math.min(p.vy + P.gravity, P.maxFall);
    const ny = p.y + p.vy;
    p.ground = false;
    if (!hits(L, p.x, ny, P.width, P.height)) p.y = ny;
    else if (p.vy > 0) { p.y = Math.floor((ny + P.height) / BLOCK) * BLOCK - P.height; p.vy = 0; p.ground = true; }
    else { p.y = (Math.floor(ny / BLOCK) + 1) * BLOCK; p.vy = 0; }

    if (p.y > L.h * BLOCK + 64 * SUB) Object.assign(p, player(L)); // fell into a pit: start again
    p.held = input;
    p.frame = p.ground ? (p.vx ? (p.frame + 1) & 15 : 0) : p.frame;
    return p;
  }

  // The camera's left edge (whole pixels), following the player within the dead zone.
  function follow(L, p, cam) {
    const px = p.x >> 4, max = L.w * 16 - VIEW;
    if (px - cam > DEAD[1]) cam = px - DEAD[1];
    if (px - cam < DEAD[0]) cam = px - DEAD[0];
    return Math.max(0, Math.min(max, cam));
  }

  return { SUB, BLOCK, PHYS, VIEW, DEAD, parse, solidAt, hits, player, tick, follow };
});
