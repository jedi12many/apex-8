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
 *
 * The game on top (game, play): coins to collect, beetles that walk the ground they stand on (turning at
 * a wall or a ledge's edge) and die when landed on (the player bouncing off them) but send the player
 * back to the start when touched any other way, and a flag at the end. Reaching it wins; the level
 * starts again WIN_FOR ticks later. play(level, g, input) moves the player as tick does, then each
 * beetle (moving, then meeting the player), then the coins and the flag (left to right), and lists
 * what happened in g.events (for the sound): jump, coin, stomp, hurt, fall, win. g.t counts the ticks
 * of a game, which the objects' animations follow.
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
  // The objects: kinds, and their boxes (12.4: width, height; a coin floats in the middle of its block,
  // a beetle and the flag stand on the block below theirs).
  const COIN = 1, BEETLE = 2, FLAG = 3;
  const OBJECT_KINDS = { o: COIN, b: BEETLE, F: FLAG };
  const BOX = { [COIN]: [8 * SUB, 10 * SUB], [BEETLE]: [16 * SUB, 10 * SUB], [FLAG]: [8 * SUB, 21 * SUB] };
  const BEETLE_SPEED = 12;           // 3/4 pixel a frame
  const STOMP = 8 * SUB;             // a landing this far into a beetle's top is a stomp
  const BOUNCE = 64;                 // and bounces the player up this fast
  const DYING = 16, INVULN = 100, WIN_FOR = 200;

  // Level text: one character per 16x16 block, '#' solid, '.' or space empty, 'P' the player's start
  // (standing on the block below), 'o' a coin, 'b' a beetle (standing on the block below), 'F' the
  // flag (on the block below). Lines starting with ';' are comments; the first names the level.
  function parse(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const name = (lines.find(l => l.startsWith(';')) || '; level').slice(1).trim();
    const rows = lines.filter(l => !l.startsWith(';') && l.length);
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const solid = new Uint8Array(w * h);
    let start = null;
    const objects = [];
    rows.forEach((r, y) => {
      for (let x = 0; x < w; x++) {
        const ch = r[x] || '.';
        if (ch === '#') solid[y * w + x] = 1;
        else if (ch === 'P') start = { x, y };
        else if (OBJECT_KINDS[ch]) objects.push({ kind: OBJECT_KINDS[ch], bx: x, by: y });
      }
    });
    if (!start) throw new Error('level has no P');
    objects.sort((a, b) => a.bx - b.bx || a.by - b.by); // left to right, then top to bottom
    if (solid.subarray(0, w).some(v => v)) throw new Error('the top row must be empty (block tops are drawn above it)');
    return { name, w, h, solid, start, objects };
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

  // ------------------------------------------------------------------ the game
  // Each object's box at its start: x, y its top left (12.4).
  function objects(L) {
    return L.objects.map(o => {
      const [w, h] = BOX[o.kind];
      const x = o.bx * BLOCK + (BLOCK - w) / 2, y = o.kind === COIN ? o.by * BLOCK + (BLOCK - h) / 2 : (o.by + 1) * BLOCK - h;
      return { kind: o.kind, x, y, w, h, on: true, vx: o.kind === BEETLE ? -BEETLE_SPEED : 0, dying: 0 };
    });
  }
  // A game: the beetles, and the coins and the flag (left to right), apart.
  function game(L) {
    const all = objects(L);
    return { p: player(L), beetles: all.filter(o => o.kind === BEETLE), items: all.filter(o => o.kind !== BEETLE),
      coins: 0, stomps: 0, falls: 0, invuln: 0, won: 0, t: 0, events: [] };
  }
  const overlap = (a, bx, by, bw, bh) => a.x < bx + bw && bx < a.x + PHYS.width && a.y < by + bh && by < a.y + PHYS.height;

  function play(L, g, input) {
    const p = g.p, events = [];
    g.t = (g.t + 1) & 0xffff;
    if (g.won) {
      if (--g.won === 0) Object.assign(g, game(L));
      g.events = events;
      return g;
    }
    const vy0 = p.vy, y0 = p.y;
    tick(L, p, input);
    if (p.vy === PHYS.gravity - PHYS.jump && vy0 !== p.vy) events.push('jump'); // (a jump: its speed, gravity already on it)
    if (p.y < y0 - 32 * SUB) { events.push('fall'); g.falls++; } // (fell into a pit, and starts again)
    if (g.invuln) g.invuln--;
    for (const o of g.beetles) {
      if (!o.on) continue;
      if (o.dying) { if (--o.dying === 0) o.on = false; continue; }
      // a step, unless a wall is in the way or the ground ends: then it turns
      const nx = o.x + o.vx, front = o.vx < 0 ? nx : nx + o.w - 1, below = Math.floor((o.y + o.h) / BLOCK);
      if (solidAt(L, Math.floor(front / BLOCK), Math.floor(o.y / BLOCK)) || !solidAt(L, Math.floor(front / BLOCK), below)) o.vx = -o.vx;
      else o.x = nx;
      if (!overlap(p, o.x, o.y, o.w, o.h)) continue;
      if (p.vy > 0 && p.y + PHYS.height - o.y < STOMP) { o.dying = DYING; p.vy = -BOUNCE; g.stomps++; events.push('stomp'); }
      else if (!g.invuln) { Object.assign(p, player(L)); g.invuln = INVULN; events.push('hurt'); }
    }
    for (const o of g.items) {
      if (!o.on || !overlap(p, o.x, o.y, o.w, o.h)) continue;
      if (o.kind === COIN) { o.on = false; g.coins++; events.push('coin'); }
      else { g.won = WIN_FOR; events.push('win'); }
    }
    g.events = events;
    return g;
  }

  return { SUB, BLOCK, PHYS, VIEW, DEAD, COIN, BEETLE, FLAG, BOX, BEETLE_SPEED, STOMP, BOUNCE, DYING, INVULN, WIN_FOR,
    parse, solidAt, hits, player, tick, follow, objects, game, play };
});
