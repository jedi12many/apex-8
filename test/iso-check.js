// Checks the C64 dungeon against the reference: the autopilot tour (showcase/iso-pilot.js) and a walk
// in all eight directions play in test builds, VICE runs them, and every pixel of the frame the C64
// shows must match the reference's frame after the same ticks. Then the whole tour and walk play once
// more to count frames the engine was too late for.
//
//   node test/iso-check.js <path to VICE folder> [--ntsc | --model <name>] [--quick | --timing]
//
// --quick checks four frames and skips the timing runs; --timing runs only the timing. Needs cc65
// (ca65, ld65) on the PATH.
const path = require('path');
const kit = require('./kit.js');
const ISO = require('../core/iso.js');
const VIEW = require('../c64/iso/view.js');
const { map, build, runs } = require('../c64/iso/build.js');
const pilot = require('../showcase/iso-pilot.js');

const o = kit.options('node test/iso-check.js');
const TOUR = 1800, tour = pilot.inputs(map, pilot.CRYPT_TOUR, TOUR).inputs;
// Eight directions from the start, the diagonals moving the view both ways in one frame, with turns
// on the spot and into walls.
const DANCE = [];
for (const [bits, n] of [[8, 37], [10, 23], [2, 31], [6, 29], [4, 41], [5, 27], [1, 33], [9, 19], [6, 9], [9, 9], [10, 61], [5, 61], [4, 5], [8, 5], [2, 90]])
  for (let k = 0; k < n; k++) DANCE.push(bits);

const frameCase = (name, inputs) => ({
  name, ticks: inputs.length,
  prg: () => build(path.join(o.scratch, 'b'), { script: runs(inputs) }),
  want: () => { const hero = ISO.hero(map); for (const b of inputs) ISO.tick(map, hero, b); return VIEW.frame(map, hero).pixels; },
});
const cases = [
  ...(o.quick ? [0, 300, 900] : [0, 1, 4, 60, 150, 300, 450, 600, 750, 900, 1050, 1200, 1350, 1500, 1650, TOUR]).map(n => frameCase(`tour ${n}`, tour.slice(0, n))),
  ...(o.quick ? [DANCE.length] : [100, 260, 380, DANCE.length]).map(n => frameCase(`dance ${n}`, DANCE.slice(0, n))),
];
const timing = [['tour', tour], ['dance', DANCE]].map(([name, inputs]) => ({
  name, ticks: inputs.length,
  build: () => { const dir = path.join(o.scratch, name); build(dir, { script: runs(inputs) }); return { prg: path.join(dir, 'iso.prg'), lbl: path.join(dir, 'iso.lbl') }; },
}));

(async () => {
  let failures = await kit.checkFrames(o, cases, { border: VIEW.COLORS.border });
  failures += await kit.checkTiming(o, timing);
  kit.finish(o, failures, 'the C64 dungeon shows every frame exactly like the reference, with no late frames');
})().catch(e => { console.error(e.message); process.exit(1); });
