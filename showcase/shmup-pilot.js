// An autopilot for the shoot-'em-up: hold fire, line up under the nearest enemy, and sidestep bullets
// and flying enemies that would hit within the next few frames. Used by the video (showcase/shmup.js)
// and the C64 test.
//
// inputs(level, n) plays n ticks from the start and returns { inputs, game } after them.
const G = require('../core/shmup.js');

const LOOK = 14, HOME_Y = 150;

// Does a box at (x, y), moving (vx, vy) a frame, come within reach of the ship at (px, py) soon?
function threat(px, py, x, y, box, vx, vy) {
  const wide = [G.BOX.player[0] - 6, G.BOX.player[1] + 6, G.BOX.player[2] - 6, G.BOX.player[3] + 6];
  for (let k = 0; k <= LOOK; k++) {
    const bx = x + vx * k, by = y + vy * k;
    if (px + wide[0] < bx + box[1] && bx + box[0] < px + wide[1] && py + wide[2] < by + box[3] && by + box[2] < py + wide[3]) return true;
  }
  return false;
}

function steer(L, g) {
  const p = g.player;
  if (p.dead) return 16;
  // what is coming: bullets, and the drones and swoopers
  const dangers = [];
  for (const b of g.bullets) if (b.on) dangers.push([b.x >> 4, b.y >> 4, G.BOX.bullet, b.vx / 16, b.vy / 16]);
  for (const e of g.enemies) {
    if (e.kind === G.DRONE) dangers.push([e.x, e.y, G.BOX[G.DRONE], 0, 2]);
    else if (e.kind === G.SWOOPER) dangers.push([e.x, e.y, G.BOX[G.SWOOPER], e.vx, e.vy]);
  }
  const safe = (x, y) => !dangers.some(([dx, dy, box, vx, vy]) => threat(x, y, dx, dy, box, vx, vy));
  // the nearest enemy above the ship
  let target = null;
  for (const e of g.enemies) {
    if (e.kind < G.DRONE || e.kind > G.TURRET || e.y < -10 || e.y > p.y - 24) continue;
    if (!target || e.y > target.y) target = e;
  }
  const wantX = target ? target.x : 148;
  // every move, scored: safety first, then lining up, then height
  let best = 0, score = -Infinity;
  for (const bits of [0, 1, 2, 4, 8, 5, 9, 6, 10]) {
    const d = G.DIRS[bits] || [0, 0];
    const x = Math.max(G.BOUNDS.x0, Math.min(G.BOUNDS.x1, p.x + d[0])), y = Math.max(G.BOUNDS.y0, Math.min(G.BOUNDS.y1, p.y + d[1]));
    let s = safe(x, y) ? 1000 : 0;
    s -= Math.abs(x - wantX) + Math.abs(y - HOME_Y) / 4;
    if (s > score) { score = s; best = bits; }
  }
  return best | 16;
}

function inputs(L, n) {
  const g = G.game(L), list = [];
  for (let k = 0; k < n; k++) {
    const b = steer(L, g);
    list.push(b);
    G.tick(L, g, b);
  }
  return { inputs: list, game: g };
}

module.exports = { inputs, steer };
