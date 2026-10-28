// Checks the C64 shoot-'em-up against the reference: the autopilot's run (showcase/shmup-pilot.js),
// and a sweep side to side with fire held that gets the ship shot down (explosions, coming back,
// blinking), play in test builds; VICE runs them, and every pixel of the frame the C64 shows must
// match the reference's frame after the same ticks. Then each whole script plays once more to count
// frames the engine was too late for, and sprites the multiplexer set up too late.
//
//   node test/shmup-check.js <path to VICE folder> [--ntsc | --model <name>] [--quick | --timing]
//
// --quick checks five frames and skips the timing runs; --timing runs only the timing. Needs cc65
// (ca65, ld65) on the PATH.
const path = require('path');
const kit = require('./kit.js');
const G = require('../core/shmup.js');
const VIEW = require('../c64/shmup/view.js');
const { level, build, runs } = require('../c64/shmup/build.js');
const pilot = require('../showcase/shmup-pilot.js');

const o = kit.options('node test/shmup-check.js');
const RUN = 2400, run = pilot.inputs(level, RUN).inputs;
const sweep = pilot.sweep(RUN);

const frameCase = (name, inputs) => {
  const g = G.game(level);
  for (const b of inputs) G.tick(level, g, b);
  const f = VIEW.frame(level, g);
  return {
    name, ticks: inputs.length, note: `${String(f.sprites.length).padStart(2)} sprites`,
    prg: () => build(path.join(o.scratch, 'b'), { script: runs(inputs) }), want: () => f.pixels,
  };
};
const cases = [
  ...(o.quick ? [0, 1, 300, 1300] : [0, 1, 2, 7, 8, 9, 60, 150, 300, 450, 640, 800, 900, 1050, 1300, 1500, 1760, 1950, 2100, RUN])
    .map(n => frameCase(`run ${n}`, run.slice(0, n))),
  ...(o.quick ? [606] : [601, 606, 620, 665, 668, 700, 1020, 2212, RUN]).map(n => frameCase(`sweep ${n}`, sweep.slice(0, n))),
];
const timing = [['run', run], ['sweep', sweep]].map(([name, inputs]) => ({
  name, ticks: inputs.length,
  build: () => { const dir = path.join(o.scratch, name); build(dir, { script: runs(inputs) }); return { prg: path.join(dir, 'shmup.prg'), lbl: path.join(dir, 'shmup.lbl') }; },
}));

(async () => {
  let failures = await kit.checkFrames(o, cases, { border: VIEW.COLORS.border });
  failures += await kit.checkTiming(o, timing);
  kit.finish(o, failures, "the C64 shoot-'em-up shows every frame exactly like the reference, with no late frames or sprites");
})().catch(e => { console.error(e.message); process.exit(1); });
