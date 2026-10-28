/*
 * APEX shoot-'em-up: the reference for vertical-scrolling levels, the ship, its shots, the enemies and
 * their bullets. Integer maths only, and every list is fixed slots taken lowest first, so a 6502 port
 * that follows the same steps reaches exactly the same state every frame.
 *
 *   - the level is a column of 16x16 pixel tiles, 20 across (the 320 pixel screen), read bottom to
 *     top: it scrolls down the screen 1 pixel a frame and wraps round at its top
 *   - positions are whole screen pixels, of each sprite's top-left corner; bullets are 1/16 pixel
 *   - one tick per 50 Hz frame; input is the joystick's bits: 1 up, 2 down, 4 left, 8 right, 16 fire
 *   - enemies: drones that snake down in columns of four, swoopers that dive, fire once and turn back,
 *     and ground turrets that ride the scrolling hull and fire aimed bullets (every 64 ticks, staggered
 *     by their slot)
 *   - a game: the title (the level scrolls by; fire, pressed from released, starts), play with 3
 *     ships, and game over (OVER_FOR ticks, then the title again). The level never stops scrolling,
 *     and a game starts wherever it is
 *   - each tick lists what it heard in g.events, in order: 'shot', 'enemyFire', 'hit' (a turret
 *     damaged), 'explode', 'death'; the sound plays them (sound/shmup.js)
 *
 * parse(text) reads a level; game(level) makes a game at its title; tick(level, g, input) plays one
 * frame.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXSHMUP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 16, WIDTH = 20, SCREEN_H = 200;
  // Tiles: space, and the dreadnought's hull: a plate, a vent, a lamp, a turret's base, a dome (2x2
  // tiles), a raised block of superstructure, pipes along and across, hazard stripes.
  const SPACE = 0, PLATE = 1, VENT = 2, LAMP = 3, BASE = 4, DOME = 5, BLOCK = 6, PIPE_V = 7, PIPE_H = 8, HAZARD = 9;
  // Enemy slots' kinds.
  const FREE = 0, DRONE = 1, SWOOPER = 2, TURRET = 3, BOOM = 4;
  // The game's modes.
  const TITLE = 0, PLAY = 1, OVER = 2;
  const LIVES = 3, OVER_FOR = 250;
  const SLOTS = { shots: 3, enemies: 12, bullets: 6 };

  // The ship: 2 pixels a frame in the 8 directions (by the joystick's bits), kept inside BOUNDS.
  const SPEED = 2;
  const DIRS = [];
  DIRS[1] = [0, -SPEED]; DIRS[2] = [0, SPEED]; DIRS[4] = [-SPEED, 0]; DIRS[8] = [SPEED, 0];
  DIRS[5] = [-SPEED, -SPEED]; DIRS[9] = [SPEED, -SPEED]; DIRS[6] = [-SPEED, SPEED]; DIRS[10] = [SPEED, SPEED];
  const BOUNDS = { x0: 8, x1: 288, y0: 24, y1: 172 };
  const START = { x: 148, y: 160 };
  const SHOT = { speed: 6, cool: 8 }; // a twin shot every 8 frames at most, 6 pixels a frame
  const DEAD_FOR = 64, INVULN = 120; // frames dead (the first 16 exploding), then frames untouchable
  const SCORE = [0, 10, 20, 50];
  const HP = [0, 1, 1, 3];

  // Hit boxes from each sprite's top-left: [x0, x1, y0, y1), half open.
  const BOX = {
    player: [8, 16, 6, 16], shot: [4, 20, 0, 6], bullet: [0, 6, 0, 4],
    [DRONE]: [0, 24, 0, 9], [SWOOPER]: [2, 22, 0, 11], [TURRET]: [4, 20, 2, 11],
  };
  const hits = (ax, ay, a, bx, by, b) => ax + a[0] < bx + b[1] && bx + b[0] < ax + a[1] && ay + a[2] < by + b[3] && by + b[2] < ay + a[3];

  // A drone's sway across its column: 64 steps of a sine, 24 pixels each way.
  const SWAY = Array.from({ length: 64 }, (_, i) => Math.round(24 * Math.sin((2 * Math.PI * i) / 64)));
  // Bullets' velocities in 16 directions, clockwise from right, in 1/16 pixel a frame (2.25 pixels).
  const AIM = Array.from({ length: 16 }, (_, i) => [Math.round(36 * Math.cos((Math.PI * i) / 8)), Math.round(36 * Math.sin((Math.PI * i) / 8))]);
  // The direction (0-15) nearest to (dx, dy), by comparing |dy| with |dx| at tan 11.25, 33.75, 56.25 and
  // 78.75 degrees (about 1/5, 2/3, 3/2 and 5). Halved first, so both fit a byte.
  function aim(dx, dy) {
    const ax = Math.abs(dx) >> 1, ay = Math.abs(dy) >> 1;
    const q = 5 * ay < ax ? 0 : 3 * ay < 2 * ax ? 1 : 2 * ay < 3 * ax ? 2 : ay < 5 * ax ? 3 : 4;
    const d = dx >= 0 ? (dy >= 0 ? q : 16 - q) : dy >= 0 ? 8 - q : 8 + q;
    return d & 15;
  }

  // Level text: 20 characters a row, the first row the level's end. ' ' space, '#' plate, '=' vent,
  // 'o' lamp, 'O' dome (in 2x2 blocks), 'H' superstructure, '|' and '-' pipes, '/' hazard stripes, 'T' a
  // turret on its base; 'd' a column of drones and 's' a swooper, entering from the top
  // over space ('D', 'S' over plate). Lines starting with ';' are comments; the first names the level.
  function parse(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const name = (lines.find(l => l.startsWith(';')) || '; level').slice(1).trim();
    const rows = lines.filter(l => !l.startsWith(';') && l.length);
    const h = rows.length, tiles = new Uint8Array(WIDTH * h), spawns = [];
    rows.forEach((r, ty) => {
      if (r.length > WIDTH) throw new Error(`row ${ty} is wider than ${WIDTH}`);
      for (let tx = 0; tx < WIDTH; tx++) {
        const ch = r[tx] || ' ';
        tiles[ty * WIDTH + tx] = { '#': PLATE, D: PLATE, S: PLATE, '=': VENT, o: LAMP, T: BASE, O: DOME, H: BLOCK, '|': PIPE_V, '-': PIPE_H, '/': HAZARD }[ch] || SPACE;
        const kind = { d: DRONE, D: DRONE, s: SWOOPER, S: SWOOPER, T: TURRET }[ch];
        if (kind) spawns.push({ tx, ty, kind });
      }
    });
    const byRow = Array.from({ length: h }, () => []);
    for (const s of spawns) byRow[s.ty].push(s);
    return { name, w: WIDTH, h, px: h * TILE, tiles, spawns: byRow };
  }
  const tileAt = (L, tx, ty) => (tx < 0 || tx >= WIDTH ? SPACE : L.tiles[(((ty % L.h) + L.h) % L.h) * WIDTH + tx]);

  function game(L) {
    return {
      camY: L.px - SCREEN_H, // the level line at the top of the screen
      t: 0,
      mode: TITLE, lives: 0, over: 0, held: false, hi: 0, events: [],
      player: { x: START.x, y: START.y, dead: 1, invuln: 0, cool: 0 }, // (dead: not in play)
      shots: Array.from({ length: SLOTS.shots }, () => ({ on: false, x: 0, y: 0 })),
      enemies: Array.from({ length: SLOTS.enemies }, () => ({ kind: FREE, x: 0, y: 0, bx: 0, vx: 0, vy: 0, t: 0, hp: 0, flash: 0, ground: false, phase: 0 })),
      bullets: Array.from({ length: SLOTS.bullets }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0 })),
      score: 0, deaths: 0,
    };
  }
  const free = list => list.find(o => !(o.on || o.kind));

  function fire(g, e) {
    const b = g.bullets.find(o => !o.on), p = g.player;
    if (!b || p.dead) return;
    const bx = e.x + 9, by = e.y + 7;
    const [vx, vy] = AIM[aim(p.x + 12 - (bx + 3), p.y + 11 - (by + 2))];
    Object.assign(b, { on: true, x: bx << 4, y: by << 4, vx, vy });
    g.events.push('enemyFire');
  }
  function explode(g, e) {
    Object.assign(e, { kind: BOOM, t: 0, flash: 0 });
    g.events.push('explode');
  }

  function tick(L, g, input) {
    const p = g.player;
    g.t = (g.t + 1) & 0xffff;
    g.events = [];

    // the game: fire starts one from the title; game over ends in the title
    const firing = !!(input & 16), pressed = firing && !g.held;
    g.held = firing;
    if (g.mode === TITLE && pressed) {
      Object.assign(g, { mode: PLAY, score: 0, lives: LIVES });
      Object.assign(p, { x: START.x, y: START.y, dead: 0, invuln: 0, cool: 0 });
      for (const o of [...g.shots, ...g.bullets]) o.on = false;
      for (const e of g.enemies) e.kind = FREE;
    } else if (g.mode === OVER && --g.over === 0) {
      g.mode = TITLE;
      g.hi = Math.max(g.hi, g.score);
    }

    // the ship, and its shots
    if (p.dead) {
      if (g.mode !== PLAY) { if (p.dead > 1) p.dead--; } // (it stays gone)
      else if (--p.dead === 0) Object.assign(p, { x: START.x, y: START.y, invuln: INVULN, cool: 0 });
    } else {
      const d = DIRS[input & 15];
      if (d) {
        p.x = Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, p.x + d[0]));
        p.y = Math.max(BOUNDS.y0, Math.min(BOUNDS.y1, p.y + d[1]));
      }
      if (p.invuln) p.invuln--;
    }
    for (const s of g.shots) if (s.on && (s.y -= SHOT.speed) <= -6) s.on = false;
    if (p.cool) p.cool--;
    if (!p.dead && input & 16 && !p.cool) {
      const s = g.shots.find(o => !o.on);
      if (s) { Object.assign(s, { on: true, x: p.x, y: p.y - 8 }); p.cool = SHOT.cool; g.events.push('shot'); }
    }

    // the enemies
    for (let k = 0; k < g.enemies.length; k++) {
      const e = g.enemies[k];
      if (!e.kind) continue;
      e.t++;
      switch (e.kind) {
        case DRONE:
          e.y += 2;
          e.x = e.bx + SWAY[(e.t + e.phase) & 63];
          if (e.y >= SCREEN_H) e.kind = FREE;
          break;
        case SWOOPER:
          if (e.t === 20) fire(g, e);
          if (e.t === 36) { e.vx = e.x + 12 < 160 ? -2 : 2; }
          if (e.t >= 36 && (e.t - 36) % 6 === 0 && e.vy > -3) e.vy--;
          e.x += e.vx; e.y += e.vy;
          if (e.y < -21 || e.y >= SCREEN_H || e.x <= -24 || e.x >= 320) e.kind = FREE;
          break;
        case TURRET:
          e.y++;
          if (e.flash) e.flash--;
          // every 64 ticks, each slot 8 ticks after the one before, so turrets that arrive together
          // don't fire together
          if (((e.t + 8 * k) & 63) === 31 && e.y >= 0 && e.y < 140) fire(g, e);
          if (e.y >= SCREEN_H) e.kind = FREE;
          break;
        case BOOM:
          if (e.ground) e.y++;
          if (e.t >= 16) e.kind = FREE;
          break;
      }
    }
    for (const b of g.bullets) {
      if (!b.on) continue;
      b.x += b.vx; b.y += b.vy;
      const x = b.x >> 4, y = b.y >> 4;
      if (x <= -6 || x >= 320 || y <= -6 || y >= SCREEN_H) b.on = false;
    }

    // the level scrolls on a line, and in play the tile row now wholly above the screen's top lets in
    // its spawns
    g.camY = (g.camY + L.px - 1) % L.px;
    if (g.mode === PLAY && (g.camY & 15) === 15) {
      for (const s of L.spawns[g.camY >> 4]) {
        if (s.kind === DRONE) {
          for (let k = 0; k < 4; k++) {
            const e = free(g.enemies);
            if (!e) break;
            Object.assign(e, { kind: DRONE, bx: s.tx * TILE - 4, x: s.tx * TILE - 4, y: -21 - 24 * k, vx: 0, vy: 0, t: 0, hp: HP[DRONE], flash: 0, ground: false, phase: 8 * k });
          }
          continue;
        }
        const e = free(g.enemies);
        if (!e) continue;
        Object.assign(e, { kind: s.kind, bx: 0, x: s.tx * TILE - 4, vx: 0, t: 0, hp: HP[s.kind], flash: 0, phase: 0 });
        if (s.kind === SWOOPER) Object.assign(e, { y: -21, vy: 3, ground: false });
        else Object.assign(e, { y: -17, vy: 0, ground: true });
      }
    }

    // shots hit enemies
    for (const s of g.shots) {
      if (!s.on) continue;
      for (const e of g.enemies) {
        if (e.kind < DRONE || e.kind > TURRET || e.y <= -21 || !hits(s.x, s.y, BOX.shot, e.x, e.y, BOX[e.kind])) continue;
        s.on = false;
        if (--e.hp) { e.flash = 3; g.events.push('hit'); }
        else { g.score += SCORE[e.kind]; explode(g, e); }
        break;
      }
    }
    // the ship is hit by a bullet or a flying enemy
    if (!p.dead && !p.invuln) {
      let hit = false;
      for (const b of g.bullets) if (b.on && hits(p.x, p.y, BOX.player, b.x >> 4, b.y >> 4, BOX.bullet)) { b.on = false; hit = true; }
      for (const e of g.enemies) if ((e.kind === DRONE || e.kind === SWOOPER) && hits(p.x, p.y, BOX.player, e.x, e.y, BOX[e.kind])) { explode(g, e); hit = true; }
      if (hit) {
        p.dead = DEAD_FOR; g.deaths++;
        g.events.push('death');
        if (--g.lives === 0) { g.mode = OVER; g.over = OVER_FOR; }
      }
    }
    return g;
  }

  return { TILE, WIDTH, SCREEN_H, SPACE, PLATE, VENT, LAMP, BASE, DOME, BLOCK, PIPE_V, PIPE_H, HAZARD, FREE, DRONE, SWOOPER, TURRET, BOOM, SLOTS,
    TITLE, PLAY, OVER, LIVES, OVER_FOR, DIRS, BOUNDS, START, SHOT, DEAD_FOR, INVULN, SCORE, HP, BOX, SWAY, AIM, aim, parse, tileAt, game, tick };
});
