// An autopilot for the isometric dungeon: walk a tour of tiles, each reached along the shortest path
// over floor, steering with the joystick direction that heads most nearly to the next tile's centre.
// Used by the video (showcase/iso.js) and the C64 test.
//
// inputs(map, tour, n) plays n ticks from the start and returns { inputs, hero } after them.
const ISO = require('../core/iso.js');

// The next tile on the shortest 4-way path over floor from (sx, sy) to (gx, gy).
function nextTile(M, sx, sy, gx, gy) {
  const prev = new Map(), key = (x, y) => y * M.w + x, queue = [[gx, gy]];
  prev.set(key(gx, gy), null);
  while (queue.length) {
    const [x, y] = queue.shift();
    if (x === sx && y === sy) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (ISO.tileAt(M, nx, ny) !== ISO.FLOOR || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), [x, y]);
      queue.push([nx, ny]);
    }
  }
  return prev.get(key(sx, sy)) || [gx, gy];
}

function steer(M, h, goal) {
  const tx = h.x >> 8, ty = h.y >> 8;
  if (tx === goal[0] && ty === goal[1]) return null;
  // aim at the next tile's centre, or past it along the path once inside the corridor's middle
  const [nx, ny] = nextTile(M, tx, ty, goal[0], goal[1]);
  const wx = nx * 256 + 128 - h.x, wy = ny * 256 + 128 - h.y;
  let best = 0, score = -Infinity;
  for (const bits of [1, 2, 4, 8, 5, 9, 6, 10]) {
    const [dx, dy] = ISO.DIRS[bits], s = (dx * wx + dy * wy) / Math.hypot(dx, dy);
    if (s > score && ISO.clear(M, h.x + dx, h.y + dy)) { score = s; best = bits; }
  }
  return best;
}

function inputs(M, tour, n) {
  const h = ISO.hero(M), list = [];
  let leg = 0;
  for (let k = 0; k < n; k++) {
    let b = 0;
    while (leg < tour.length) {
      const s = steer(M, h, tour[leg]);
      if (s === null) { leg++; continue; }
      b = s;
      break;
    }
    list.push(b);
    ISO.tick(M, h, b);
  }
  return { inputs: list, hero: h };
}

// A tour of the Crypt (levels/iso/d1.txt): its rooms, clockwise from the start.
const CRYPT_TOUR = [[23, 6], [38, 9], [39, 22], [23, 21], [38, 38], [23, 36], [9, 37], [8, 21], [8, 7]];

module.exports = { inputs, steer, CRYPT_TOUR };
