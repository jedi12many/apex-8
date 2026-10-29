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
 *   - the boss, the Mother of the Deep ('B' on the map), sleeps under the floor. When the hero comes
 *     within BOSS.wake it rises out of it (BOSS.rise ticks), then never moves but blocks the way, and
 *     attacks: every BOSS.spitEvery ticks its maw gapes (BOSS.openFor ticks) and it spits a glob
 *     straight at the hero (one of 16 directions, AIM); and every BOSS.graspEvery ticks the floor
 *     cracks where the hero stands, and after BOSS.warn ticks a tentacle bursts up there for
 *     BOSS.strike ticks. Shot BOSS.hp times (once risen) it sinks back into its pit
 *   - every creature and the boss dead wins; no hearts left loses; either shows its message for END_FOR ticks, then
 *     the title. Fire (pressed, not held) on the title starts a game
 *
 * parse(text) reads a map; game(M) makes a game on its title; tick(M, g, input) plays one frame and
 * lists what happened in g.events (for the sound); music(g) is whether the music plays: not while the
 * boss is up.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./iso.js'));
  else root.APEXCRYPT = factory(root.APEXISO);
})(typeof self !== 'undefined' ? self : this, function (ISO) {
  'use strict';

  const TITLE = 0, PLAY = 1, WIN = 2, OVER = 3;
  const DROWNED = 1, SPAWN = 2;
  const HEARTS = 3, INVULN = 100, END_FOR = 250;
  const SLOTS = { bullets: 3, spits: 2 };
  const COOL = 10;                         // ticks between shots while fire is held
  const BULLET = { speed: 4, life: 24 };   // speed: times the hero's step for the same direction
  const WAKE = 5 * ISO.TILE;
  const HP = [0, 3, 2], SCORE = [0, 100, 50];
  const RADIUS = 64;                       // a creature's square on the floor, as the hero's
  const DYING = 16;
  // How close (each axis, 8.8 tiles) a bullet must come to a creature to hit it, and a creature to
  // the hero to hurt it.
  const HIT = 96, TOUCH = 112;
  // The boss. Its states: asleep, rising, fighting, sinking, gone.
  const SLEEP = 0, RISE = 1, FIGHT = 2, SINK = 3, GONE = 4;
  const BOSS = {
    wake: 4 * ISO.TILE, rise: 64, sink: 64, hp: 24, score: 1000,
    block: 176,                            // the hero can't come closer than this (each axis)
    hit: 208,                              // a bullet this close (each axis) hits it
    spitEvery: 72, openFor: 16, spit: { speed: 40, life: 90, hit: 80 },
    graspEvery: 96, warn: 32, strike: 24, grasp: 112,
    moanEvery: 150, moanAt: 110,           // a moan (for the sound) every moanEvery ticks, at moanAt
  };
  // AIM[d]: a step of the spit's speed in each of 16 directions, d 0 = +x, counting toward +y.
  const AIM = Array.from({ length: 16 }, (_, d) => [Math.round(Math.cos(d * Math.PI / 8) * BOSS.spit.speed),
    Math.round(Math.sin(d * Math.PI / 8) * BOSS.spit.speed)]);
  // The direction from (dx, dy) as 0-15, by comparing |dy| with |dx| at the sectors' bounding slopes
  // (about 1/5, 2/3, 3/2 and 5).
  function aim(dx, dy) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const k = 5 * ay <= ax ? 0 : 3 * ay <= 2 * ax ? 1 : 2 * ay <= 3 * ax ? 2 : ay <= 5 * ax ? 3 : 4;
    return (dx >= 0 ? (dy >= 0 ? k : 16 - k) : (dy >= 0 ? 8 - k : 8 + k)) & 15;
  }

  function parse(text) {
    const spawns = [];
    let boss = null;
    const lines = text.replace(/\r/g, '').split('\n');
    let y = 0;
    const plain = lines.map(l => {
      if (l.startsWith(';') || !l.length) return l;
      const row = [...l].map((ch, x) => {
        if (ch === 'd' || ch === 's') { spawns.push({ x, y, kind: ch === 'd' ? DROWNED : SPAWN }); return '.'; }
        if (ch === 'B') { boss = { x, y }; return '.'; }
        return ch;
      }).join('');
      y++;
      return row;
    });
    return Object.assign(ISO.parse(plain.join('\n')), { spawns, boss });
  }

  const centre = t => t * ISO.TILE + ISO.TILE / 2;
  function creatures(M) {
    return M.spawns.map(s => ({ kind: s.kind, x: centre(s.x), y: centre(s.y), hp: HP[s.kind], awake: false,
      t: 0, flash: 0, dying: 0, facing: 1, moving: false }));
  }
  function bossOf(M) {
    return M.boss ? { state: SLEEP, x: centre(M.boss.x), y: centre(M.boss.y), t: 0, hp: BOSS.hp, flash: 0 } : { state: GONE, t: 0 };
  }
  function game(M) {
    return {
      mode: TITLE, t: 0, held: false, end: 0, score: 0, hi: 0, events: [],
      hero: Object.assign(ISO.hero(M), { hearts: HEARTS, invuln: 0, aim: 8, cool: 0 }),
      bullets: Array.from({ length: SLOTS.bullets }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 })),
      creatures: creatures(M),
      boss: bossOf(M),
      spits: Array.from({ length: SLOTS.spits }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 })),
      grasp: { on: false, x: 0, y: 0, t: 0 },
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
        Object.assign(g, { mode: PLAY, score: 0, hero: Object.assign(ISO.hero(M), { hearts: HEARTS, invuln: 0, aim: 8, cool: 0 }), creatures: creatures(M), boss: bossOf(M) });
        for (const b of [...g.bullets, ...g.spits]) b.on = false;
        g.grasp.on = false;
        g.events.push('start');
      }
      return g;
    }
    if (g.mode !== PLAY) {
      ISO.tick(M, h, 0);
      if (--g.end === 0) { g.mode = TITLE; g.hi = Math.max(g.hi, g.score); }
      return g;
    }

    // the hero walks, or with fire held stands and turns; it fires the way it faces. The risen boss
    // is in the way.
    const B = g.boss, hx = h.x, hy = h.y;
    ISO.tick(M, h, firing ? 0 : input & 15);
    if (B.state !== SLEEP && B.state !== GONE && Math.abs(h.x - B.x) < BOSS.block && Math.abs(h.y - B.y) < BOSS.block) { h.x = hx; h.y = hy; }
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

    // the boss
    if (B.state !== GONE) {
      B.t++;
      if (B.flash) B.flash--;
      if (B.state === SLEEP) {
        B.t = 0;
        if (Math.abs(h.x - B.x) < BOSS.wake && Math.abs(h.y - B.y) < BOSS.wake) { B.state = RISE; g.events.push('rise'); }
      } else if (B.state === RISE && B.t === BOSS.rise) { B.state = FIGHT; B.t = 0; }
      else if (B.state === SINK && B.t === BOSS.sink) B.state = GONE;
      else if (B.state === FIGHT) {
        if (B.t % BOSS.spitEvery === 0) {
          const sp = g.spits.find(o => !o.on);
          if (sp) {
            const [vx, vy] = AIM[aim(h.x - B.x, h.y - B.y)];
            Object.assign(sp, { on: true, x: B.x, y: B.y, vx, vy, life: BOSS.spit.life });
            g.events.push('spit');
          }
        }
        if (B.t % BOSS.moanEvery === BOSS.moanAt) g.events.push('moan');
        if (B.t % BOSS.graspEvery === BOSS.graspEvery / 2 && !g.grasp.on) {
          Object.assign(g.grasp, { on: true, x: h.x, y: h.y, t: 0 });
          g.events.push('crack');
        }
      }
    }
    // its spit flies until a wall or its range; its tentacle cracks the floor, then strikes
    for (const sp of g.spits) {
      if (!sp.on) continue;
      sp.x += sp.vx; sp.y += sp.vy;
      if (--sp.life === 0 || ISO.tileAt(M, sp.x >> 8, sp.y >> 8) !== ISO.FLOOR) sp.on = false;
    }
    const gr = g.grasp;
    if (gr.on) {
      if (++gr.t === BOSS.warn) g.events.push('grasp');
      if (gr.t === BOSS.warn + BOSS.strike || B.state !== FIGHT) gr.on = false;
    }

    // bullets hit the boss, once risen
    for (const b of g.bullets) {
      if (!b.on || B.state !== FIGHT || Math.abs(b.x - B.x) >= BOSS.hit || Math.abs(b.y - B.y) >= BOSS.hit) continue;
      b.on = false;
      if (--B.hp) { B.flash = 4; g.events.push('hit'); }
      else { B.state = SINK; B.t = 0; g.score += BOSS.score; g.events.push('bossDies'); }
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

    // creatures, spit and the tentacle hurt the hero
    let hurt = g.creatures.some(c => c.hp && Math.abs(h.x - c.x) < TOUCH && Math.abs(h.y - c.y) < TOUCH);
    for (const sp of g.spits) if (sp.on && Math.abs(h.x - sp.x) < BOSS.spit.hit && Math.abs(h.y - sp.y) < BOSS.spit.hit) { sp.on = false; hurt = true; }
    if (gr.on && gr.t >= BOSS.warn && Math.abs(h.x - gr.x) < BOSS.grasp && Math.abs(h.y - gr.y) < BOSS.grasp) hurt = true;
    if (!h.invuln && hurt) {
      h.invuln = INVULN;
      g.events.push('hurt');
      if (--h.hearts === 0) { g.mode = OVER; g.end = END_FOR; g.events.push('dead'); }
    }
    if (g.mode === PLAY && g.creatures.every(c => !c.hp && !c.dying) && B.state === GONE) { g.mode = WIN; g.end = END_FOR; g.events.push('win'); }
    return g;
  }

  const music = g => g.boss.state === SLEEP || g.boss.state === GONE;

  return { music, TITLE, PLAY, WIN, OVER, DROWNED, SPAWN, HEARTS, INVULN, END_FOR, SLOTS, COOL, BULLET, WAKE, HP, SCORE,
    RADIUS, DYING, HIT, TOUCH, SLEEP, RISE, FIGHT, SINK, GONE, BOSS, AIM, aim, parse, game, tick };
});
