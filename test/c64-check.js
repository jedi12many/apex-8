// Checks the 6502 engine against the reference renderer: builds c64/apex.s in test mode at several
// poses along the walk, runs each in VICE and compares every pixel of the frame the C64 drew itself.
// Scripted builds also play the controls (turning, walking, sliding along and into walls) and must
// end on the same frame as the same moves made here.
//
//   node test/c64-check.js <path to VICE folder> [--ntsc]
//
// Needs cc65 (ca65, ld65) on the PATH. Objects are left out; the 6502 engine draws walls only so far.
const fs = require('fs'), os = require('os'), path = require('path');
const { findVice, screenshot, compare } = require('./vice-lib.js');
const APEXSCII = require('../apexscii/apexscii.js');
const APEXRAY = require('../core/raycast.js');
const VIEW = require('../c64/view.js');
const { MOVE_SPEED, HEADING_STEP } = require('../c64/gen.js');
const { map, build } = require('../c64/build.js');
const walk = require('../showcase/walk.js');

const args = process.argv.slice(2);
const viceDir = args.find(a => !a.startsWith('--'));
const ntsc = args.includes('--ntsc');
if (!viceDir) { console.error('usage: node test/c64-check.js <VICE folder> [--ntsc]'); process.exit(2); }

// The engine's controls, tick by tick from the start: turn by HEADING_STEP, or step MOVE_SPEED along
// the heading (backwards negates the step), each axis only if a quarter-tile square stays clear.
function play(script) {
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || map.cells[ty * map.w + tx];
  const clear = (x, y) => [[-64, -64], [64, -64], [-64, 64], [64, 64]].every(([ox, oy]) => !solid((x + ox) >> 8, (y + oy) >> 8));
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
];

const { exe, rom } = findVice(viceDir);
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-c64-'));
const route = walk.path(), dir = path.join(shots, 'build');
const cases = [
  { name: 'start', pose: map.start, prg: () => build(map.start, dir) },
  ...[60, 150, 200, 230, 290, 350, 480, 570, 700, 900].map(k => ({ name: `walk ${k}`, pose: route[k], prg: () => build(route[k], dir) })),
  ...SCRIPTS.map(([name, script]) => ({ name, pose: play(script), prg: () => build(null, dir, { script }) })),
];
let failures = 0;
for (const c of cases) {
  const prg = path.join(shots, `${c.name.replace(/\W+/g, '-')}.prg`), shot = prg.replace(/\.prg$/, '.png');
  fs.writeFileSync(prg, c.prg());
  const want = VIEW.frame({ ...map, objects: [] }, c.pose, 'mc', VIEW.statusLines(map, c.pose));
  const label = c.name.padEnd(14);
  if (!screenshot(exe, prg, shot, { ntsc, cycles: 30000000 })) { console.log(`${label} no screenshot (did VICE start?)`); failures++; continue; }
  const r = compare(shot, want.rgba(rom), want.opts.border, APEXSCII.PALETTE);
  console.log(`${label} ${r.bad ? `${r.bad} pixels differ, first at ${r.first}` : 'all 64000 pixels match'}${r.borderOk ? '' : ' · border colour WRONG'}`);
  if (r.bad || !r.borderOk) failures++;
}
fs.rmSync(shots, { recursive: true, force: true });
console.log(failures ? `FAIL: ${failures} frame(s) differ` : `PASS: the 6502 engine draws every frame exactly like the reference${ntsc ? ' (NTSC)' : ''}`);
process.exitCode = failures ? 1 : 0;
