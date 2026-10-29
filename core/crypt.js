/*
 * APEX Crypt: the reference for a small isometric action game on the dungeon engine (core/iso.js). An
 * investigator with a pistol clears a drowned crypt of the creatures that sleep in it. Integer maths
 * only, so a 6502 port that follows the same steps gets exactly the same game every frame.
 *
 *   - the map is an iso map (core/iso.js) whose floor can also carry creatures: 'd' a drowned one,
 *     's' a spawn
 *   - one tick per 50 Hz frame; input is the joystick's bits: 1 up, 2 down, 4 left, 8 right, 16 fire
 *   - the hero walks as in core/iso.js. Holding fire plants its feet: the joystick then turns it, in
 *     the same 8 directions, and it fires the way it faces. A bullet flies straight until it hits a
 *     wall, a creature, or its range. Up to SLOTS.bullets at a time, one every COOL ticks while fire
 *     is held
 *   - a creature wakes when the hero comes within WAKE of it (each axis), and from then on comes for
 *     the hero, the drowned at a shamble and the spawn in lurches. Touching the hero costs it a heart
 *     (then INVULN ticks of safety); shot, a creature flashes, and after its last hit it dies
 *   - every creature dead wins; no hearts left loses; either shows its message for END_FOR ticks, then
 *     the title. Fire (pressed, not held) on the title starts a game
 *
 * parse(text) reads a map; game(M) makes a game on its title; tick(M, g, input) plays one frame and
 * lists what happened in g.events (for the sound).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./iso.js'));
  else root.APEXCRYPT = factory(root.APEXISO);
})(typeof self !== 'undefined' ? self : this, function (ISO) {
  'use strict';

  const TITLE = 0, PLAY = 1, WIN = 2, OVER = 3;
  const DROWNED = 1, SPAWN = 2;
  const HEARTS = 3, INVULN = 100, END_FOR = 250;
  const SLOTS = { bullets: 3 };
  const COOL = 10;                         // ticks between shots while fire is held
  const BULLET = { speed: 4, life: 24 };   // speed: times the hero's step for the same direction
  const WAKE = 5 * ISO.TILE;
  const HP = [0, 3, 2], SCORE = [0, 100, 50];
  const RADIUS = 64;                       // a creature's square on the floor, as the hero's
  const DYING = 16;
  // How close (each axis, 8.8 tiles) a bullet must come to a creature to hit it, and a creature to
  // the hero to hurt it.
  const HIT = 96, TOUCH = 112;

  function parse(text) {
    const spawns = [];
    const lines = text.replace(/\r/g, '').split('\n');
    let y = 0;
    const plain = lines.map(l => {
      if (l.startsWith(';') || !l.length) return l;
      const row = [...l].map((ch, x) => {
        if (ch === 'd' || ch === 's') { spawns.push({ x, y, kind: ch === 'd' ? DROWNED : SPAWN }); return '.'; }
        return ch;
      }).join('');
      y++;
      return row;
    });
    return Object.assign(ISO.parse(plain.join('\n')), { spawns });
  }

  const centre = t => t * ISO.TILE + ISO.TILE / 2;
  function creatures(M) {
    return M.spawns.map(s => ({ kind: s.kind, x: centre(s.x), y: centre(s.y), hp: HP[s.kind], awake: false,
      t: 0, flash: 0, dying: 0, facing: 1, moving: false }));
  }
  function game(M) {
    return {
      mode: TITLE, t: 0, held: false, end: 0, score: 0, hi: 0, events: [],
      hero: Object.assign(ISO.hero(M), { hearts: HEARTS, invuln: 0, aim: 8, cool: 0 }),
      bullets: Array.from({ length: SLOTS.bullets }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 })),
      creatures: creatures(M),
    };
  }

  // Is a creature's square at (x, y) all on floor?
  function clear(M, x, y) {
    for (const ty of [(y - RADIUS) >> 8, (y + RADIUS - 1) >> 8])
      for (const tx of [(x - RADIUS) >> 8, (x + RADIUS - 1) >> 8]) if (ISO.tileAt(M, tx, ty) !== ISO.FLOOR) return false;
    return true;
  }
  const toward = (from, to, speed) => Math.max(-speed, Math.min(speed, to - from));

  function tick(M, g, input) {
    const h = g.hero;
    g.t = (g.t + 1) & 0xffff;
    g.events = [];
    const firing = !!(input & 16), pressed = firing && !g.held;
    g.held = firing;

    if (g.mode === TITLE) {
      if (pressed) {
        Object.assign(g, { mode: PLAY, score: 0, hero: Object.assign(ISO.hero(M), { hearts: HEARTS, invuln: 0, aim: 8, cool: 0 }), creatures: creatures(M) });
        for (const b of g.bullets) b.on = false;
        g.events.push('start');
      }
      return g;
    }
    if (g.mode !== PLAY) {
      ISO.tick(M, h, 0);
      if (--g.end === 0) { g.mode = TITLE; g.hi = Math.max(g.hi, g.score); }
      return g;
    }

    // the hero walks, or with fire held stands and turns; it fires the way it faces
    ISO.tick(M, h, firing ? 0 : input & 15);
    if (ISO.DIRS[input & 15]) {
      h.aim = input & 15;
      const d = ISO.DIRS[h.aim], sdx = d[0] - d[1];
      if (sdx) h.facing = sdx > 0 ? 1 : -1;
    }
    if (h.invuln) h.invuln--;
    if (h.cool) h.cool--;
    if (firing && !h.cool) {
      const b = g.bullets.find(o => !o.on);
      if (b) {
        const d = ISO.DIRS[h.aim];
        Object.assign(b, { on: true, x: h.x, y: h.y, vx: BULLET.speed * d[0], vy: BULLET.speed * d[1], life: BULLET.life });
        h.cool = COOL;
        g.events.push('shot');
      }
    }

    // the bullets fly until a wall or their range
    for (const b of g.bullets) {
      if (!b.on) continue;
      b.x += b.vx; b.y += b.vy;
      if (--b.life === 0 || ISO.tileAt(M, b.x >> 8, b.y >> 8) !== ISO.FLOOR) b.on = false;
    }

    // the creatures
    for (const c of g.creatures) {
      if (!c.hp && !c.dying) continue;
      c.t = (c.t + 1) & 0xff;
      if (c.flash) c.flash--;
      if (c.dying) { c.dying--; continue; }
      if (!c.awake && Math.abs(h.x - c.x) < WAKE && Math.abs(h.y - c.y) < WAKE) { c.awake = true; c.t = 0; g.events.push('wake'); }
      if (!c.awake) continue;
      const speed = c.kind === DROWNED ? 6 : (c.t & 31) < 8 ? 20 : 0;
      const x0 = c.x, y0 = c.y, dx = toward(c.x, h.x, speed), dy = toward(c.y, h.y, speed);
      if (dx && clear(M, c.x + dx, c.y)) c.x += dx;
      if (dy && clear(M, c.x, c.y + dy)) c.y += dy;
      const sdx = (c.x - x0) - (c.y - y0);
      if (sdx) c.facing = sdx > 0 ? 1 : -1;
      c.moving = c.x !== x0 || c.y !== y0;
    }

    // bullets hit creatures
    for (const b of g.bullets) {
      if (!b.on) continue;
      for (const c of g.creatures) {
        if (!c.hp || Math.abs(b.x - c.x) >= HIT || Math.abs(b.y - c.y) >= HIT) continue;
        b.on = false;
        c.awake = true;
        if (--c.hp) { c.flash = 4; g.events.push('hit'); }
        else { c.dying = DYING; g.score += SCORE[c.kind]; g.events.push('kill'); }
        break;
      }
    }

    // creatures hurt the hero
    if (!h.invuln && g.creatures.some(c => c.hp && Math.abs(h.x - c.x) < TOUCH && Math.abs(h.y - c.y) < TOUCH)) {
      h.invuln = INVULN;
      g.events.push('hurt');
      if (--h.hearts === 0) { g.mode = OVER; g.end = END_FOR; g.events.push('dead'); }
    }
    if (g.mode === PLAY && g.creatures.every(c => !c.hp && !c.dying)) { g.mode = WIN; g.end = END_FOR; g.events.push('win'); }
    return g;
  }

  return { TITLE, PLAY, WIN, OVER, DROWNED, SPAWN, HEARTS, INVULN, END_FOR, SLOTS, COOL, BULLET, WAKE, HP, SCORE,
    RADIUS, DYING, HIT, TOUCH, parse, game, tick };
});
