// Checks the C64 platformer against the reference: the autopilot (showcase/side-pilot.js) plays the
// level for a number of ticks in a test build, VICE runs it, and every pixel of the frame the C64
// shows must match the reference's frame after the same ticks. Some stops are chosen where the
// player's sprite crosses a raster split, so the splits' timing is checked with the sprite's DMA.
// Then the whole run plays once more to count frames the engine was too late for.
//
//   node test/side-check.js <path to VICE folder> [--ntsc | --model <name>] [--quick | --timing]
//
// --quick checks four frames and skips the timing run; --timing runs only the timing. Needs cc65
// (ca65, ld65) on the PATH.
const path = require('path');
const kit = require('./kit.js');
const VIEW = require('../c64/side/view.js');
const { level, build, runs } = require('../c64/side/build.js');
const pilot = require('../showcase/side-pilot.js');

const o = kit.options('node test/side-check.js');
const map = VIEW.compose(level), RUN = 1300;
const all = pilot.inputs(level, RUN).inputs;
// Ticks where the sprite's rows cover the line before a split (its DMA then lands in the split's
// write window): the first of each.
const spriteRows = n => { const { p } = pilot.inputs(level, n), top = VIEW.TOP + (p.y >> 4) - 1; return [top, top + 20]; };
const splitLines = [VIEW.ROWS.hills[0] * 8 - 1, VIEW.TOP - 1, VIEW.LEVEL_SKY - 1];
const crossing = splitLines.map(line => {
  for (let n = 1; n < RUN; n++) { const [a, b] = spriteRows(n); if (a <= line && b >= line) return n; }
  return null;
}).filter(n => n !== null);
const stops = o.quick ? [0, 200, 650, RUN] : [...new Set([0, 1, 30, 100, 200, 333, 450, 520, 650, 777, 900, 1000, 1111, 1200, RUN, ...crossing])].sort((a, b) => a - b);

const cases = stops.map(n => ({
  name: `tick ${n}${crossing.includes(n) ? ' (sprite on a split)' : ''}`, ticks: n,
  prg: () => build(path.join(o.scratch, `b${n}`), { script: runs(all.slice(0, n)) }),
  want: () => { const { p, cam } = pilot.inputs(level, n); return VIEW.frame(level, map, p, cam).pixels; },
}));
const timing = [{
  name: 'run', ticks: RUN,
  build: () => { const dir = path.join(o.scratch, 'timing'); build(dir, { script: runs(all) }); return { prg: path.join(dir, 'side.prg'), lbl: path.join(dir, 'side.lbl') }; },
}];

(async () => {
  let failures = await kit.checkFrames(o, cases, { border: VIEW.BORDER, width: 30 });
  failures += await kit.checkTiming(o, timing);
  kit.finish(o, failures, 'the C64 platformer shows every frame exactly like the reference, with no late frames');
})().catch(e => { console.error(e.message); process.exit(1); });
