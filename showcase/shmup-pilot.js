// An autopilot for the shoot-'em-up: hold fire, line up under the nearest enemy, and sidestep bullets
// and flying enemies that would hit within the next few frames. Used by the video (showcase/shmup.js)
// and the C64 test.
//
// inputs(level, n, wait) plays n ticks from the start (the first `wait` on the title, doing nothing)
// and returns { inputs, game } after them.
// sweep(n): n ticks of flying side to side with fire held, which gets the ship shot down now and then
// (for testing explosions, coming back and blinking).
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

function inputs(L, n, wait = 0) {
  const g = G.game(L), list = [];
  for (let k = 0; k < n; k++) {
    const b = k < wait ? 0 : steer(L, g);
    list.push(b);
    G.tick(L, g, b);
  }
  return { inputs: list, game: g };
}

const SWEEP = [[20, 90], [17, 40], [24, 170], [18, 60], [20, 90], [0, 30], [21, 50], [26, 80]];
function sweep(n) {
  const one = [], out = [];
  for (const [bits, k] of SWEEP) for (let i = 0; i < k; i++) one.push(bits);
  while (out.length < n) out.push(...one);
  return out.slice(0, n);
}

module.exports = { inputs, steer, sweep };
