/*
 * The raycaster's game: walking and turning as before, plus a pistol, guards that die when shot and
 * treasure to pick up. Every port follows it tick by tick (50 a second).
 *
 * game(map) starts one; play(map, g, bits, caster) plays one tick with the controls in bits
 * (1 forward, 2 back, 4 turn left, 8 turn right, 16 fire), and lists what happened in g.events (for
 * the sound): shot, die, pickup. caster is the view's raycaster (c64/view.js caster): a shot hits the
 * nearest guard over the middle of the screen, nearer than the wall the middle ray meets.
 *
 * Each tick, in order:
 *   1. the timers: the pistol's cooling and flash; a guard that was shot is gone HIT ticks later
 *   2. turning, then walking: each axis only if the square WALL_RADIUS around the new position is
 *      clear of walls and no barrel or guard is within OBJ_RADIUS on both axes (treasure doesn't block)
 *   3. treasure within PICK_RADIUS on both axes is picked up (TREASURE points)
 *   4. firing, when the pistol is cool: it flashes for FLASH ticks and cools for COOL; a guard it hits
 *      shows white for HIT ticks (GUARD points)
 * The score is shown as 4 decimal digits (it wraps at 10000, as the C64's BCD does).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./raycast.js'));
  else root.APEXRAYGAME = factory(root.APEXRAY);
})(typeof self !== 'undefined' ? self : this, function (APEXRAY) {
  'use strict';

  const MOVE_SPEED = 6;             // 8.8 tiles per tick
  const HEADING_STEP = 4;           // the player's angle is always a multiple of this
  const WALL_RADIUS = 96;           // the player keeps 3/8 of a tile from walls on each axis
  const OBJ_RADIUS = 128;           // and half a tile from a barrel's or guard's centre, on one axis at least
  const PICK_RADIUS = 96;           // treasure this near on both axes is picked up
  const COOL = 16, FLASH = 6, HIT = 12;
  const TREASURE = 100, GUARD = 50;
  const FIRE = 16;
  const HEIGHT = { guard: 218 };    // as c64/sprites.js TYPES (256ths of a wall)

  function game(map) {
    return {
      p: { ...map.start }, objects: (map.objects || []).map(o => ({ ...o, on: true, hit: 0 })),
      score: 0, cool: 0, flash: 0, t: 0, events: [],
    };
  }

  const blocks = o => o.on && o.type !== 'treasure';

  // Is (x, y) a place the player can stand?
  function clear(map, g, x, y) {
    const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || map.cells[ty * map.w + tx];
    const R = WALL_RADIUS, near = d => d >= -OBJ_RADIUS && d < OBJ_RADIUS;
    return [[-R, -R], [R, -R], [-R, R], [R, R]].every(([ox, oy]) => !solid((x + ox) >> 8, (y + oy) >> 8)) &&
      !g.objects.some(o => blocks(o) && near(x - o.x) && near(y - o.y));
  }

  // The guard a shot from p hits: its index, or -1. A guard is over the middle of the screen when its
  // centre is within H / 8 + 4 pixels of the middle (H its height on screen), and must be nearer than
  // the middle ray's wall. The nearest wins; at the same depth, the first in the level.
  function target(map, g, caster) {
    const p = g.p, rays = caster.cast(map, p.x, p.y, p.a), mid = rays[rays.length >> 1].dist;
    const middle = (rays.length >> 1) * 4;
    let best = -1, bestDepth = 0;
    g.objects.forEach((o, i) => {
      if (o.type !== 'guard' || !o.on || o.hit) return;
      const pr = caster.project(p, o.x, o.y);
      if (!pr || pr.depth >= mid) return;
      const x = (pr.col * 4) >> 8, H = (2 * pr.halfH * HEIGHT.guard) >> 8;
      if (Math.abs(x - middle) >= (H >> 3) + 4) return;
      if (best < 0 || pr.depth < bestDepth) { best = i; bestDepth = pr.depth; }
    });
    return best;
  }

  function play(map, g, bits, caster) {
    const p = g.p, events = (g.events = []);
    g.t++;
    if (g.cool) g.cool--;
    if (g.flash) g.flash--;
    for (const o of g.objects) if (o.hit && --o.hit === 0) o.on = false;

    if (bits & 4) p.a = (p.a - HEADING_STEP) & 1023;
    if (bits & 8) p.a = (p.a + HEADING_STEP) & 1023;
    if (bits & 3) {
      const sgn = bits & 2 ? -1 : 1;
      const dx = sgn * ((APEXRAY.cos(p.a) * MOVE_SPEED) >> 8), dy = sgn * ((APEXRAY.sin(p.a) * MOVE_SPEED) >> 8);
      if (clear(map, g, p.x + dx, p.y)) p.x += dx;
      if (clear(map, g, p.x, p.y + dy)) p.y += dy;
    }

    const near = d => d >= -PICK_RADIUS && d < PICK_RADIUS;
    for (const o of g.objects) {
      if (o.type !== 'treasure' || !o.on || !near(p.x - o.x) || !near(p.y - o.y)) continue;
      o.on = false;
      g.score = (g.score + TREASURE) % 10000;
      events.push('pickup');
    }

    if (bits & FIRE && !g.cool) {
      g.cool = COOL;
      g.flash = FLASH;
      events.push('shot');
      const k = target(map, g, caster);
      if (k >= 0) {
        g.objects[k].hit = HIT;
        g.score = (g.score + GUARD) % 10000;
        events.push('die');
      }
    }
    return g;
  }

  // What the view shows of a game: the objects still there (white while a shot guard falls) and
  // whether the pistol is flashing.
  function shown(g) {
    return { objects: g.objects.filter(o => o.on).map(o => (o.hit ? { ...o, color: 1 } : o)), flash: g.flash > 0, score: g.score };
  }

  return { MOVE_SPEED, HEADING_STEP, WALL_RADIUS, OBJ_RADIUS, PICK_RADIUS, COOL, FLASH, HIT, TREASURE, GUARD, FIRE,
    game, play, clear, target, shown };
});
