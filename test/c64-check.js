// Checks the 6502 engine against the reference renderer: builds c64/apex.s in test mode at several
// poses along the walk, runs each in VICE and compares every pixel of the frame the C64 drew itself.
// Scripted builds also play the controls (turning, walking, sliding along and into walls) and must
// end on the same frame as the same moves made here.
//
//   node test/c64-check.js <path to VICE folder> [--ntsc | --model <name>]
//
// Needs cc65 (ca65, ld65) on the PATH.
const path = require('path');
const kit = require('./kit.js');
const APEXRAY = require('../core/raycast.js');
const VIEW = require('../c64/view.js');
const { MOVE_SPEED, HEADING_STEP, WALL_RADIUS, OBJ_RADIUS } = require('../c64/gen.js');
const { map, build } = require('../c64/build.js');
const walk = require('../showcase/walk.js');

const o = kit.options('node test/c64-check.js');

// The engine's controls, tick by tick from the start: turn by HEADING_STEP, or step MOVE_SPEED along
// the heading (backwards negates the step), each axis only if the square WALL_RADIUS around the
// new position is clear of walls and no object is within OBJ_RADIUS on both axes.
function play(script) {
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || map.cells[ty * map.w + tx];
  const R = WALL_RADIUS, near = d => d >= -OBJ_RADIUS && d < OBJ_RADIUS;
  const clear = (x, y) => [[-R, -R], [R, -R], [-R, R], [R, R]].every(([ox, oy]) => !solid((x + ox) >> 8, (y + oy) >> 8)) &&
    !(map.objects || []).some(o => near(x - o.x) && near(y - o.y));
  const p = { ...map.start };
  for (const [bits, n] of script) for (let k = 0; k < n; k++) {
    if (bits & 4) p.a = (p.a - HEADING_STEP) & 1023;
    if (bits & 8) p.a = (p.a + HEADING_STEP) & 1023;
    if (bits & 3) {
      const sgn = bits & 2 ? -1 : 1;
      const dx = sgn * ((APEXRAY.cos(p.a) * MOVE_SPEED) >> 8), dy = sgn * ((APEXRAY.sin(p.a) * MOVE_SPEED) >> 8);
      if (clear(p.x + dx, p.y)) p.x += dx;
      if (clear(p.x, p.y + dy)) p.y += dy;
    }
  }
  return p;
}
const SCRIPTS = [
  ['turn and walk', [[8, 32], [1, 120], [4, 64], [1, 90]]],
  ['into a wall', [[1, 200], [8, 20], [1, 150], [2, 40]]],
  ['into a guard', [[8, 32], [1, 150]]],
];

const route = walk.path(), dir = path.join(o.scratch, 'build');
const frameCase = (name, pose, prg) => ({
  name, cycles: 30000000, prg,
  want: () => { const f = VIEW.frame(map, pose, 'mc', VIEW.statusLines(map, pose)); return f.rgba(o.rom, true); },
});
const cases = [
  frameCase('start', map.start, () => build(map.start, dir)),
  ...[60, 150, 200, 230, 290, 350, 480, 570, 700, 900].map(k => frameCase(`walk ${k}`, route[k], () => build(route[k], dir))),
  ...SCRIPTS.map(([name, script]) => frameCase(name, play(script), () => build(null, dir, { script }))),
];

(async () => {
  const border = VIEW.frame(map, map.start, 'mc', VIEW.statusLines(map, map.start)).opts.border;
  const failures = await kit.checkFrames(o, cases, { border, width: 14 });
  kit.finish(o, failures, 'the 6502 raycaster draws every frame exactly like the reference');
})().catch(e => { console.error(e.message); process.exit(1); });
