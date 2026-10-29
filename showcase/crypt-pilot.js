// An autopilot for the Drowned Crypt (core/crypt.js): presses fire on the title, then walks a tour of
// the crypt (with the dungeon autopilot's steering), and whenever a creature is awake nearby or the boss
// is up, stands and shoots at it, aiming the joystick direction nearest the target. It backs away from
// a creature that comes too close, and steps off floor that the boss's tentacle is cracking.
//
// inputs(M, n, title) plays n ticks, the first `title` of them on the title, and returns { inputs, game }.
const ISO = require('../core/iso.js');
const G = require('../core/crypt.js');
const { steer } = require('./iso-pilot.js');

// The rooms in turn: down to the lower rooms, up to the north-east one, back down and south to the
// boss's chamber.
const TOUR = [[8, 7], [8, 12], [6, 15], [10, 15], [15, 15], [20, 15], [21, 12], [21, 8], [21, 5], [24, 4], [21, 9],
  [21, 15], [21, 19], [21, 23], [21, 25]];
const DIRS8 = [1, 2, 4, 8, 5, 9, 6, 10];
const ENGAGE = 5 * ISO.TILE, TOO_CLOSE = 320;

// The joystick direction heading most nearly along (wx, dy), and how nearly (cosine).
function toward(wx, wy) {
  let best = 0, score = -2;
  for (const bits of DIRS8) {
    const [dx, dy] = ISO.DIRS[bits], s = (dx * wx + dy * wy) / Math.hypot(dx, dy) / Math.hypot(wx, wy);
    if (s > score) { score = s; best = bits; }
  }
  return best;
}
// A walkable direction away from (x, y).
function away(M, h, x, y) {
  let best = 0, score = -Infinity;
  for (const bits of DIRS8) {
    const [dx, dy] = ISO.DIRS[bits], s = (dx * (h.x - x) + dy * (h.y - y)) / Math.hypot(dx, dy);
    if (s > score && ISO.clear(M, h.x + 2 * dx, h.y + 2 * dy)) { score = s; best = bits; }
  }
  return best;
}

function decide(M, g, tour) {
  const h = g.hero, B = g.boss;
  if (g.mode !== G.PLAY) return (g.t >> 3) & 1 ? 16 : 0; // tap fire on the title
  const gr = g.grasp;
  if (gr.on && Math.abs(h.x - gr.x) < 360 && Math.abs(h.y - gr.y) < 360) return away(M, h, gr.x, gr.y);
  let target = null, far = Infinity;
  for (const c of g.creatures) {
    if (!c.hp || !c.awake) continue;
    const d = Math.max(Math.abs(c.x - h.x), Math.abs(c.y - h.y));
    if (d < ENGAGE && d < far) { far = d; target = c; }
  }
  if (target && far < TOO_CLOSE) return away(M, h, target.x, target.y);
  if (!target && (B.state === G.RISE || B.state === G.FIGHT)) target = B;
  if (target) return 16 | toward(target.x - h.x, target.y - h.y);
  while (tour.leg < TOUR.length) {
    const s = steer(M, h, TOUR[tour.leg]);
    if (s === null) { tour.leg++; continue; }
    return s;
  }
  return 0;
}

function inputs(M, n, title = 0) {
  const g = G.game(M), list = [], tour = { leg: 0 };
  for (let k = 0; k < n; k++) {
    const b = k < title ? 0 : decide(M, g, tour);
    list.push(b);
    G.tick(M, g, b);
  }
  return { inputs: list, game: g };
}

module.exports = { TOUR, inputs };
